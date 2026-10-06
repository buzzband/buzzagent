//! BuzzAgent desktop shell.
//!
//! The agent runtime is **not** implemented here. BuzzAgent runs a local
//! `opencode serve` process as the agent core and the frontend talks to it
//! directly over HTTP + SSE.
//!
//! This process is responsible only for:
//!   * supervising the core process (spawn, harden, health, shutdown);
//!   * native capabilities the core does not provide — browser automation
//!     and git worktree orchestration.
//!
//! It deliberately exposes no file-write or shell command of its own: those
//! go through the core so they inherit its permission and diff flow.

mod browser;
mod core;
mod git;
mod tray;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use browser::BrowserManager;
use core::{CoreConnection, CoreStatus, CoreSupervisor};
use tauri::{Manager, State};
use tokio::sync::Mutex as AsyncMutex;

pub struct AppState {
    pub core: Arc<AsyncMutex<CoreSupervisor>>,
    pub browser: AsyncMutex<BrowserManager>,
    pub data_dir: PathBuf,
    /// Handle for tray rebuilds, which the JS side cannot do itself.
    pub app_handle: tauri::AppHandle,
    /// Whether the user wants the tray icon (persisted in localStorage).
    pub tray_enabled: AtomicBool,
    /// Shared HTTP client for proxying frontend requests to the core.
    /// Built with `.no_proxy()` so loopback never leaks into a proxy.
    pub http: reqwest::Client,
    /// Live event-stream pumps keyed by stream id, so `core_events_stop`
    /// can cancel the task backing an unsubscribed channel.
    pub event_streams: Arc<std::sync::Mutex<HashMap<u64, tokio::task::JoinHandle<()>>>>,
    /// Monotonic ids for event-stream pumps.
    pub next_stream_id: AtomicU64,
}

// ---------------------------------------------------------------- core

/// Start (or reuse) a hardened core for `project_dir`.
///
/// Reuse only when the running core is already in the requested directory:
/// a stale connection pointing at another project must never be handed back
/// (that is how "new chat" landed in a different project and the file tree
/// showed nothing). Any mismatch — including an unmanaged/attached core —
/// restarts the supervisor into the requested directory.
#[tauri::command]
async fn core_start(
    state: State<'_, AppState>,
    project_dir: String,
    binary: Option<String>,
) -> Result<CoreConnection, String> {
    let requested = std::path::Path::new(&project_dir)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve directory '{project_dir}': {e}"))?
        .to_string_lossy()
        .to_string();

    let mut core = state.core.lock().await;
    if let Some(connection) = core.status().connection {
        let running_matches = connection.directory == requested;
        if running_matches && matches!(core.status().state, core::CoreState::Running) {
            return Ok(connection);
        }
        if !running_matches {
            core.stop().await;
        }
    }
    core.start(
        std::path::Path::new(&project_dir),
        binary
            .map(PathBuf::from)
            .filter(|p| !p.as_os_str().is_empty()),
    )
    .await
}

/// Attach to a core the user started themselves (`opencode serve`).
#[tauri::command]
async fn core_attach(
    state: State<'_, AppState>,
    base_url: String,
    username: Option<String>,
    password: String,
) -> Result<CoreStatus, String> {
    let mut core = state.core.lock().await;
    core.attach(base_url, username, password);
    Ok(core.status())
}

#[tauri::command]
async fn core_status(state: State<'_, AppState>) -> Result<CoreStatus, String> {
    let core = state.core.lock().await;
    Ok(core.status())
}

#[tauri::command]
async fn core_stop(state: State<'_, AppState>) -> Result<(), String> {
    let mut core = state.core.lock().await;
    core.stop().await;
    Ok(())
}

/// Tail of the core's own log file — so a failed start is diagnosable.
#[tauri::command]
async fn core_log(state: State<'_, AppState>) -> Result<String, String> {
    Ok(core::read_core_log(&state.data_dir).unwrap_or_default())
}

// --------------------------------------------------- frontend HTTP proxying
//
// The webview talks to the core through these commands instead of `fetch`.
// WebKitGTK picks up proxies from the desktop session (GNOME/KDE), and on
// such machines its `fetch("http://127.0.0.1:<port>")` never reaches the
// loopback even with NO_PROXY set in the environment. Routing everything
// through reqwest (built with `.no_proxy()`) removes the webview network
// stack from the loopback path entirely.

/// A proxied core response. The body travels base64-encoded so binary
/// payloads survive the IPC boundary untouched.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreHttpResponse {
    status: u16,
    body_base64: String,
    content_type: String,
}

