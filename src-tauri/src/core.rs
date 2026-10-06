//! Supervision of the OpenCode sidecar.
//!
//! BuzzAgent does not implement an agent. It runs `opencode serve` as a child
//! process and the frontend talks to that server directly over HTTP + SSE.
//! This module owns only the process lifecycle and the hardening applied to
//! it. It never proxies session, message or event traffic.
//!
//! Hardening applied on every spawn (see `docs/telemetry-audit.md`):
//!   * bind `127.0.0.1` on a free random port;
//!   * a freshly generated `OPENCODE_SERVER_PASSWORD` per run;
//!   * a forced config file — `share: "disabled"`, `autoupdate: false` —
//!     because `PATCH /config` does not persist;
//!   * all four XDG roots pointed inside our app data dir, so we never touch
//!     the user's personal `opencode` CLI state;
//!   * loopback forced into `NO_PROXY`, otherwise a corporate proxy captures
//!     local traffic and the UI hangs.

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::process::{Child, Command};

/// Version of the core this build is developed and tested against.
/// Bump this and regenerate the SDK together.
pub const PINNED_CORE_VERSION: &str = "1.18.30";

/// What the frontend needs in order to reach the core itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreConnection {
    /// Base URL, e.g. `http://127.0.0.1:49731`.
    pub base_url: String,
    /// HTTP basic username (the core defaults to `opencode`).
    pub username: String,
    /// Generated per-run password.
    pub password: String,
    /// Absolute path of the project the core was started in.
    pub directory: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CoreState {
    Stopped,
    Starting,
    Running,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreStatus {
    pub state: CoreState,
    pub connection: Option<CoreConnection>,
    /// Populated when `state` is `Failed`.
    pub error: Option<String>,
    /// Version reported by `GET /global/health`, once known.
    pub version: Option<String>,
    /// Whether we spawned this core or attached to an existing one.
    pub managed: bool,
    /// Tail of recent stdout/stderr, so the UI can show why a start failed
    /// instead of an opaque spinner.
    pub log: Vec<String>,
}

impl Default for CoreStatus {
    fn default() -> Self {
        CoreStatus {
            state: CoreState::Stopped,
            connection: None,
            error: None,
            version: None,
            managed: true,
            log: Vec::new(),
        }
    }
}

/// Config we force on the sidecar. Written to disk because `PATCH /config`
/// is not persisted by the core.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
struct ForcedConfig {
    #[serde(rename = "$schema")]
    schema: &'static str,
    /// Never upload conversations.
    share: &'static str,
    /// No self-update of a binary we pin and ship.
    autoupdate: bool,
}

impl Default for ForcedConfig {
    fn default() -> Self {
        ForcedConfig {
            schema: "https://opencode.ai/config.json",
            share: "disabled",
            autoupdate: false,
        }
    }
}

const LOG_TAIL_LIMIT: usize = 200;

/// Deep-merge `patch` into `dst`.
///
/// Settings UI holds a snapshot of the file and may save it after other flows
/// (provider add, MCP toggles) changed the same file. Top-level replacement
/// would then resurrect deleted keys and wipe new ones — the exact bug behind
/// "adding a provider deleted the previous one". Rules:
///   * object ∩ object  -> recurse;
///   * `null` anywhere  -> delete that key (the UI's reset signal);
///   * anything else    -> replace.
/// Default system prompt for the built-in `plan` mode (batch-2 request: the
/// planning agent should keep its plan in PLAN.md). The Modes settings tab
/// offers the same text as placeholder/button (DEFAULT_PLAN_PROMPT in
/// SettingsPanel.tsx) — keep the two in sync.
const DEFAULT_PLAN_PROMPT: &str = "You are in plan mode. Research the task in the project without making any changes. Create a plan for all tasks and save it as PLAN.md in the project root (create the file or update it), then present a short summary and wait for the user's confirmation before switching to build mode.";

fn merge_settings(dst: &mut serde_json::Value, patch: &serde_json::Value) {
    use serde_json::Value;
    match (dst, patch) {
        (Value::Object(dst_map), Value::Object(patch_map)) => {
            for (key, entry) in patch_map {
                if entry.is_null() {
                    dst_map.remove(key);
                } else if let Some(existing) = dst_map.get_mut(key) {
                    if existing.is_object() && entry.is_object() {
                        merge_settings(existing, entry);
                    } else {
                        *existing = entry.clone();
                    }
                } else {
                    dst_map.insert(key.clone(), entry.clone());
                }
            }
        }
        (dst, patch) => *dst = patch.clone(),
    }
}

/// Keys BuzzAgent owns outright: whatever the UI or a raw edit says, these are
/// re-applied on every write. `experimental.openTelemetry` is the core's only
/// telemetry surface and stays off with the rest.
fn force_privacy_keys(value: &mut serde_json::Value) {
    value["$schema"] = serde_json::json!("https://opencode.ai/config.json");
    value["share"] = serde_json::json!("disabled");
    value["autoupdate"] = serde_json::json!(false);
    if !value
        .get("experimental")
        .map(|v| v.is_object())
        .unwrap_or(false)
    {
        value["experimental"] = serde_json::json!({});
    }
    if let Some(exp) = value
        .get_mut("experimental")
        .and_then(|v| v.as_object_mut())
    {
        exp.insert("openTelemetry".into(), serde_json::json!(false));
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomModelEntry {
    pub id: String,
    pub name: Option<String>,
    pub reasoning: Option<bool>,
    /// Reasoning effort level offered for this model. `None` = no level picker
    /// (plain on/off model); `Some("off")` = reasoning declared but no level
    /// selectable. Values are not restricted here — the UI offers a fixed set.
    #[serde(default)]
    pub level: Option<String>,
}

pub struct CoreSupervisor {
    child: Option<Child>,
    status: CoreStatus,
    log: Arc<Mutex<Vec<String>>>,
    data_dir: PathBuf,
}

impl CoreSupervisor {
    pub fn new(data_dir: PathBuf) -> Self {
        CoreSupervisor {
            child: None,
            status: CoreStatus::default(),
            log: Arc::new(Mutex::new(Vec::new())),
            data_dir,
        }
    }

    pub fn status(&self) -> CoreStatus {
        let mut status = self.status.clone();
        if let Ok(log) = self.log.lock() {
            status.log = log.clone();
        }
        status
    }

    /// Attach to a core someone else started (`opencode serve` in a terminal).
    /// We do not own its lifecycle and must not harden or kill it.
    pub fn attach(&mut self, base_url: String, username: Option<String>, password: String) {
        self.status = CoreStatus {
            state: CoreState::Running,
            connection: Some(CoreConnection {
                base_url: base_url.trim_end_matches('/').to_string(),
                username: username.unwrap_or_else(|| "opencode".into()),
                password,
                directory: String::new(),
            }),
            error: None,
            version: None,
            managed: false,
            log: Vec::new(),
        };
    }

    /// Spawn a hardened core for `project_dir`.
    ///
    /// `binary` is the sidecar path; when `None` we fall back to `opencode`
    /// on `PATH` so a developer with their own install can run the app.
    pub async fn start(
        &mut self,
        project_dir: &Path,
        binary: Option<PathBuf>,
    ) -> Result<CoreConnection, String> {
        if matches!(self.status.state, CoreState::Running | CoreState::Starting) {
            if let Some(conn) = &self.status.connection {
                return Ok(conn.clone());
            }
        }
        let abs_project_dir = std::fs::canonicalize(project_dir).map_err(|e| {
            format!(
                "Cannot resolve directory '{}': {}",
                project_dir.display(),
                e
            )
        })?;
        if !abs_project_dir.is_dir() {
            return Err(format!("Not a directory: {}", abs_project_dir.display()));
        }

        self.stop().await;
        if let Ok(mut log) = self.log.lock() {
            log.clear();
        }
        self.status = CoreStatus {
            state: CoreState::Starting,
            ..CoreStatus::default()
        };

        let port = free_port()?;
        let password = generate_password();
        let exe = find_opencode_binary(binary, &self.data_dir)?;

        let dirs = CoreDirs::prepare(&self.data_dir)?;
        dirs.write_forced_config()?;
        // Move any legacy plain-text provider keys out of the config file and
        // into the credential store before the core reads either.
        self.scrub_provider_keys()?;
        // First run: give the built-in plan mode its PLAN.md prompt (only
        // while the config has no agent overrides at all).
        self.seed_mode_prompts()?;

        let mut cmd = Command::new(&exe);
        cmd.arg("serve")
            .arg("--hostname")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .current_dir(&abs_project_dir)
            .env("OPENCODE_SERVER_USERNAME", "opencode")
            .env("OPENCODE_SERVER_PASSWORD", &password)
            // Keep every core artefact inside our app dir. XDG_STATE_HOME
            // alone is not enough: the db, auth.json, logs and the model
            // cache live under the data and cache roots.
            .env("XDG_CONFIG_HOME", &dirs.config)
            .env("XDG_STATE_HOME", &dirs.state)
            .env("XDG_DATA_HOME", &dirs.data)
            .env("XDG_CACHE_HOME", &dirs.cache)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        for (key, value) in no_proxy_env() {
            cmd.env(key, value);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start the agent core ({}): {}", exe.display(), e))?;

        if let Some(stdout) = child.stdout.take() {
            pipe_to_log(stdout, self.log.clone());
        }
        if let Some(stderr) = child.stderr.take() {
            pipe_to_log(stderr, self.log.clone());
        }

        let connection = CoreConnection {
            base_url: format!("http://127.0.0.1:{}", port),
            username: "opencode".into(),
            password,
            directory: abs_project_dir.to_string_lossy().to_string(),
        };

        self.child = Some(child);

        match wait_until_healthy(&connection).await {
            Ok(version) => {
                if version != PINNED_CORE_VERSION {
                    // Not fatal: a user-supplied binary may differ. Surface it.
                    if let Ok(mut log) = self.log.lock() {
                        log.push(format!(
                            "warning: core version {} differs from pinned {}",
                            version, PINNED_CORE_VERSION
                        ));
                    }
                }
                self.status.state = CoreState::Running;
                self.status.version = Some(version);
                self.status.connection = Some(connection.clone());
                Ok(connection)
            }
            Err(e) => {
                let detail = self
                    .log
                    .lock()
                    .ok()
                    .map(|l| l.join("\n"))
                    .unwrap_or_default();
                self.stop().await;
                self.status.state = CoreState::Failed;
                let message = if detail.trim().is_empty() {
                    e
                } else {
                    format!("{e}\n{detail}")
                };
                self.status.error = Some(message.clone());
                Err(message)
            }
        }
    }

    pub async fn stop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill().await;
        }
        self.child = None;
        if self.status.managed {
            self.status.state = CoreState::Stopped;
            self.status.connection = None;
            self.status.version = None;
        }
    }

    /// Path of the config file the core reads at startup.
    /// Scan the user's personal opencode CLI state and report what is
    /// importable: authed providers and personal `provider`/`model` config.
    ///
    /// BuzzAgent runs the core inside its own XDG sandbox
    /// (`data_dir/core/{config,data,…}`), so a personal `~/.local/share/
    /// opencode/auth.json` is invisible to it — this is what the import copies.
    pub fn scan_personal_import(&self) -> Result<serde_json::Value, String> {
        let home = dirs_home().ok_or("Cannot resolve HOME")?;
        let mut report =
            serde_json::json!({ "authProviders": [], "configKeys": [], "hasConfig": false });

        let auth_path = home.join(".local/share/opencode/auth.json");
        if auth_path.is_file() {
            let content = std::fs::read_to_string(&auth_path).unwrap_or_default();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(map) = value.as_object() {
                    let ids: Vec<&String> = map.keys().collect();
                    report["authProviders"] = serde_json::json!(ids);
                }
            }
        }

        for candidate in [
            home.join(".config/opencode/opencode.json"),
            home.join(".opencode.json"),
        ] {
            if candidate.is_file() {
                report["hasConfig"] = serde_json::json!(true);
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(
                    &std::fs::read_to_string(&candidate).unwrap_or_default(),
                ) {
                    let mut keys = Vec::new();
                    if let Some(obj) = value.as_object() {
                        for key in obj.keys() {
                            if key != "$schema" {
                                keys.push(key.clone());
                            }
                        }
                    }
                    report["configKeys"] = serde_json::json!(keys);
                }
                break;
            }
        }
        Ok(report)
    }

    /// Copy the user's personal opencode auth + config into the sandboxed
    /// core, then restart it so the copied keys/models load. Only merges:
    /// never overwrites an existing sandbox key for the same provider.
    pub async fn import_personal(&self) -> Result<serde_json::Value, String> {
        let home = dirs_home().ok_or("Cannot resolve HOME")?;
        let mut imported_auth = 0usize;
        let mut imported_config_keys = 0usize;

        // 1. auth.json — merge per-provider credentials, don't clobber ours.
        let auth_path = home.join(".local/share/opencode/auth.json");
        if auth_path.is_file() {
            let personal: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&auth_path).unwrap_or_default())
                    .map_err(|e| format!("Personal auth.json is not valid JSON: {}", e))?;

            let sandbox = self.data_dir.join("core/data/opencode/auth.json");
            if let Some(parent) = sandbox.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut merged: serde_json::Value = if sandbox.is_file() {
                serde_json::from_str(&std::fs::read_to_string(&sandbox).unwrap_or_default())
                    .unwrap_or_else(|_| serde_json::json!({}))
            } else {
                serde_json::json!({})
            };
            if let (Some(src), Some(dst)) = (personal.as_object(), merged.as_object_mut()) {
                for (id, entry) in src {
                    if !dst.contains_key(id) {
                        dst.insert(id.clone(), entry.clone());
                        imported_auth += 1;
                    }
                }
            }
            let body = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
            std::fs::write(&sandbox, body)
                .map_err(|e| format!("Cannot write sandbox auth: {}", e))?;
        }

        // 2. Personal opencode.json — merge provider/model config, keep ours
        // authoritative for privacy keys ($schema/share/autoupdate).
        let personal_config = [
            home.join(".config/opencode/opencode.json"),
            home.join(".opencode.json"),
        ]
        .into_iter()
        .find(|p| p.is_file());
        if let Some(path) = personal_config {
            let personal: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_default())
                    .map_err(|e| format!("Personal opencode.json is not valid JSON: {}", e))?;

            if let Some(obj) = personal.as_object() {
                let mut patch = serde_json::Map::new();
                for key in obj.keys() {
                    if key == "$schema" || key == "share" || key == "autoupdate" {
                        continue; // forced keys stay ours
                    }
                    if let Some(v) = obj.get(key) {
                        patch.insert(key.clone(), v.clone());
                        imported_config_keys += 1;
                    }
                }
                if !patch.is_empty() {
                    self.write_settings(serde_json::Value::Object(patch))
                        .await?;
                }
            }
        }

        Ok(serde_json::json!({
            "authProviders": imported_auth,
            "configKeys": imported_config_keys,
        }))
    }

    fn user_config_path(&self) -> PathBuf {
        self.data_dir.join("core/config/opencode/opencode.json")
    }

    /// Path of the sandboxed credential store the core reads at startup.
    fn sandbox_auth_path(&self) -> PathBuf {
        self.data_dir.join("core/data/opencode/auth.json")
    }

    /// Persist a provider API key into the sandboxed `auth.json` — the same
    /// store `opencode auth login` writes and the core reads for every
    /// provider (precedence: `options.apiKey`, then auth entry, then env).
    /// Merges; never clobbers other providers' credentials.
    fn store_provider_key(&self, provider_id: &str, key: &str) -> Result<(), String> {
        if key.trim().is_empty() {
            return Ok(());
        }
        let path = self.sandbox_auth_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut value: serde_json::Value = if path.is_file() {
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_default())
                .unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };
        if !value.is_object() {
            value = serde_json::json!({});
        }
        value[provider_id] = serde_json::json!({ "type": "api", "key": key });
        let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&path, body).map_err(|e| format!("Cannot write sandbox auth: {}", e))
    }

    /// One-way, idempotent migration: any plain-text `options.apiKey` in the
    /// sandbox config is moved into `auth.json` and removed from the config.
    /// `{env:...}` placeholders and empty values are left alone. Runs on every
    /// core start, so existing installs are cleaned on the next launch.
    /// First-run seed for the built-in `plan` mode: the user asked for the
    /// planning agent to keep its task plan in PLAN.md. Applied only while the
    /// config has no `agent` overrides at all — user edits (including a
    /// deliberate deletion of the seed through the Modes settings) always win.
    fn seed_mode_prompts(&self) -> Result<(), String> {
        let config_path = self.user_config_path();
        if !config_path.is_file() {
            return Ok(());
        }
        let mut value: serde_json::Value =
            match serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap_or_default())
            {
                Ok(v) => v,
                Err(_) => return Ok(()), // Hand-edited invalid JSON: leave it for the user.
            };
        if value.get("agent").is_some() {
            return Ok(());
        }
        value["agent"] = serde_json::json!({
            "plan": {
                "mode": "primary",
                "description": "Plan mode — plans first and keeps the task plan in PLAN.md",
                "prompt": DEFAULT_PLAN_PROMPT,
            }
        });
        let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&config_path, body)
            .map_err(|e| format!("Failed to write settings: {}", e))?;
        Ok(())
    }

    fn scrub_provider_keys(&self) -> Result<(), String> {
        let config_path = self.user_config_path();
        if !config_path.is_file() {
            return Ok(());
        }
        let mut value: serde_json::Value =
            match serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap_or_default())
            {
                Ok(v) => v,
                Err(_) => return Ok(()), // Hand-edited invalid JSON: leave it for the user.
            };
        let Some(providers) = value.get_mut("provider").and_then(|p| p.as_object_mut()) else {
            return Ok(());
        };
        let mut moved: Vec<(String, String)> = Vec::new();
        for (id, def) in providers.iter_mut() {
            let Some(opts) = def.get_mut("options").and_then(|o| o.as_object_mut()) else {
                continue;
            };
            let Some(key) = opts.get("apiKey").and_then(|k| k.as_str()) else {
                continue;
            };
            if key.trim().is_empty() || key.starts_with("{env:") {
                continue;
            }
            moved.push((id.clone(), key.to_string()));
            opts.remove("apiKey");
        }
        if moved.is_empty() {
            return Ok(());
        }
        for (id, key) in moved {
            self.store_provider_key(&id, &key)?;
        }
        let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&config_path, body)
            .map_err(|e| format!("Cannot rewrite core config: {}", e))
    }

    /// Replace the entire on-disk config (Raw JSON editor).
    ///
    /// The merged `write_settings` cannot express key *deletions* across the
    /// whole document, and a raw editor hands back a complete file, so this
    /// writes it verbatim — with the forced privacy keys re-applied.
    pub async fn replace_settings(&self, value: serde_json::Value) -> Result<(), String> {
        let path = self.user_config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut value = if value.is_object() {
            value
        } else {
            return Err("Config root must be a JSON object".into());
        };
        force_privacy_keys(&mut value);

        let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&path, body).map_err(|e| format!("Failed to write settings: {}", e))?;

        if let Some(conn) = &self.status.connection {
            if let Ok(client) = reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(4))
                .build()
            {
                let _ = client
                    .patch(format!("{}/config", conn.base_url))
                    .basic_auth(&conn.username, Some(&conn.password))
                    .json(&value)
                    .send()
                    .await;
            }
        }
        Ok(())
    }

    /// Read the on-disk core settings so the UI can show current values.
    ///
    /// Read from disk rather than `GET /config` because that endpoint returns
    /// the merged effective config (including project files and defaults),
    /// while settings edits must round-trip through the file we own.
    pub fn read_settings(&self) -> Result<serde_json::Value, String> {
        let path = self.user_config_path();
        if !path.is_file() {
            return Ok(serde_json::json!({}));
        }
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        Ok(serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({})))
    }

    /// Merge a patch into the on-disk core settings.
    ///
    /// `PATCH /config` does not persist (see docs/telemetry-audit.md), so the
    /// file is the source of truth. The live core is patched too so changes
    /// apply without a restart where the core supports it.
    ///
    /// Keys set to JSON `null` are removed, which is how the UI resets a value
    /// back to the core's own default.
    pub async fn write_settings(&self, patch: serde_json::Value) -> Result<(), String> {
        let path = self.user_config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut value = self.read_settings()?;
        if !value.is_object() {
            value = serde_json::json!({});
        }

        merge_settings(&mut value, &patch);

        force_privacy_keys(&mut value);

        let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&path, body).map_err(|e| format!("Failed to write settings: {}", e))?;

        if let Some(conn) = &self.status.connection {
            if let Ok(client) = reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(4))
                .build()
            {
                let _ = client
                    .patch(format!("{}/config", conn.base_url))
                    .basic_auth(&conn.username, Some(&conn.password))
                    .json(&value)
                    .send()
                    .await;
            }
        }

        Ok(())
    }

    /// Add or update a custom provider (e.g. Ollama, LM Studio, vLLM, DeepSeek, custom proxy)
    /// with one or multiple models in the core's configuration.
    ///
    /// Persists to disk so it survives restarts, and sends PATCH /config to the live
    /// core if currently running so it takes effect immediately without restart.
    ///
    /// The API key is stored in the sandboxed `auth.json` — the core's native
    /// credential store — and NEVER in `opencode.json`: the core's built-in
    /// `opencode-customize` skill routinely copies provider config into project
    /// files, and a key sitting in the config would leak into the user's
    /// repository with it. The core resolves the key from auth.json itself.
    pub async fn add_custom_provider(
        &self,
        id: &str,
        name: &str,
        base_url: &str,
        api_key: Option<&str>,
        models: Vec<CustomModelEntry>,
    ) -> Result<(), String> {
        let config_file = self.data_dir.join("core/config/opencode/opencode.json");
        if let Some(parent) = config_file.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut value: serde_json::Value = if config_file.is_file() {
            let content = std::fs::read_to_string(&config_file).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({
                "$schema": "https://opencode.ai/config.json",
                "share": "disabled",
                "autoupdate": false
            })
        };

        if !value.get("provider").is_some() {
            value["provider"] = serde_json::json!({});
        }

        // New key → store it. No key passed (edit without retyping) → keep the
        // auth.json entry from the previous save. Either way a legacy plain key
        // sitting in THIS provider's config options is migrated out now.
        if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
            self.store_provider_key(id, key)?;
        }
        if let Some(opts) = value
            .get_mut("provider")
            .and_then(|p| p.get_mut(id))
            .and_then(|d| d.get_mut("options"))
            .and_then(|o| o.as_object_mut())
        {
            if let Some(key) = opts.get("apiKey").and_then(|k| k.as_str()) {
                if !key.trim().is_empty() && !key.starts_with("{env:") {
                    self.store_provider_key(id, key)?;
                }
            }
            opts.remove("apiKey");
        }

        let mut models_map = serde_json::Map::new();
        for m in models {
            let mut m_def = serde_json::json!({
                "name": m.name.unwrap_or_else(|| m.id.clone())
            });
            if m.reasoning == Some(true) {
                m_def["reasoning"] = serde_json::json!(true);
            }
            if let Some(level) = &m.level {
                if level != "off" {
                    // Per-variant config the core merges into the model's
                    // request options when the prompt carries top-level
                    // `variant: <key>` (see LLMRequestPrep: model options →
                    // agent options → variant options). For @ai-sdk/
                    // openai-compatible providers the SDK maps
                    // `reasoningEffort` to the `reasoning_effort` request
                    // field, so each level maps 1:1 to the wire value. `off`
                    // is deliberately absent: with no level chosen the core
                    // sends no variant at all, i.e. provider default behaviour.
                    m_def["variants"] = serde_json::json!({
                        "minimal": { "reasoningEffort": "minimal" },
                        "low":     { "reasoningEffort": "low" },
                        "medium":  { "reasoningEffort": "medium" },
                        "high":    { "reasoningEffort": "high" },
                        "xhigh":   { "reasoningEffort": "xhigh" },
                        "max":     { "reasoningEffort": "max" }
                    });
                }
            }
            models_map.insert(m.id, m_def);
        }

        let provider_obj = value.get_mut("provider").unwrap();
        provider_obj[id] = serde_json::json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": name,
            // No `apiKey` here on purpose: the core resolves it from auth.json
            // (options.apiKey > auth entry > env). Keeping the file key-free
            // means an agent-copied config can never leak credentials.
            "options": {
                "baseURL": base_url
            },
            "models": serde_json::Value::Object(models_map)
        });

        let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&config_file, body).map_err(|e| format!("Failed to write config: {}", e))?;

        // If core is currently running, also send PATCH /config over HTTP
        if let Some(conn) = &self.status.connection {
            let client = reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(4))
                .build()
                .map_err(|e| e.to_string())?;
            let url = format!("{}/config", conn.base_url);
            let patch_payload = serde_json::json!({
                "provider": value.get("provider")
            });
            let _ = client
                .patch(&url)
                .basic_auth(&conn.username, Some(&conn.password))
                .json(&patch_payload)
                .send()
                .await;
        }

        Ok(())
    }

    /// Copy sandbox auth + custom providers back to the user's personal
    /// opencode CLI state, so keys entered here work in a terminal too.
    ///
    /// Direction is the mirror of `import_personal` (sandbox -> personal):
    ///   * auth.json — per-provider merge, never overwriting an existing
    ///     personal key for the same provider;
    ///   * the sandbox config's `provider` map is written to the personal
    ///     `opencode.json`, with the forced privacy keys (`share`,
    ///     `autoupdate`, `$schema`) left out of the export.
    ///
    /// The personal config is written as a deep merge (not verbatim) so any
    /// other personal settings the user keeps there survive.
    pub fn export_personal(&self) -> Result<serde_json::Value, String> {
        let home = dirs_home().ok_or("Cannot resolve HOME")?;
        let mut exported_auth = 0usize;
        let mut exported_providers = 0usize;

        // 1. auth.json — copy every sandbox credential the personal file
        //    does not have yet.
        let sandbox = self.data_dir.join("core/data/opencode/auth.json");
        if sandbox.is_file() {
            let content = std::fs::read_to_string(&sandbox).unwrap_or_default();
            if let Ok(sandbox_auth) = serde_json::from_str::<serde_json::Value>(&content) {
                if sandbox_auth
                    .as_object()
                    .map(|m| !m.is_empty())
                    .unwrap_or(false)
                {
                    let state_home = std::env::var_os("XDG_STATE_HOME")
                        .filter(|v| !v.is_empty())
                        .map(PathBuf::from)
                        .unwrap_or_else(|| home.join(".local/state"));
                    let personal_path = state_home.join("opencode/auth.json");
                    if let Some(parent) = personal_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let mut personal: serde_json::Value = if personal_path.is_file() {
                        serde_json::from_str(
                            &std::fs::read_to_string(&personal_path).unwrap_or_default(),
                        )
                        .unwrap_or_else(|_| serde_json::json!({}))
                    } else {
                        serde_json::json!({})
                    };
                    if let (Some(src), Some(dst)) =
                        (sandbox_auth.as_object(), personal.as_object_mut())
                    {
                        for (id, entry) in src {
                            if !dst.contains_key(id) {
                                dst.insert(id.clone(), entry.clone());
                                exported_auth += 1;
                            }
                        }
                    }
                    let body =
                        serde_json::to_string_pretty(&personal).map_err(|e| e.to_string())?;
                    std::fs::write(&personal_path, body)
                        .map_err(|e| format!("Cannot write personal auth: {}", e))?;
                }
            }
        }

        // 2. Custom providers from our sandbox config -> personal opencode.json.
        //    Only entries carrying a `models` map (the shape our "custom
        //    provider" dialog writes) are exported.
        let providers = self
            .read_settings()
            .ok()
            .and_then(|v| v.get("provider").cloned())
            .unwrap_or_else(|| serde_json::json!({}));
        if let Some(provider_map) = providers.as_object() {
            if !provider_map.is_empty() {
                let personal_path = home.join(".config/opencode/opencode.json");
                if let Some(parent) = personal_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut personal: serde_json::Value = if personal_path.is_file() {
                    serde_json::from_str(
                        &std::fs::read_to_string(&personal_path).unwrap_or_default(),
                    )
                    .unwrap_or_else(|_| serde_json::json!({}))
                } else {
                    serde_json::json!({})
                };
                if !personal.is_object() {
                    personal = serde_json::json!({});
                }
                let obj = personal.as_object_mut().unwrap();
                let mut patch = serde_json::Map::new();
                for (id, def) in provider_map {
                    if def.get("models").map(|m| m.is_object()).unwrap_or(false) {
                        patch.insert(id.clone(), def.clone());
                        exported_providers += 1;
                    }
                }
                if !patch.is_empty() {
                    let existing = obj
                        .entry("provider")
                        .or_insert_with(|| serde_json::json!({}));
                    if !existing.is_object() {
                        *existing = serde_json::json!({});
                    }
                    if let Some(dst) = existing.as_object_mut() {
                        for (id, def) in patch {
                            dst.insert(id, def);
                        }
                    }
                    let body =
                        serde_json::to_string_pretty(&personal).map_err(|e| e.to_string())?;
                    std::fs::write(&personal_path, body)
                        .map_err(|e| format!("Cannot write personal config: {}", e))?;
                }
            }
        }

        Ok(serde_json::json!({
            "authProviders": exported_auth,
            "providers": exported_providers,
        }))
    }
}

