use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Window};

/// Per-role/per-task reasoning effort. Mapped to the OpenAI-compatible
/// `reasoning_effort` request field and reflected in the system prompt.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EffortLevel {
    Low,
    Medium,
    High,
    Max,
}

impl Default for EffortLevel {
    fn default() -> Self {
        EffortLevel::Medium
    }
}

impl EffortLevel {
    /// Human-readable label used in the system prompt.
    pub fn label(self) -> &'static str {
        match self {
            EffortLevel::Low => "low (answer directly, minimal deliberation)",
            EffortLevel::Medium => "medium (balanced deliberation)",
            EffortLevel::High => "high (think carefully before acting)",
            EffortLevel::Max => "maximum (exhaustive reasoning and verification)",
        }
    }

    /// Numeric value for `reasoning_effort` understood by OpenAI/DeepSeek.
    pub fn api_value(self) -> &'static str {
        match self {
            EffortLevel::Low => "low",
            EffortLevel::Medium => "medium",
            EffortLevel::High => "high",
            EffortLevel::Max => "high",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub project_path: String,
    #[serde(default)]
    pub effort: EffortLevel,
}

impl AgentConfig {
    /// Resolve the chat-completions endpoint and auth for the provider.
    /// All OpenAI-compatible providers share the same wire format; only the
    /// endpoint, key header name and default base URL differ.
    fn endpoint(&self) -> (String, Option<String>) {
        let base = self
            .base_url
            .clone()
            .filter(|b| !b.trim().is_empty())
            .unwrap_or_else(|| match self.provider.as_str() {
                "anthropic" => "https://api.anthropic.com/v1".into(),
                "ollama" => "http://localhost:11434/v1".into(),
                "deepseek" => "https://api.deepseek.com/v1".into(),
                "openrouter" => "https://openrouter.ai/api/v1".into(),
                _ => "https://api.openai.com/v1".into(),
            });
        let base = base.trim_end_matches('/').to_string();
        let url = if base.ends_with("/chat/completions") {
            base
        } else {
            format!("{}/chat/completions", base)
        };
        let key = match self.provider.as_str() {
            "anthropic" => std::env::var("ANTHROPIC_API_KEY").ok(),
            _ => {
                if self.api_key.trim().is_empty() {
                    std::env::var("OPENAI_API_KEY").ok()
                } else {
                    Some(self.api_key.clone())
                }
            }
        };
        (url, key)
    }
}

/// Events streamed to the frontend. Serialized with `serde(tag)` so the JSON
/// shape matches the frontend `AgentEvent` union:
/// `{ "type": "text" | "tool_call" | ... , ...fields }`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    Text { chunk: String },
    ToolCall { id: String, name: String, input: Value },
    ToolResult { id: String, output: String, error: Option<String> },
    Diff { file_path: String, content: String },
    Status { message: String },
    Error { message: String },
    Done,
}

/// One turn of the conversation, kept in Rust state for the session.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

/// A tool call requested by the model.
#[derive(Debug, Clone)]
struct ToolCall {
    id: String,
    name: String,
    args: Value,
}

/// A write awaiting user accept/reject. Original content is kept so the file
/// can be restored on reject.
#[derive(Debug, Clone)]
struct PendingWrite {
    path: PathBuf,
    original: Option<String>,
    modified: String,
}

pub struct AgentManager {
    config: Option<AgentConfig>,
    history: Vec<ChatMessage>,
    pending: HashMap<String, PendingWrite>,
    abort: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    /// Escalating id so cancelled runs do not race newer runs on writes.
    generation: Arc<AtomicU64>,
    run_gen: u64,
}

impl Default for AgentManager {
    fn default() -> Self {
        AgentManager {
            config: None,
            history: Vec::new(),
            pending: HashMap::new(),
            abort: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            run_gen: 0,
        }
    }
}

const SYSTEM_TOOLS: &str = r#"You are BuzzAgent, a coding agent working inside the user's project.

You can call these tools:
- read_file({"path": "relative/path"}) -> file content
- list_files({"path": "relative/dir", "depth": 2}) -> directory listing
- write_file({"path": "relative/path", "content": "full new file content"}) -> stages a change for user review
- shell_exec({"command": "..."}) -> runs a shell command in the project directory

Rules:
- Use relative paths inside the project.
- For any code change, always use write_file; the user reviews and accepts/rejects the diff.
- Prefer small, focused edits. After staging changes, briefly summarize what you changed.
- If the request is informational, just answer in plain text without tool calls."#;