/// Proxy one HTTP request from the webview to the core.
///
/// Auth never crosses the IPC boundary per request: the command reads the
/// active connection itself. `path` includes the query string (`/session/x/diff?y=1`).
#[tauri::command]
async fn core_http(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<CoreHttpResponse, String> {
    use base64::Engine as _;

    let connection = {
        let core = state.core.lock().await;
        core.status()
            .connection
            .ok_or_else(|| "The agent core is not running".to_string())?
    };

    let url = if path.starts_with("http://") || path.starts_with("https://") {
        path.clone()
    } else if path.starts_with('/') {
        format!("{}{}", connection.base_url, path)
    } else {
        format!("{}/{path}", connection.base_url)
    };

    let http_method = reqwest::Method::from_bytes(method.as_bytes().as_ref())
        .map_err(|e| format!("Invalid HTTP method '{method}': {e}"))?;

    let mut request = state
        .http
        .request(http_method, &url)
        .basic_auth(&connection.username, Some(&connection.password))
        .timeout(std::time::Duration::from_secs(120));
    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body);
    }

    let response = request.send().await.map_err(|e| {
        // reqwest's decode error is opaque; name the layer so users (and we)
        // can tell a dead core from a proxy from a truncated body.
        if e.is_decode() {
            format!("The core returned a malformed/truncated response for {method} {path}: {e}")
        } else if e.is_connect() || e.is_request() {
            format!(
                "Cannot reach the agent core at {}: {e}",
                connection.base_url
            )
        } else {
            format!("Core request failed: {e}")
        }
    })?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response.bytes().await.map_err(|e| {
        if e.is_decode() {
            format!("The core response was truncated for {method} {path}: {e}")
        } else {
            format!("Core response read failed: {e}")
        }
    })?;

    Ok(CoreHttpResponse {
        status,
        body_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        content_type,
    })
}

/// Chunks streamed from the core's `/event` SSE endpoint to the webview.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum CoreEventChunk {
    /// One SSE frame: the joined `data:` payload, still JSON-encoded.
    Event { payload: String },
    /// A connection attempt succeeded (first or after a drop).
    Connected,
    /// The stream dropped; the pump retries internally with backoff.
    Dropped { message: String },
}

/// Stream the core's event bus to a webview channel until stopped.
///
/// Reconnects with capped backoff and re-resolves the connection on every
/// attempt, so a core restart (new port) is picked up automatically.
#[tauri::command]
async fn core_events_start(
    state: State<'_, AppState>,
    on_event: tauri::ipc::Channel<CoreEventChunk>,
) -> Result<u64, String> {
    let id = state.next_stream_id.fetch_add(1, Ordering::Relaxed);

    let http = state.http.clone();
    let core_state = Arc::clone(&state.core);
    let streams = Arc::clone(&state.event_streams);

    let handle = tokio::spawn(async move {
        use base64::Engine as _;
        use futures_util::StreamExt as _;

        let _guard = StreamGuard {
            id,
            streams: streams.clone(),
        };

        let mut attempt: u32 = 0;
        loop {
            // Re-resolve the connection each attempt: a restarted core may
            // listen on a different port.
            let connection = {
                let core = core_state.lock().await;
                match core.status().connection.clone() {
                    Some(c) => c,
                    None => {
                        let _ = on_event.send(CoreEventChunk::Dropped {
                            message: "The agent core is not running".into(),
                        });
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                        continue;
                    }
                }
            };

            let auth = format!(
                "Basic {}",
                base64::engine::general_purpose::STANDARD
                    .encode(format!("{}:{}", connection.username, connection.password))
            );
            let url = format!("{}/event", connection.base_url);

            let stream_result = async {
                let response = http
                    .get(&url)
                    .header("Authorization", &auth)
                    .header("Accept", "text/event-stream")
                    .send()
                    .await
                    .map_err(|e| e.to_string())?
                    .error_for_status()
                    .map_err(|e| e.to_string())?;
                Ok::<_, String>(response.bytes_stream())
            }
            .await;

            let mut stream = match stream_result {
                Ok(s) => {
                    attempt = 0;
                    let _ = on_event.send(CoreEventChunk::Connected);
                    s
                }
                Err(message) => {
                    let _ = on_event.send(CoreEventChunk::Dropped { message });
                    attempt += 1;
                    let delay = std::time::Duration::from_millis(
                        250u64.saturating_mul(1 << attempt.min(5)),
                    );
                    tokio::time::sleep(delay).await;
                    continue;
                }
            };

            // Minimal SSE framing: collect `data:` lines, emit on a blank line.
            let mut buffer: Vec<u8> = Vec::new();
            let mut pending_data: Vec<String> = Vec::new();
            let mut eof = false;
            loop {
                if eof && buffer.is_empty() {
                    break;
                }
                if !eof {
                    match stream.next().await {
                        Some(Ok(chunk)) => buffer.extend_from_slice(&chunk),
                        Some(Err(e)) => {
                            let _ = on_event.send(CoreEventChunk::Dropped {
                                message: e.to_string(),
                            });
                            break;
                        }
                        None => {
                            eof = true;
                        }
                    }
                }
                while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = buffer.drain(..=pos).collect();
                    let line = String::from_utf8_lossy(&line[..line.len() - 1]);
                    let line = line.trim_end_matches('\r');
                    if line.is_empty() {
                        if !pending_data.is_empty() {
                            let payload = pending_data.join("");
                            pending_data.clear();
                            if !payload.is_empty() {
                                let _ = on_event.send(CoreEventChunk::Event { payload });
                            }
                        }
                    } else if let Some(data) = line.strip_prefix("data:") {
                        pending_data.push(data.trim_start().to_string());
                    }
                }
            }

            attempt += 1;
            let delay =
                std::time::Duration::from_millis(250u64.saturating_mul(1 << attempt.min(5)));
            tokio::time::sleep(delay).await;
        }
    });

    state
        .event_streams
        .lock()
        .expect("event stream registry poisoned")
        .insert(id, handle);
    Ok(id)
}