fn find_opencode_binary(requested: Option<PathBuf>, data_dir: &Path) -> Result<PathBuf, String> {
    if let Some(path) = requested {
        if path.is_file() {
            return std::fs::canonicalize(&path).map_err(|e| e.to_string());
        }
        return Err(format!(
            "Specified opencode binary not found: {}",
            path.display()
        ));
    }

    /// Verify a candidate binary actually runs. The AppImage bundling step
    /// (linuxdeploy GTK plugin) has corrupted the sidecar binary in the past
    /// — it resizes ELF headers and the result segfaults immediately. A
    /// sidecar that cannot execute is worse than no sidecar: it crashes the
    /// core spawn with a cryptic "Failed to start" instead of falling back
    /// to a system binary. Run `opencode --version` with a short timeout to
    /// prove the file is executable and not corrupted.
    fn validate_binary(path: &Path) -> bool {
        // A corrupted binary (bad ELF from the AppImage GTK plugin) segfaults
        // instantly — a working one prints the version in milliseconds. The
        // blocking call is safe here: the failure mode is a crash, not a hang.
        std::process::Command::new(path)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    // 1. Check next to app / in sidecar dir
    if let Ok(exe_dir) = std::env::current_exe().map(|p| p.parent().map(|p| p.to_path_buf())) {
        if let Some(dir) = exe_dir {
            for candidate in [
                "opencode",
                "opencode.exe",
                "resources/opencode",
                "../Resources/opencode",
            ] {
                let p = dir.join(candidate);
                if p.is_file() {
                    let canonical = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
                    if validate_binary(&canonical) {
                        return Ok(canonical);
                    }
                }
            }
        }
    }
    // 2. Check app data_dir and workspace bin (always canonicalize to absolute path
    // so Command::new does not resolve relative to project_dir!)
    let local_bin = data_dir.join("bin/opencode");
    if local_bin.is_file() {
        let canonical = std::fs::canonicalize(&local_bin).map_err(|e| e.to_string())?;
        if validate_binary(&canonical) {
            return Ok(canonical);
        }
    }
    for rel in ["src-tauri/bin/opencode", "bin/opencode"] {
        let p = PathBuf::from(rel);
        if p.is_file() {
            let canonical = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
            if validate_binary(&canonical) {
                return Ok(canonical);
            }
        }
    }
    // 3. Check ~/.cache/opencode/bin/opencode or /tmp/kilo/oc/opencode
    if let Some(home) = dirs_home() {
        let p = home.join(".cache/opencode/bin/opencode");
        if p.is_file() {
            let canonical = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
            if validate_binary(&canonical) {
                return Ok(canonical);
            }
        }
    }
    let tmp_bin = PathBuf::from("/tmp/kilo/oc/opencode");
    if tmp_bin.is_file() {
        let canonical = std::fs::canonicalize(&tmp_bin).map_err(|e| e.to_string())?;
        if validate_binary(&canonical) {
            return Ok(canonical);
        }
    }
    // 4. Check if "opencode" is in PATH
    if let Some(p) = find_in_path("opencode") {
        if validate_binary(&p) {
            return Ok(p);
        }
    }
    Err(
        "OpenCode core binary not found. Please install opencode or place the binary on your PATH."
            .to_string(),
    )
}

fn find_in_path(cmd: &str) -> Option<PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            let full_path = path.join(cmd);
            if full_path.is_file() {
                return std::fs::canonicalize(&full_path).ok();
            }
            #[cfg(windows)]
            {
                let win_path = path.join(format!("{}.exe", cmd));
                if win_path.is_file() {
                    return std::fs::canonicalize(&win_path).ok();
                }
            }
        }
    }
    None
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// The four XDG roots the core writes to, kept inside our app data dir.
struct CoreDirs {
    config: PathBuf,
    state: PathBuf,
    data: PathBuf,
    cache: PathBuf,
}