impl AgentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Start a new task: resets the session, sets up the system prompt and
    /// runs the tool loop in the background, streaming events to `window`.
    pub async fn start(
        &mut self,
        config: AgentConfig,
        task: String,
        window: Window,
    ) -> Result<(), String> {
        if self.is_running() {
            return Err("Agent is already running".into());
        }
        if !Path::new(&config.project_path).is_dir() {
            return Err(format!("Project path is not a directory: {}", config.project_path));
        }

        self.config = Some(config.clone());
        self.pending.clear();

        let system = format!(
            "Project directory: {}\nReasoning effort: {}\n\n{}",
            config.project_path,
            config.effort.label(),
            SYSTEM_TOOLS
        );
        self.history = vec![
            ChatMessage { role: "system".into(), content: system },
            ChatMessage { role: "user".into(), content: task },
        ];

        self.abort.store(false, Ordering::SeqCst);
        self.running.store(true, Ordering::SeqCst);
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.run_gen = generation;

        let config = self.config.clone().unwrap();
        let history = self.history.clone();
        let pending = Arc::new(std::sync::Mutex::new(HashMap::new()));
        let abort = self.abort.clone();
        let running = self.running.clone();
        let generation_counter = self.generation.clone();

        tokio::spawn(async move {
            let run = AgentRun {
                config,
                window,
                pending,
                abort,
                running,
                generation: generation_counter,
                run_gen: generation,
            };
            run.execute(history).await;
        });

        Ok(())
    }

    /// Queue a follow-up user message. If the agent is idle, start a run
    /// immediately; otherwise it is appended and picked up on `Done`.
    pub async fn send_message(&mut self, message: &str, window: Window) -> Result<(), String> {
        let Some(config) = self.config.clone() else {
            return Err("Agent not configured — start a task first".into());
        };
        self.history.push(ChatMessage { role: "user".into(), content: message.to_string() });

        if self.is_running() {
            return Ok(());
        }

        self.abort.store(false, Ordering::SeqCst);
        self.running.store(true, Ordering::SeqCst);
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.run_gen = generation;

        let history = self.history.clone();
        let pending = Arc::new(std::sync::Mutex::new(self.pending.clone()));
        let abort = self.abort.clone();
        let running = self.running.clone();
        let generation_counter = self.generation.clone();

        tokio::spawn(async move {
            let run = AgentRun {
                config,
                window,
                pending,
                abort,
                running,
                generation: generation_counter,
                run_gen: generation,
            };
            run.execute(history).await;
        });
        Ok(())
    }

    /// Accept a staged write: write the modified content to disk.
    pub fn accept_diff(&mut self, file_path: &str, _hunk_index: Option<usize>) -> Result<(), String> {
        let pw = self
            .pending
            .remove(file_path)
            .ok_or_else(|| format!("No pending change for {}", file_path))?;
        let dir = pw.path.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        std::fs::write(&pw.path, &pw.modified).map_err(|e| e.to_string())
    }

    /// Reject a staged write: restore the original content (if any).
    pub fn reject_diff(&mut self, file_path: &str) -> Result<(), String> {
        let pw = self
            .pending
            .remove(file_path)
            .ok_or_else(|| format!("No pending change for {}", file_path))?;
        match pw.original {
            Some(orig) => {
                if let Some(dir) = pw.path.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                std::fs::write(&pw.path, orig).map_err(|e| e.to_string())
            }
            // File did not exist before — remove the rejected new file.
            None => {
                let _ = std::fs::remove_file(&pw.path);
                Ok(())
            }
        }
    }

    pub fn pending_files(&self) -> Vec<String> {
        self.pending.keys().cloned().collect()
    }

    pub fn stop(&mut self) -> Result<(), String> {
        self.abort.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.running.store(false, Ordering::SeqCst);
        Ok(())
    }
}

/// A single agent run: the model/tools loop executed in a background task.
struct AgentRun {
    config: AgentConfig,
    window: Window,
    pending: Arc<std::sync::Mutex<HashMap<String, PendingWrite>>>,
    abort: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    run_gen: u64,
}

impl AgentRun {
    fn emit(&self, event: AgentEvent) {
        let _ = self.window.emit("agent-event", event);
    }

    fn aborted(&self) -> bool {
        self.abort.load(Ordering::SeqCst) || self.generation.load(Ordering::SeqCst) != self.run_gen
    }