/// Remove a finished pump from the registry.
struct StreamGuard {
    id: u64,
    streams: Arc<std::sync::Mutex<HashMap<u64, tokio::task::JoinHandle<()>>>>,
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = self.streams.lock() {
            map.remove(&self.id);
        }
    }
}

/// Stop (and abort) an event-stream pump.
#[tauri::command]
async fn core_events_stop(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    if let Ok(mut map) = state.event_streams.lock() {
        if let Some(handle) = map.remove(&id) {
            handle.abort();
        }
    }
    Ok(())
}

/// Write text to the system clipboard from the backend.
///
/// Belt-and-braces for the web context-menu: some WebKitGTK builds block
/// `navigator.clipboard` writes for non-editable selections, while the native
/// clipboard always accepts them.
#[tauri::command]
async fn clipboard_write_text(text: String) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    // X11/Wayland via the standard CLI tools keeps this dependency-free;
    // fall back silently when neither exists (rare minimal setups).
    let mut child = tokio::process::Command::new("wl-copy")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .or_else(|_| {
            tokio::process::Command::new("xclip")
                .arg("-selection")
                .arg("clipboard")
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        })
        .map_err(|e| format!("No clipboard tool available: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|e| format!("Clipboard write failed: {e}"))?;
        stdin.flush().await.ok();
    }
    let _ = child.wait().await;
    Ok(())
}

/// Save a custom OpenAI-compatible provider (e.g. Ollama, LM Studio, vLLM, DeepSeek)
/// with multiple models.
#[tauri::command]
async fn core_save_custom_provider(
    state: State<'_, AppState>,
    id: String,
    name: String,
    base_url: String,
    api_key: Option<String>,
    models: Vec<core::CustomModelEntry>,
) -> Result<(), String> {
    let core = state.core.lock().await;
    core.add_custom_provider(&id, &name, &base_url, api_key.as_deref(), models)
        .await
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ProbeResult {
    pub ok: bool,
    pub status: u16,
    pub message: String,
    pub models: Vec<String>,
}

/// Query an OpenAI-compatible endpoint's /models list to auto-discover available models
/// and verify the API key and connection.
#[tauri::command]
async fn probe_provider_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<ProbeResult, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Ok(ProbeResult {
            ok: false,
            status: 400,
            message: "Base URL is required".to_string(),
            models: Vec::new(),
        });
    }
    let endpoint = if base.ends_with("/models") {
        base.to_string()
    } else {
        format!("{}/models", base)
    };

    let client = match reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(7))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(ProbeResult {
                ok: false,
                status: 500,
                message: format!("HTTP client error: {}", e),
                models: Vec::new(),
            })
        }
    };

    let mut req = client.get(&endpoint);
    if let Some(key) = api_key.as_ref().filter(|k| !k.trim().is_empty()) {
        req = req.header("Authorization", format!("Bearer {}", key.trim()));
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_connect() {
                format!(
                    "Cannot connect to server at {}: Connection refused or offline",
                    base
                )
            } else if e.is_timeout() {
                format!("Connection to {} timed out", base)
            } else {
                format!("Connection error: {}", e)
            };
            return Ok(ProbeResult {
                ok: false,
                status: 0,
                message: msg,
                models: Vec::new(),
            });
        }
    };

    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        let msg = if status == 401 {
            "API key is invalid or unauthorized (HTTP 401)".to_string()
        } else if status == 403 {
            "Access forbidden: API key does not have permission (HTTP 403)".to_string()
        } else if status == 404 {
            format!(
                "Endpoint not found at {} (HTTP 404). Check Base URL.",
                endpoint
            )
        } else {
            format!("Server error HTTP {}", status)
        };
        return Ok(ProbeResult {
            ok: false,
            status,
            message: msg,
            models: Vec::new(),
        });
    }

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => {
            return Ok(ProbeResult {
                ok: false,
                status,
                message: format!("Failed to parse JSON response: {}", e),
                models: Vec::new(),
            });
        }
    };

    let mut models = Vec::new();

    // Standard OpenAI schema: { "data": [ { "id": "model-id" } ] }
    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                models.push(id.to_string());
            }
        }
    }
    // Alternative schema (e.g. Ollama tags): { "models": [ { "name": "..." } ] }
    if models.is_empty() {
        if let Some(list) = json.get("models").and_then(|d| d.as_array()) {
            for item in list {
                if let Some(id) = item
                    .get("name")
                    .or_else(|| item.get("id"))
                    .and_then(|v| v.as_str())
                {
                    models.push(id.to_string());
                }
            }
        }
    }

    models.sort();
    models.dedup();

    let count = models.len();
    let msg = if count > 0 {
        format!("Verified successfully: {} models found", count)
    } else {
        "Connected successfully, but 0 models were listed".to_string()
    };

    Ok(ProbeResult {
        ok: true,
        status,
        message: msg,
        models,
    })
}