impl CoreDirs {
    fn prepare(root: &Path) -> Result<Self, String> {
        let dirs = CoreDirs {
            config: root.join("core/config"),
            state: root.join("core/state"),
            data: root.join("core/data"),
            cache: root.join("core/cache"),
        };
        for dir in [&dirs.config, &dirs.state, &dirs.data, &dirs.cache] {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Cannot create {}: {}", dir.display(), e))?;
        }
        Ok(dirs)
    }

    /// Write the forced config the core reads at startup.
    /// Preserves user-configured custom providers if the file already exists!
    fn write_forced_config(&self) -> Result<(), String> {
        let dir = self.config.join("opencode");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let config_file = dir.join("opencode.json");

        let mut value: serde_json::Value = if config_file.is_file() {
            let content = std::fs::read_to_string(&config_file).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        value["$schema"] = serde_json::json!("https://opencode.ai/config.json");
        value["share"] = serde_json::json!("disabled");
        value["autoupdate"] = serde_json::json!(false);

        let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        std::fs::write(&config_file, body)
            .map_err(|e| format!("Cannot write forced core config: {}", e))
    }
}

/// Ask the OS for a free port, then release it. There is an unavoidable race
/// between release and the core binding it; the health check catches that.
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Cannot allocate a local port: {}", e))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| e.to_string())
}