    async fn execute(mut self, mut history: Vec<ChatMessage>) {
        self.emit(AgentEvent::Status { message: "Thinking…".into() });

        const MAX_STEPS: usize = 25;
        for _step in 0..MAX_STEPS {
            if self.aborted() {
                break;
            }

            let assistant_reply = match self.chat(&history).await {
                Ok(reply) => reply,
                Err(e) => {
                    self.emit(AgentEvent::Error { message: e });
                    break;
                }
            };

            if self.aborted() {
                break;
            }

            let (text, tool_calls) = parse_reply(&assistant_reply);

            if !text.trim().is_empty() {
                self.emit(AgentEvent::Text { chunk: text.trim().to_string() });
            }

            if tool_calls.is_empty() {
                history.push(ChatMessage { role: "assistant".into(), content: assistant_reply });
                break;
            }

            history.push(ChatMessage { role: "assistant".into(), content: assistant_reply.clone() });

            for call in tool_calls {
                if self.aborted() {
                    break;
                }
                self.emit(AgentEvent::ToolCall {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    input: call.args.clone(),
                });

                let (output, error) = self.run_tool(&call).await;
                self.emit(AgentEvent::ToolResult {
                    id: call.id.clone(),
                    output: output.clone(),
                    error: error.clone(),
                });

                let tool_msg = if let Some(err) = &error {
                    format!("Error from {}: {}", call.name, err)
                } else {
                    output
                };
                history.push(ChatMessage {
                    role: "user".into(),
                    content: format!("[Tool {} result]\n{}", call.name, tool_msg),
                });
            }
        }

        self.running.store(false, Ordering::SeqCst);
        self.emit(AgentEvent::Done);
    }

    /// Build and send one chat-completions request; returns the raw assistant
    /// message (content + embedded tool-call JSON blocks).
    async fn chat(&self, history: &[ChatMessage]) -> Result<String, String> {
        let (url, key) = self.config.endpoint();
        let effort = self.config.effort;

        let mut messages = Vec::with_capacity(history.len());
        for m in history {
            messages.push(serde_json::json!({ "role": m.role, "content": m.content }));
        }

        let mut body = serde_json::json!({
            "model": self.config.model,
            "messages": messages,
            "stream": false,
        });
        // Reasoning effort is honored by OpenAI/DeepSeek; harmless to omit elsewhere.
        if matches!(effort, EffortLevel::Low | EffortLevel::Medium | EffortLevel::High | EffortLevel::Max) {
            body["reasoning_effort"] = Value::String(effort.api_value().to_string());
        }

        let client = reqwest::Client::new();
        let mut req = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body);
        if let Some(k) = &key {
            if self.config.provider == "anthropic" {
                req = req.header("x-api-key", k).header("anthropic-version", "2023-06-01");
            } else {
                req = req.header("Authorization", format!("Bearer {}", k));
            }
        }

        let resp = req.send().await.map_err(|e| format!("LLM request failed: {}", e))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("LLM API error {}: {}", status.as_u16(), truncate(&text, 500)));
        }

        let v: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Invalid JSON from LLM API: {} — {}", e, truncate(&text, 200)))?;
        let content = v["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
        Ok(content)
    }

    /// Execute one tool call locally. Only relative paths inside the project
    /// are allowed for file tools.
    async fn run_tool(&mut self, call: &ToolCall) -> (String, Option<String>) {
        let project = PathBuf::from(&self.config.project_path);

        match call.name.as_str() {
            "read_file" => {
                let Some(path) = arg_rel_path(&call.args, &project) else {
                    return (String::new(), Some("Missing or invalid 'path'".into()));
                };
                match std::fs::read_to_string(&path) {
                    Ok(content) => (truncate(&content, 60_000), None),
                    Err(e) => (String::new(), Some(e.to_string())),
                }
            }
            "list_files" => {
                let depth = call.args.get("depth").and_then(|d| d.as_u64()).unwrap_or(2).min(5) as usize;
                let dir = arg_rel_path(&call.args, &project)
                    .unwrap_or_else(|| project.clone());
                let mut out = String::new();
                list_dir_recursive(&dir, &project, depth, 0, &mut out);
                if out.is_empty() {
                    out = "(empty directory)".into();
                }
                (out, None)
            }
            "write_file" => {
                let Some(path) = arg_rel_path(&call.args, &project) else {
                    return (String::new(), Some("Missing or invalid 'path'".into()));
                };
                let Some(content) = call.args.get("content").and_then(|c| c.as_str()) else {
                    return (String::new(), Some("Missing 'content'".into()));
                };
                let original = std::fs::read_to_string(&path).ok();
                let rel = rel_display(&path, &project);
                // Stage the change; nothing touches disk until accept_diff.
                let insert_result = self.pending.lock().map(|mut p| {
                    p.insert(
                        rel.clone(),
                        PendingWrite {
                            path: path.clone(),
                            original,
                            modified: content.to_string(),
                        },
                    );
                });
                match insert_result {
                    Ok(()) => {
                        self.emit(AgentEvent::Diff { file_path: rel.clone(), content: content.to_string() });
                        (format!("Change staged for user review: {}", rel), None)
                    }
                    Err(_) => (String::new(), Some("Internal lock error".into())),
                }
            }
            "shell_exec" => {
                let Some(cmd) = call.args.get("command").and_then(|c| c.as_str()) else {
                    return (String::new(), Some("Missing 'command'".into()));
                };
                let output = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
                    .arg(if cfg!(windows) { "/C" } else { "-c" })
                    .arg(cmd)
                    .current_dir(&project)
                    .output()
                    .await;
                match output {
                    Ok(out) => {
                        let mut combined = String::from_utf8_lossy(&out.stdout).to_string();
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        if !stderr.trim().is_empty() {
                            combined.push_str(&stderr);
                        }
                        (truncate(&combined, 20_000), None)
                    }
                    Err(e) => (String::new(), Some(e.to_string())),
                }
            }
            other => (String::new(), Some(format!("Unknown tool '{}'", other))),
        }
    }
}