/// Version this build is pinned to, shown in the About/status UI.
/**
 * Append a line to the frontend diagnostics log (debug.log next to the core
 * data). A packaged webview has no devtools open by default, so render
 * crashes were invisible — "white screen with nothing to report". Frontend
 * crash reports and phase marks land here, next to the core's own log.
 */
#[tauri::command]
fn ui_log(state: State<'_, AppState>, level: String, message: String) {
    let path = state.data_dir.join("debug.log");
    let line = format!(
        "timestamp={} level={} kind=ui message={}\n",
        chrono_now_rfc3339(),
        level,
        message.replace('\n', " | "),
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

/// Minimal RFC3339 timestamp without pulling a chrono feature.
fn chrono_now_rfc3339() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    // Days since epoch → civil date (Howard Hinnant's algorithm).
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let sod = secs % 86_400;
    let (hh, mm, ss) = (sod / 3600, (sod % 3600) / 60, sod % 60);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, hh, mm, ss, millis
    )
}

/// Version this build is pinned to, shown in the About/status UI.
#[tauri::command]
fn core_pinned_version() -> &'static str {
    core::PINNED_CORE_VERSION
}

/// Test seam for scripted runs (Xvfb/CI): when `BUZZAGENT_AUTOPILOT_PROJECT`
/// is set at launch, the frontend auto-opens that project after boot —
/// native folder dialogs cannot be scripted headlessly. Unset → inert, so
/// this has no effect on normal users.
#[tauri::command]
fn ui_autopilot() -> Option<String> {
    std::env::var("BUZZAGENT_AUTOPILOT_PROJECT")
        .ok()
        .filter(|s| !s.is_empty())
}

/// What the user's personal opencode CLI has that we can import (authed
/// providers, personal config keys). Powers the pre-import hint in settings.
#[tauri::command]
async fn core_scan_personal(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let core = state.core.lock().await;
    core.scan_personal_import()
}

/// Copy personal opencode auth + provider config into the sandboxed core and
/// restart it. Returns counts of what was copied.
#[tauri::command]
async fn core_import_personal(
    state: State<'_, AppState>,
    project_dir: String,
) -> Result<serde_json::Value, String> {
    let result = {
        let core = state.core.lock().await;
        core.import_personal().await?
    };
    // Restart so the copied credentials/config actually load into the core.
    let mut core = state.core.lock().await;
    core.stop().await;
    core.start(std::path::Path::new(&project_dir), None).await?;
    Ok(result)
}

/// Copy sandbox credentials + custom providers back to the user's personal
/// opencode CLI state (merge-only, never overwrites personal values).
/// No restart needed: this only writes files outside the sandbox.
#[tauri::command]
async fn core_export_personal(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let core = state.core.lock().await;
    core.export_personal()
}

/// Show or remove the system tray icon. Remembered in the frontend's
/// localStorage; this only performs the native side of the switch.
#[tauri::command]
async fn app_toggle_tray(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.tray_enabled.store(enabled, Ordering::Relaxed);
    tray::set_enabled(&state.app_handle, enabled)
}

/// Restart the core so config-file changes (providers, modes, permissions)
/// take effect. OpenCode loads config once at startup — its own skill says a
/// restart is required — and the supervisor makes this cheap.
#[tauri::command]
async fn core_restart(
    state: State<'_, AppState>,
    project_dir: String,
) -> Result<CoreConnection, String> {
    let mut core = state.core.lock().await;
    core.stop().await;
    core.start(std::path::Path::new(&project_dir), None).await
}

/// Current on-disk core settings, for the settings panel.
#[tauri::command]
async fn core_read_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let core = state.core.lock().await;
    core.read_settings()
}