/// 256 bits of randomness, hex encoded. Sourced from the OS via `getrandom`
/// (through `uuid`'s v4 generator) rather than a seeded PRNG.
fn generate_password() -> String {
    let a = uuid::Uuid::new_v4();
    let b = uuid::Uuid::new_v4();
    format!("{}{}", a.simple(), b.simple())
}

/// Force loopback into the proxy bypass list. Without this, a machine with
/// `HTTPS_PROXY` set routes our own localhost traffic through the proxy.
fn no_proxy_env() -> Vec<(String, String)> {
    const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];
    let mut out = Vec::new();
    for key in ["NO_PROXY", "no_proxy"] {
        let existing = std::env::var(key).unwrap_or_default();
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
        out.push((key.to_string(), items.join(",")));
    }
    out
}

fn pipe_to_log<R>(reader: R, log: Arc<Mutex<Vec<String>>>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        use tokio::io::AsyncBufReadExt;
        let mut lines = tokio::io::BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(mut log) = log.lock() {
                if log.len() >= LOG_TAIL_LIMIT {
                    log.remove(0);
                }
                log.push(line);
            }
        }
    });
}

/// Poll `GET /global/health` until the core answers. Cold start includes
/// downloading the model catalogue, so this needs a generous ceiling.
async fn wait_until_healthy(conn: &CoreConnection) -> Result<String, String> {
    // Generous ceiling: the first start on a machine with slow or blocked
    // network can spend tens of seconds fetching the model catalogue
    // (models.dev) before the HTTP server is ready.
    const ATTEMPTS: usize = 480;
    const DELAY_MS: u64 = 250;

    let client = reqwest::Client::builder()
        // Never route loopback through a proxy.
        .no_proxy()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/global/health", conn.base_url);
    let mut last_error = String::from("core did not become healthy");

    for _ in 0..ATTEMPTS {
        match client
            .get(&url)
            .basic_auth(&conn.username, Some(&conn.password))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
                return Ok(body
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string());
            }
            Ok(resp) => {
                last_error = format!("core replied with HTTP {}", resp.status().as_u16());
            }
            Err(e) => {
                last_error = e.to_string();
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(DELAY_MS)).await;
    }
    Err(last_error)
}