/// Parse a `rel_display`-style relative path against the project root.
fn rel_display(path: &Path, project: &Path) -> String {
    path.strip_prefix(project)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

/// Extract a relative path argument and resolve it strictly inside the
/// project root. Rejects absolute paths and any `..` traversal.
fn arg_rel_path(args: &Value, project: &Path) -> Option<PathBuf> {
    let raw = args.get("path")?.as_str()?;
    let p = Path::new(raw);
    if p.is_absolute() {
        return None;
    }
    for comp in p.components() {
        match comp {
            std::path::Component::Normal(_) | std::path::Component::CurDir => {}
            _ => return None, // ParentDir, RootDir, Prefix — all rejected.
        }
    }
    Some(project.join(p))
}

fn list_dir_recursive(dir: &Path, project: &Path, max_depth: usize, depth: usize, out: &mut String) {
    if depth > max_depth || out.len() > 30_000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let rel = rel_display(&entry.path(), project);
        if entry.path().is_dir() {
            out.push_str(&format!("{}/\n", rel));
            list_dir_recursive(&entry.path(), project, max_depth, depth + 1, out);
        } else {
            out.push_str(&format!("{}\n", rel));
        }
    }
}

/// The model answers either with plain text or with tool-call blocks of the
/// form: {"tool": "name", "id": "unique", "args": {...}} on a single line.
/// This keeps the protocol provider-agnostic (no native function-calling).
fn parse_reply(reply: &str) -> (String, Vec<ToolCall>) {
    let mut text_parts = Vec::new();
    let mut calls = Vec::new();

    for line in reply.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') && trimmed.ends_with('}') {
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                if v.get("tool").is_some() && v.get("args").is_some() {
                    let id = v
                        .get("id")
                        .and_then(|i| i.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| format!("call-{}", calls.len()));
                    calls.push(ToolCall {
                        id,
                        name: v["tool"].as_str().unwrap_or("unknown").to_string(),
                        args: v["args"].clone(),
                    });
                    continue;
                }
            }
        }
        text_parts.push(line);
    }

    (text_parts.join("\n").trim().to_string(), calls)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…\n(truncated)", &s[..end])
    }
}

// PendingWrite stays crate-private; the command layer accesses staged
// changes exclusively through AgentManager methods.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_text_reply() {
        let (text, calls) = parse_reply("Hello, world!");
        assert_eq!(text, "Hello, world!");
        assert!(calls.is_empty());
    }

    #[test]
    fn parses_tool_call_reply() {
        let reply = "Reading the file now.\n{\"tool\": \"read_file\", \"id\": \"c1\", \"args\": {\"path\": \"src/main.rs\"}}";
        let (text, calls) = parse_reply(reply);
        assert_eq!(text, "Reading the file now.");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "read_file");
        assert_eq!(calls[0].args["path"], "src/main.rs");
    }

    #[test]
    fn rejects_absolute_paths() {
        let project = Path::new("/tmp/project");
        assert!(arg_rel_path(&serde_json::json!({"path": "/etc/passwd"}), project).is_none());
        assert!(arg_rel_path(&serde_json::json!({"path": "../../etc"}), project).is_none());
        assert!(arg_rel_path(&serde_json::json!({"path": "src/lib.rs"}), project).is_some());
    }

    #[test]
    fn json_shape_matches_frontend() {
        let ev = AgentEvent::Text { chunk: "hi".into() };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "text");
        assert_eq!(v["chunk"], "hi");

        let ev = AgentEvent::ToolCall { id: "1".into(), name: "read_file".into(), input: serde_json::json!({"path": "a"}) };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "tool_call");
        assert_eq!(v["name"], "read_file");
    }
}