/// Merge a patch into the on-disk core settings. Null values reset a key.
#[tauri::command]
async fn core_write_settings(
    state: State<'_, AppState>,
    patch: serde_json::Value,
) -> Result<(), String> {
    let core = state.core.lock().await;
    core.write_settings(patch).await
}

/// Read a project's own `opencode.json` (empty when absent — it is optional).
#[tauri::command]
async fn core_read_project_config(
    state: State<'_, AppState>,
    project_dir: String,
) -> Result<serde_json::Value, String> {
    let _ = state;
    let path = std::path::Path::new(&project_dir).join("opencode.json");
    if !path.is_file() {
        return Ok(serde_json::json!({}));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid project config JSON: {}", e))
}

/// Merge a patch into a project's own `opencode.json` — the core's native
/// per-project config layer. Used for per-project MCP flags; the file is the
/// user's, so we only touch keys the UI explicitly manages.
#[tauri::command]
async fn core_write_project_config(
    state: State<'_, AppState>,
    project_dir: String,
    patch: serde_json::Value,
) -> Result<(), String> {
    let _ = state; // reserved for future per-project state
    let dir = std::path::Path::new(&project_dir);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir.display()));
    }
    let path = dir.join("opencode.json");

    let mut value: serde_json::Value = if path.is_file() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Project config is not valid JSON: {}", e))?
    } else {
        serde_json::json!({ "$schema": "https://opencode.ai/config.json" })
    };

    if let Some(map) = patch.as_object() {
        let target = value
            .as_object_mut()
            .ok_or_else(|| "Project config root is not an object".to_string())?;
        for (key, entry) in map {
            if entry.is_null() {
                target.remove(key);
            } else {
                target.insert(key.clone(), entry.clone());
            }
        }
    }

    let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| format!("Failed to write project config: {}", e))
}

/// Fetch a text resource for the registry installers (skills.sh search,
/// official MCP registry, raw.githubusercontent SKILL.md downloads).
///
/// The webview cannot do this fetch itself: registries do not send CORS
/// headers, and the desktop network stack may route through a system proxy
/// that breaks plain HTTPS. Rust's reqwest with `.no_proxy()` keeps it direct.
/// HTTPS-only and size-capped: this runs on user-entered search text and must
/// not become an arbitrary file/download primitive.
#[tauri::command]
async fn http_get_text(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Only https:// URLs are allowed".into());
    }
    const MAX_BYTES: usize = 2 * 1024 * 1024; // 2 MiB — search results and SKILL.md files
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("User-Agent", "BuzzAgent/0.1 (+https://github.com/buzzband/buzzagent)")
        .header("Accept", "application/json, text/markdown, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {} from {}", status.as_u16(), url));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("Response too large ({} bytes)", bytes.len()));
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Response is not valid UTF-8".into())
}

/// Write one file of a **global** (all-projects) skill into the sandboxed
/// global config dir the core reads: `<data_dir>/core/config/opencode/<rel>`.
///
/// The core's global root is inside our XDG sandbox, so the frontend cannot
/// reach it with the project-scoped fs commands; this is the guarded writer.
/// Path traversal is rejected (`..`, absolute paths, backslash escapes).
#[tauri::command]
async fn core_write_global_file(
    state: State<'_, AppState>,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    let rel = Path::new(&rel_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::RootDir))
        || rel_path.contains('\\')
    {
        return Err(format!("Invalid skill path: {}", rel_path));
    }
    let root = state.data_dir.join("core/config/opencode");
    let target = root.join(rel);
    // Belt and braces: after joining, the target must still be inside root.
    let canonical_root = root
        .canonicalize()
        .or_else(|_| {
            std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            root.canonicalize().map_err(|e| e.to_string())
        })?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let canonical_target = target
        .canonicalize()
        .or_else(|_| parent_canonicalized(&target))
        .unwrap_or_else(|_| target.clone());
    if !canonical_target.starts_with(&canonical_root) {
        return Err(format!("Skill path escapes the sandbox: {}", rel_path));
    }
    std::fs::write(&target, content).map_err(|e| format!("Cannot write {}: {}", rel_path, e))
}

/// Delete one file or folder of a **global** skill inside the sandboxed
/// global config dir (mirror of `core_write_global_file` for removals).
/// Same traversal guards as the writer.
#[tauri::command]
async fn core_delete_global_file(
    state: State<'_, AppState>,
    rel_path: String,
    is_dir: bool,
) -> Result<(), String> {
    let rel = Path::new(&rel_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::RootDir))
        || rel_path.contains('\\')
        || rel_path.is_empty()
    {
        return Err(format!("Invalid skill path: {}", rel_path));
    }
    let target = state.data_dir.join("core/config/opencode").join(rel);
    if !target.exists() {
        return Ok(()); // Already gone — removal is idempotent.
    }
    let result = if is_dir {
        std::fs::remove_dir_all(&target)
    } else {
        std::fs::remove_file(&target)
    };
    result.map_err(|e| format!("Cannot delete {}: {}", rel_path, e))
}