/// Read a plain-text file that may not exist, used by the log viewer.
pub fn read_core_log(data_dir: &Path) -> Option<String> {
    let log_dir = data_dir.join("core/data/opencode/log");
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(log_dir).ok()?.flatten() {
        let meta = entry.metadata().ok()?;
        let modified = meta.modified().ok()?;
        if newest.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
            newest = Some((modified, entry.path()));
        }
    }
    let (_, path) = newest?;
    let file = std::fs::File::open(path).ok()?;
    let lines: Vec<String> = BufReader::new(file).lines().map_while(Result::ok).collect();
    let tail = lines.len().saturating_sub(LOG_TAIL_LIMIT);
    Some(lines[tail..].join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forced_config_disables_share_and_autoupdate() {
        let json = serde_json::to_value(ForcedConfig::default()).unwrap();
        assert_eq!(json["share"], "disabled");
        assert_eq!(json["autoupdate"], false);
        assert_eq!(json["$schema"], "https://opencode.ai/config.json");
    }

    #[test]
    fn passwords_are_long_and_unique() {
        let a = generate_password();
        let b = generate_password();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn free_port_is_nonzero() {
        assert!(free_port().unwrap() > 0);
    }

    #[test]
    fn no_proxy_contains_loopback() {
        for (key, value) in no_proxy_env() {
            assert!(key.eq_ignore_ascii_case("no_proxy"));
            for host in ["127.0.0.1", "localhost", "::1"] {
                assert!(value.contains(host), "{} missing {}", value, host);
            }
        }
    }

    #[test]
    fn core_dirs_are_created_and_separate() {
        let tmp = std::env::temp_dir().join(format!("bz-test-{}", uuid::Uuid::new_v4()));
        let dirs = CoreDirs::prepare(&tmp).unwrap();
        assert!(dirs.config.is_dir() && dirs.state.is_dir());
        assert!(dirs.data.is_dir() && dirs.cache.is_dir());
        // Data must not be nested inside config, or isolation claims break.
        assert!(!dirs.data.starts_with(&dirs.config));
        dirs.write_forced_config().unwrap();
        let written =
            std::fs::read_to_string(tmp.join("core/config/opencode/opencode.json")).unwrap();
        assert!(written.contains("\"share\": \"disabled\""));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn settings_round_trip_and_force_privacy_keys() {
        let tmp = std::env::temp_dir().join(format!("bz-settings-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());

        // Nothing written yet: must not error, just report an empty object.
        assert_eq!(sup.read_settings().unwrap(), serde_json::json!({}));

        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(sup.write_settings(serde_json::json!({
            "logLevel": "DEBUG",
            "subagent_depth": 3,
            // A hostile patch must not be able to re-enable sharing.
            "share": "auto",
            "autoupdate": true,
        })))
        .unwrap();

        let saved = sup.read_settings().unwrap();
        assert_eq!(saved["logLevel"], "DEBUG");
        assert_eq!(saved["subagent_depth"], 3);
        assert_eq!(saved["share"], "disabled");
        assert_eq!(saved["autoupdate"], false);
        // The core's only telemetry flag is forced off alongside the rest.
        assert_eq!(saved["experimental"]["openTelemetry"], false);

        // A later patch must merge, not replace.
        rt.block_on(sup.write_settings(serde_json::json!({ "username": "dev" })))
            .unwrap();
        let merged = sup.read_settings().unwrap();
        assert_eq!(merged["logLevel"], "DEBUG");
        assert_eq!(merged["username"], "dev");

        // Null removes a key, which is how the UI resets to core defaults.
        rt.block_on(sup.write_settings(serde_json::json!({ "logLevel": null })))
            .unwrap();
        assert!(sup.read_settings().unwrap().get("logLevel").is_none());

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn settings_merge_is_deep_and_null_deletes_nested_keys() {
        let tmp = std::env::temp_dir().join(format!("bz-deep-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();

        rt.block_on(sup.add_custom_provider(
            "alpha",
            "Alpha",
            "http://127.0.0.1:1/v1",
            None,
            vec![CustomModelEntry {
                id: "m1".into(),
                name: None,
                reasoning: None,
                level: None,
            }],
        ))
        .unwrap();

        // A stale UI snapshot saves settings WITHOUT provider.alpha — the deep
        // merge must keep it (this used to wipe the provider).
        rt.block_on(sup.write_settings(serde_json::json!({ "logLevel": "INFO" })))
            .unwrap();
        let saved = sup.read_settings().unwrap();
        assert!(
            saved["provider"]["alpha"].is_object(),
            "alpha must survive a stale save"
        );

        // Explicit null deletes a nested key.
        rt.block_on(sup.write_settings(serde_json::json!({
            "provider": { "alpha": null }
        })))
        .unwrap();
        let saved = sup.read_settings().unwrap();
        assert!(
            saved["provider"].get("alpha").is_none(),
            "explicit null must delete"
        );

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn replace_settings_writes_verbatim_and_keeps_forced_keys() {
        let tmp = std::env::temp_dir().join(format!("bz-replace-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();

        let raw = serde_json::json!({
            "model": "ollama/qwen3",
            "agent": { "review": { "mode": "subagent", "prompt": "be terse" } },
            // Hostile values must be overridden again.
            "share": "auto",
            "experimental": { "openTelemetry": true }
        });

        rt.block_on(sup.replace_settings(raw)).unwrap();

        let saved = sup.read_settings().unwrap();
        // Everything the raw editor sent survives untouched...
        assert_eq!(saved["model"], "ollama/qwen3");
        assert_eq!(saved["agent"]["review"]["prompt"], "be terse");
        // ...except the keys BuzzAgent owns.
        assert_eq!(saved["share"], "disabled");
        assert_eq!(saved["experimental"]["openTelemetry"], false);

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn provider_api_keys_live_in_auth_store_not_config() {
        // The core's built-in customize skill copies provider config into
        // project files; a key in the config would leak into the repository
        // with it. Keys must land in auth.json instead.
        let tmp = std::env::temp_dir().join(format!("bz-keys-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();

        rt.block_on(sup.add_custom_provider(
            "secret",
            "Secret",
            "http://127.0.0.1:1/v1",
            Some("sk-live-abc123"),
            vec![CustomModelEntry {
                id: "m1".into(),
                name: None,
                reasoning: None,
                level: None,
            }],
        ))
        .unwrap();

        let config = sup.read_settings().unwrap();
        assert_eq!(config["provider"]["secret"]["options"]["baseURL"], "http://127.0.0.1:1/v1");
        assert!(
            config["provider"]["secret"]["options"].get("apiKey").is_none(),
            "config must not contain the key"
        );
        let auth: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(tmp.join("core/data/opencode/auth.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(auth["secret"]["type"], "api");
        assert_eq!(auth["secret"]["key"], "sk-live-abc123");

        // Editing without retyping the key must keep the stored one.
        rt.block_on(sup.add_custom_provider(
            "secret",
            "Secret",
            "http://127.0.0.1:2/v1",
            None,
            vec![CustomModelEntry {
                id: "m1".into(),
                name: None,
                reasoning: None,
                level: None,
            }],
        ))
        .unwrap();
        let auth: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(tmp.join("core/data/opencode/auth.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(auth["secret"]["key"], "sk-live-abc123");

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn scrub_moves_legacy_keys_from_config_into_auth_store() {
        let tmp = std::env::temp_dir().join(format!("bz-scrub-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());
        let config_dir = tmp.join("core/config/opencode");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(
            config_dir.join("opencode.json"),
            r#"{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "autoupdate": false,
  "provider": {
    "legacy": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:9/v1", "apiKey": "sk-legacy-1" },
      "models": { "m": { "name": "M" } }
    },
    "already-clean": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:9/v1" },
      "models": { "m": { "name": "M" } }
    }
  }
}"#,
        )
        .unwrap();

        sup.scrub_provider_keys().unwrap();

        let config = sup.read_settings().unwrap();
        assert!(
            config["provider"]["legacy"]["options"]
                .get("apiKey")
                .is_none(),
            "plain key must leave the config"
        );
        assert_eq!(
            config["provider"]["legacy"]["options"]["baseURL"],
            "http://127.0.0.1:9/v1"
        );
        let auth: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(tmp.join("core/data/opencode/auth.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(auth["legacy"]["key"], "sk-legacy-1");

        // Idempotent: a second run changes nothing and does not error.
        sup.scrub_provider_keys().unwrap();

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[tokio::test]
    async fn seeds_default_plan_prompt_only_when_no_agent_overrides_exist() {
        let tmp = std::env::temp_dir().join(format!("bz-seed-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());
        let config_dir = tmp.join("core/config/opencode");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(
            config_dir.join("opencode.json"),
            r#"{ "$schema": "https://opencode.ai/config.json", "share": "disabled", "autoupdate": false }"#,
        )
        .unwrap();

        sup.seed_mode_prompts().unwrap();

        let config = sup.read_settings().unwrap();
        assert_eq!(
            config["agent"]["plan"]["prompt"],
            serde_json::json!(DEFAULT_PLAN_PROMPT),
            "first run must seed the PLAN.md plan-mode prompt"
        );

        // A user-provided override wins; the seed never comes back over it.
        sup.write_settings(serde_json::json!({
            "agent": { "plan": { "prompt": "custom plan prompt" } }
        }))
        .await
        .unwrap();
        sup.seed_mode_prompts().unwrap();
        let config = sup.read_settings().unwrap();
        assert_eq!(config["agent"]["plan"]["prompt"], "custom plan prompt");

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[tokio::test]
    async fn adding_second_provider_keeps_the_first_across_restart() {
        // Regression: a user added a provider and the previous one vanished.
        let tmp = std::env::temp_dir().join(format!("bz-second-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());

        sup.add_custom_provider(
            "alpha",
            "Alpha",
            "http://127.0.0.1:1/v1",
            None,
            vec![CustomModelEntry {
                id: "m1".into(),
                name: Some("M1".into()),
                reasoning: None,
                level: None,
            }],
        )
        .await
        .unwrap();

        // A restart rewrites the forced config through CoreDirs.
        let dirs = CoreDirs::prepare(&tmp).unwrap();
        dirs.write_forced_config().unwrap();

        sup.add_custom_provider(
            "beta",
            "Beta",
            "http://127.0.0.1:2/v1",
            None,
            vec![CustomModelEntry {
                id: "m2".into(),
                name: Some("M2".into()),
                reasoning: Some(true),
                level: Some("high".into()),
            }],
        )
        .await
        .unwrap();

        let saved = sup.read_settings().unwrap();
        let providers = saved.get("provider").and_then(|p| p.as_object()).unwrap();
        assert!(
            providers.contains_key("alpha") && providers.contains_key("beta"),
            "both providers must survive, got: {providers:?}"
        );

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn settings_write_preserves_custom_providers() {
        let tmp = std::env::temp_dir().join(format!("bz-settings-prov-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();

        rt.block_on(sup.add_custom_provider(
            "ollama",
            "Ollama",
            "http://127.0.0.1:11434/v1",
            None,
            vec![CustomModelEntry {
                id: "qwen3".into(),
                name: Some("Qwen 3".into()),
                reasoning: Some(true),
                level: None,
            }],
        ))
        .unwrap();

        rt.block_on(sup.write_settings(serde_json::json!({ "logLevel": "WARN" })))
            .unwrap();

        let saved = sup.read_settings().unwrap();
        // Editing settings must not wipe configured providers.
        assert_eq!(
            saved["provider"]["ollama"]["models"]["qwen3"]["reasoning"],
            true
        );
        assert_eq!(saved["logLevel"], "WARN");

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn status_defaults_to_stopped() {
        let s = CoreStatus::default();
        assert_eq!(s.state, CoreState::Stopped);
        assert!(s.connection.is_none());
        assert!(s.managed);
    }

    #[test]
    fn attach_marks_core_unmanaged() {
        let mut sup = CoreSupervisor::new(std::env::temp_dir().join("bz-attach"));
        sup.attach("http://127.0.0.1:4096/".into(), None, "pw".into());
        let status = sup.status();
        assert_eq!(status.state, CoreState::Running);
        assert!(!status.managed);
        let conn = status.connection.unwrap();
        // Trailing slash trimmed so URL joins do not double up.
        assert_eq!(conn.base_url, "http://127.0.0.1:4096");
        assert_eq!(conn.username, "opencode");
    }

    #[test]
    fn export_personal_merges_into_cli_state_without_overwriting() {
        let tmp = std::env::temp_dir().join(format!("bz-export-{}", uuid::Uuid::new_v4()));
        let sup = CoreSupervisor::new(tmp.clone());
        let home = tmp.join("home");
        let state_home = home.join(".local/state");
        let config_home = home.join(".config");
        std::fs::create_dir_all(state_home.join("opencode")).unwrap();
        std::fs::create_dir_all(config_home.join("opencode")).unwrap();

        // Sandbox already holds an openai key and one custom provider.
        let sandbox_auth_dir = tmp.join("core/data/opencode");
        std::fs::create_dir_all(&sandbox_auth_dir).unwrap();
        std::fs::write(
            sandbox_auth_dir.join("auth.json"),
            r#"{"openai":{"type":"api","key":"sk-buzz"}}"#,
        )
        .unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        rt.block_on(sup.write_settings(serde_json::json!({
            "provider": { "flick": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Flick",
                "options": { "baseURL": "http://127.0.0.1:9/v1" },
                "models": { "m1": { "name": "M1" } }
            } }
        })))
        .unwrap();

        // The CLI already has its own key, provider and settings.
        std::fs::write(
            state_home.join("opencode/auth.json"),
            r#"{"anthropic":{"type":"api","key":"sk-cli"}}"#,
        )
        .unwrap();
        std::fs::write(
            config_home.join("opencode/opencode.json"),
            r#"{"$schema":"https://opencode.ai/config.json","model":"x/y","provider":{"other":{"models":{"o1":{}}}}}"#,
        )
        .unwrap();

        // Point the personal roots at the sandbox-free temp tree.
        std::env::set_var("HOME", &home);
        std::env::set_var("XDG_STATE_HOME", &state_home);
        std::env::set_var("XDG_CONFIG_HOME", &config_home);

        let report = sup.export_personal().unwrap();
        assert_eq!(report["authProviders"], 1);
        assert_eq!(report["providers"], 1);

        let auth: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(state_home.join("opencode/auth.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(auth["openai"]["key"], "sk-buzz"); // copied in
        assert_eq!(auth["anthropic"]["key"], "sk-cli"); // existing key untouched

        let cfg: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(config_home.join("opencode/opencode.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            cfg["provider"]["flick"]["options"]["baseURL"],
            "http://127.0.0.1:9/v1"
        );
        assert!(cfg["provider"]["other"].is_object()); // existing CLI provider kept
        assert_eq!(cfg["model"], "x/y"); // unrelated personal settings kept
        assert!(cfg.get("share").is_none()); // forced privacy keys are not exported
        assert!(cfg.get("autoupdate").is_none());

        std::fs::remove_dir_all(&tmp).ok();
    }
}