/// Canonicalize the deepest existing ancestor of `path` and re-join the tail,
/// for not-yet-created files (canonicalize fails on them).
fn parent_canonicalized(path: &Path) -> Result<PathBuf, String> {
    let mut anc = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match anc.canonicalize() {
            Ok(real) => {
                let mut resolved = real;
                for part in tail.iter().rev() {
                    resolved.push(part);
                }
                return Ok(resolved);
            }
            Err(_) => {
                let name = anc
                    .file_name()
                    .ok_or_else(|| "Cannot resolve path".to_string())?
                    .to_os_string();
                tail.push(name);
                if !anc.pop() {
                    return Err("Cannot resolve path".to_string());
                }
            }
        }
    }
}

/// Replace the whole on-disk config (raw JSON editor).
#[tauri::command]
async fn core_replace_settings(
    state: State<'_, AppState>,
    value: serde_json::Value,
) -> Result<(), String> {
    let core = state.core.lock().await;
    core.replace_settings(value).await
}

// -------------------------------------------------------------------- git

#[derive(Debug, Clone, serde::Serialize)]
pub struct FsEntry {
    pub name: String,
    /// Path relative to the project root.
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

const FS_IGNORED: [&str; 12] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".cache",
    ".buzzagent",
];

/// One level of the project file tree (read-only; edits stay in the core).
#[tauri::command]
async fn fs_tree(project_dir: String, path: Option<String>) -> Result<Vec<FsEntry>, String> {
    let root = Path::new(&project_dir)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let rel = path.unwrap_or_default();
    let target = if rel.is_empty() {
        root.clone()
    } else {
        for component in Path::new(&rel).components() {
            match component {
                std::path::Component::Normal(_) | std::path::Component::CurDir => {}
                _ => return Err("Path traversal is not allowed".into()),
            }
        }
        root.join(&rel)
    };

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&target)
        .map_err(|e| format!("Cannot read {}: {}", target.display(), e))?
    {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if FS_IGNORED.contains(&name.as_str()) || name.starts_with('.') {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel, name)
        };
        entries.push(FsEntry {
            name,
            path: child_rel,
            is_dir: meta.is_dir(),
            size: meta.len(),
        });
        if entries.len() >= 500 {
            break;
        }
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Resolve a user-supplied relative path inside the project root, rejecting
/// traversal (`..`, absolute paths) exactly like `fs_tree` does.
fn resolve_in_project(project_dir: &str, rel: &str) -> Result<PathBuf, String> {
    let root = Path::new(project_dir)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if rel.is_empty() {
        return Ok(root);
    }
    for component in Path::new(rel).components() {
        match component {
            std::path::Component::Normal(_) | std::path::Component::CurDir => {}
            _ => return Err("Path traversal is not allowed".into()),
        }
    }
    Ok(root.join(rel))
}

/// Create an empty file (parent directories included). Fails if it exists —
/// matching the editor convention where "new file" never silently overwrites.
#[tauri::command]
fn fs_create_file(project_dir: String, path: String) -> Result<(), String> {
    let target = resolve_in_project(&project_dir, &path)?;
    if target.exists() {
        return Err(format!("Already exists: {}", path));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&target, b"").map_err(|e| format!("Cannot create {}: {}", path, e))
}

/// Create a directory (parents included).
#[tauri::command]
fn fs_create_dir(project_dir: String, path: String) -> Result<(), String> {
    let target = resolve_in_project(&project_dir, &path)?;
    if target.exists() {
        return Err(format!("Already exists: {}", path));
    }
    std::fs::create_dir_all(&target).map_err(|e| format!("Cannot create {}: {}", path, e))
}

/// Write file content (the editor's save path). The core has no write
/// endpoint, so — like the rest of the explorer — this goes through Tauri.
#[tauri::command]
fn fs_write_file(project_dir: String, path: String, content: String) -> Result<(), String> {
    let target = resolve_in_project(&project_dir, &path)?;
    if !target.exists() {
        return Err(format!("Not found: {}", path));
    }
    if target.is_dir() {
        return Err(format!("Is a directory: {}", path));
    }
    std::fs::write(&target, content.as_bytes()).map_err(|e| format!("Cannot write {}: {}", path, e))
}

/// Rename/move a file or directory within the project (no cross-project moves).
#[tauri::command]
fn fs_rename(project_dir: String, path: String, to: String) -> Result<(), String> {
    let from = resolve_in_project(&project_dir, &path)?;
    let dest = resolve_in_project(&project_dir, &to)?;
    if !from.exists() {
        return Err(format!("Not found: {}", path));
    }
    if dest.exists() {
        return Err(format!("Already exists: {}", to));
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&from, &dest).map_err(|e| format!("Cannot rename {}: {}", path, e))
}

/// Delete a file, or a directory tree (VS Code deletes folders recursively).
#[tauri::command]
fn fs_delete(project_dir: String, path: String, is_dir: bool) -> Result<(), String> {
    let target = resolve_in_project(&project_dir, &path)?;
    if !target.exists() {
        return Ok(());
    }
    if is_dir {
        std::fs::remove_dir_all(&target).map_err(|e| format!("Cannot delete {}: {}", path, e))
    } else {
        std::fs::remove_file(&target).map_err(|e| format!("Cannot delete {}: {}", path, e))
    }
}

/// Uncommitted changes in the project, used by the diff panel.
///
/// The core's own diff endpoints returned empty in testing, so we read the
/// working tree directly. Read-only: writes still go through the core.
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitChangesReport {
    pub repo: bool,
    pub changes: Vec<git::FileChange>,
}

#[tauri::command]
async fn git_changes(project_dir: String) -> Result<GitChangesReport, String> {
    let dir = Path::new(&project_dir);
    let repo = git::is_repo(dir);
    let changes = if repo {
        git::working_changes(dir)?
    } else {
        Vec::new()
    };
    Ok(GitChangesReport { repo, changes })
}

/// Discard one file's changes. Untracked files are deleted.
#[tauri::command]
async fn git_revert_file(project_dir: String, path: String, untracked: bool) -> Result<(), String> {
    git::revert_file(Path::new(&project_dir), &path, untracked)
}

#[tauri::command]
async fn git_worktrees(project_dir: String) -> Result<Vec<git::WorktreeInfo>, String> {
    git::list_worktrees(Path::new(&project_dir))
}

#[tauri::command]
async fn git_worktree_add(project_dir: String, branch: String) -> Result<String, String> {
    git::create_worktree(Path::new(&project_dir), &branch)
}

#[tauri::command]
async fn git_worktree_remove(project_dir: String, path: String) -> Result<(), String> {
    git::remove_worktree(Path::new(&project_dir), &path)
}

// ---------------------------------------------------------------- browser

#[tauri::command]
async fn browser_set_mode(
    state: State<'_, AppState>,
    attach_url: Option<String>,
) -> Result<(), String> {
    let mut browser = state.browser.lock().await;
    let mode = match attach_url {
        Some(url) if !url.trim().is_empty() => browser::BrowserMode::Attach {
            cdp_url: url.trim().to_string(),
        },
        _ => browser::BrowserMode::Managed,
    };
    browser.set_config(browser::BrowserConfig {
        mode,
        width: 1280,
        height: 800,
        executable: None,
    });
    Ok(())
}

/// What the panel shows when a launch fails: the discovery report names the
/// browsers we probed and says explicitly that Firefox cannot be used.
#[tauri::command]
fn browser_discovery_report() -> String {
    browser::chromium_discovery_report()
}

/// Manual install command for the current distro (copyable fallback in the
/// panel's no-browser state).
#[tauri::command]
fn browser_install_hint() -> String {
    browser::install_command_hint()
}

/// One-click open-source Chromium install through the distro package manager
/// (pkexec shows the OS password prompt).
#[tauri::command]
async fn browser_install_chromium() -> Result<String, String> {
    browser::install_chromium().await
}

#[tauri::command]
async fn browser_navigate(state: State<'_, AppState>, url: String) -> Result<String, String> {
    let mut browser = state.browser.lock().await;
    browser.navigate(&url).await?;
    browser.screenshot().await
}

#[tauri::command]
async fn browser_screenshot(state: State<'_, AppState>) -> Result<String, String> {
    let browser = state.browser.lock().await;
    browser.screenshot().await
}

#[tauri::command]
async fn browser_click(state: State<'_, AppState>, selector: String) -> Result<(), String> {
    let mut browser = state.browser.lock().await;
    browser.click(&selector).await
}

#[tauri::command]
async fn browser_type(
    state: State<'_, AppState>,
    selector: String,
    text: String,
) -> Result<(), String> {
    let mut browser = state.browser.lock().await;
    browser.type_text(&selector, &text).await
}

#[tauri::command]
async fn browser_console_logs(
    state: State<'_, AppState>,
) -> Result<Vec<browser::ConsoleEntry>, String> {
    let browser = state.browser.lock().await;
    Ok(browser.get_console_logs())
}

/// Open a file or URL with the OS default handler (file manager, browser,
/// image viewer). No shell: the program list is platform-specific and fixed.
#[tauri::command]
fn open_external(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("File not found: {}", path));
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // `creation_flags` lives on `CommandExt`; without this import the
        // Windows build fails to compile (the block is cfg'd out everywhere
        // else, so only a Windows build can catch it).
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Ensure the loopback is in the process proxy-bypass list **before** Tauri
/// initializes. WebKitGTK (libsoup) resolves proxies from the environment at
/// startup; with `http_proxy` set (env or GNOME/KDE system proxy) the webview
/// would otherwise route `fetch("http://127.0.0.1:<port>")` through the proxy
/// and fail with "Cannot reach the agent core" — even though the core is
/// healthy (the Rust-side health check uses reqwest with `.no_proxy()`, so it
/// is immune). The supervisor appends loopback for the child core process too,
/// but the webview lives in *this* process, hence this must run first.
fn ensure_loopback_bypass() {
    use std::env;
    const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];
    for key in ["NO_PROXY", "no_proxy"] {
        let existing = env::var(key).unwrap_or_default();
        let mut items: Vec<String> = existing
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        for host in LOOPBACK {
            if !items.iter().any(|i| i.eq_ignore_ascii_case(host)) {
                items.push(host.to_string());
            }
        }
        env::set_var(key, items.join(","));
    }
}

#[cfg(test)]
mod loopback_tests {
    use super::ensure_loopback_bypass;

    #[test]
    fn loopback_is_added_to_proxy_bypass() {
        // Run with a pristine marker value so the assertion is meaningful.
        std::env::set_var("NO_PROXY", "proxy.corp.example");
        ensure_loopback_bypass();
        let value = std::env::var("NO_PROXY").unwrap_or_default();
        for host in ["127.0.0.1", "localhost", "::1"] {
            assert!(
                value.split(',').any(|i| i.trim() == host),
                "{} missing from {}",
                host,
                value
            );
        }
    }
}

#[tokio::main]
async fn main() {
    ensure_loopback_bypass();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("buzzagent"));
            std::fs::create_dir_all(&data_dir).ok();

            let handle = app.handle().clone();
            // The core (a Bun server) closes idle keep-alive connections; a
            // pooled dead socket then fails with reqwest's opaque "error
            // decoding response body" on the NEXT request (observed on the
            // first prompt after a pause). pool_idle_timeout retires sockets
            // before the server does, pool_max_idle_per_host(0) disables
            // reuse outright — belt and braces, the cost is negligible next
            // to a model call.
            let http = reqwest::Client::builder()
                .no_proxy()
                .pool_idle_timeout(std::time::Duration::from_secs(20))
                .pool_max_idle_per_host(0)
                .build()
                .map_err(|e| format!("Cannot build HTTP client: {e}"))?;
            app.manage(AppState {
                core: Arc::new(AsyncMutex::new(CoreSupervisor::new(data_dir.clone()))),
                browser: AsyncMutex::new(BrowserManager::new()),
                data_dir,
                app_handle: handle.clone(),
                tray_enabled: AtomicBool::new(false),
                http,
                event_streams: Arc::new(std::sync::Mutex::new(HashMap::new())),
                next_stream_id: AtomicU64::new(1),
            });

            // Window icon: without this, X11 window managers (xfwm4, mutter,
            // kwin) show a generic placeholder in the titlebar and taskbar.
            // Bundled icons come from tauri.conf.json `bundle.icon`.
            if let Some(icon) =
                tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png").as_ref())
                    .ok()
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(icon);
                }
            }

            // Restore the tray when the user left it enabled (the flag lives
            // in localStorage; it is replayed from JS on boot too).
            if app.state::<AppState>().tray_enabled.load(Ordering::Relaxed) {
                if let Err(e) = tray::set_enabled(&handle, true) {
                    eprintln!("tray init: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_start,
            core_attach,
            core_status,
            core_stop,
            core_restart,
            core_log,
            core_http,
            core_events_start,
            core_events_stop,
            clipboard_write_text,
            core_pinned_version,
            ui_log,
            ui_autopilot,
            core_scan_personal,
            core_import_personal,
            core_export_personal,
            app_toggle_tray,
            core_read_settings,
            core_write_settings,
            core_replace_settings,
            core_read_project_config,
            core_write_project_config,
            core_save_custom_provider,
            probe_provider_models,
            http_get_text,
            core_write_global_file,
            core_delete_global_file,
            git_changes,
            fs_tree,
            fs_create_file,
            fs_create_dir,
            fs_write_file,
            fs_rename,
            fs_delete,
            git_revert_file,
            git_worktrees,
            git_worktree_add,
            git_worktree_remove,
            browser_set_mode,
            browser_discovery_report,
            browser_install_hint,
            browser_install_chromium,
            browser_navigate,
            browser_screenshot,
            browser_click,
            browser_type,
            browser_console_logs,
            open_external,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Never leave an orphaned core (it can run shell commands).
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                let core = state.core.clone();
                tauri::async_runtime::block_on(async move {
                    core.lock().await.stop().await;
                });
            }
        });
}
