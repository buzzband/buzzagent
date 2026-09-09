use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub name: String,
    pub connected: bool,
    pub tools: Vec<McpTool>,
}

struct McpConnection {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    #[allow(dead_code)]
    stderr: ChildStderr,
    next_id: u64,
    tools: Vec<McpTool>,
}

pub struct McpManager {
    servers: HashMap<String, McpConnection>,
    configs: HashMap<String, McpServerConfig>,
}

impl McpManager {
    pub fn new() -> Self {
        McpManager {
            servers: HashMap::new(),
            configs: HashMap::new(),
        }
    }

    pub fn list_servers(&self) -> Vec<McpServerStatus> {
        let mut names: Vec<&String> = self.configs.keys().collect();
        names.sort();
        names
            .into_iter()
            .map(|name| {
                let cfg = &self.configs[name];
                let tools = self.servers.get(name).map(|c| c.tools.clone()).unwrap_or_default();
                McpServerStatus {
                    name: cfg.name.clone(),
                    connected: self.servers.contains_key(name),
                    tools,
                }
            })
            .collect()
    }

    /// Register a server config; connects immediately when enabled.
    pub async fn add_server(&mut self, config: McpServerConfig) -> Result<(), String> {
        self.configs.insert(config.name.clone(), config.clone());
        if config.enabled {
            self.connect_server(&config.name).await?;
        }
        Ok(())
    }

    /// Spawn the MCP server process and perform the JSON-RPC initialize
    /// handshake, then cache its tool list.
    pub async fn connect_server(&mut self, name: &str) -> Result<(), String> {
        let config = self
            .configs
            .get(name)
            .cloned()
            .ok_or_else(|| format!("Server config '{}' not found", name))?;

        // Drop any previous connection for this server first.
        self.disconnect_server(name).await;

        let mut cmd = tokio::process::Command::new(&config.command);
        cmd.args(&config.args);
        if let Some(env) = &config.env {
            for (k, v) in env {
                cmd.env(k, v);
            }
        }
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP server '{}': {} (is the command on PATH?)", name, e))?;

        let stdin = child.stdin.take().ok_or("Failed to capture server stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture server stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture server stderr")?;

        let mut conn = McpConnection {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            stderr,
            next_id: 1,
            tools: Vec::new(),
        };

        // MCP handshake: initialize -> notifications/initialized -> tools/list.
        let init_result: serde_json::Value = conn
            .request(
                "initialize",
                serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "BuzzAgent", "version": "0.1.0" }
                }),
            )
            .await
            .map_err(|e| format!("MCP initialize failed for '{}': {}", name, e))?;
        let _ = init_result;

        conn.notify("notifications/initialized").await?;

        let tools: Vec<McpTool> = match conn.request("tools/list", serde_json::json!({})).await {
            Ok(resp) => resp
                .get("tools")
                .and_then(|t| t.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|t| serde_json::from_value(t.clone()).ok())
                        .collect()
                })
                .unwrap_or_default(),
            Err(e) => return Err(format!("MCP tools/list failed for '{}': {}", name, e)),
        };
        conn.tools = tools;

        self.servers.insert(name.to_string(), conn);
        Ok(())
    }

    pub async fn disconnect_server(&mut self, name: &str) {
        if let Some(mut conn) = self.servers.remove(name) {
            let _ = conn.child.kill().await;
        }
    }

    pub async fn remove_server(&mut self, name: &str) -> Result<(), String> {
        self.disconnect_server(name).await;
        self.configs
            .remove(name)
            .ok_or_else(|| format!("Server '{}' not found", name))?;
        Ok(())
    }

    pub async fn call_tool(
        &mut self,
        server_name: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let conn = self
            .servers
            .get_mut(server_name)
            .ok_or_else(|| format!("Server '{}' is not connected", server_name))?;

        conn.request(
            "tools/call",
            serde_json::json!({
                "name": tool_name,
                "arguments": arguments,
            }),
        )
        .await
    }

    pub async fn list_tools(&mut self, server_name: &str) -> Result<Vec<McpTool>, String> {
        if let Some(conn) = self.servers.get(server_name) {
            return Ok(conn.tools.clone());
        }
        self.connect_server(server_name).await?;
        Ok(self
            .servers
            .get(server_name)
            .map(|c| c.tools.clone())
            .unwrap_or_default())
    }
}

impl McpConnection {
    /// Send a JSON-RPC request and await the response with the matching id.
    /// Skips server-initiated notifications/requests while waiting.
    async fn request(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.stdin
            .write_all(format!("{}\n", request).as_bytes())
            .await
            .map_err(|e| format!("Failed to write to MCP server: {}", e))?;

        // Bounded wait so a broken server cannot hang the UI forever.
        const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

        loop {
            let line = tokio::time::timeout(TIMEOUT, self.stdout.read_line_until_newline())
                .await
                .map_err(|_| "MCP server response timed out".to_string())?
                .map_err(|e| format!("Failed to read from MCP server: {}", e))?;

            let line = line;
            if line.trim().is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
                continue; // Non-JSON output — skip.
            };
            if v.get("id").and_then(|i| i.as_u64()) != Some(id) {
                continue; // Notification or unrelated message — skip.
            }
            if let Some(err) = v.get("error") {
                return Err(format!("MCP error: {}", err));
            }
            return Ok(v.get("result").cloned().unwrap_or(serde_json::Value::Null));
        }
    }

    /// Send a JSON-RPC notification (no id, no response expected).
    async fn notify(&mut self, method: &str) -> Result<(), String> {
        let note = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
        });
        self.stdin
            .write_all(format!("{}\n", note).as_bytes())
            .await
            .map_err(|e| format!("Failed to write to MCP server: {}", e))
    }
}

// Read a single newline-terminated line from the buffered stdout.
trait ReadLineExt {
    async fn read_line_until_newline(&mut self) -> std::io::Result<String>;
}

impl ReadLineExt for BufReader<ChildStdout> {
    async fn read_line_until_newline(&mut self) -> std::io::Result<String> {
        let mut line = String::new();
        self.read_line(&mut line).await?;
        Ok(line)
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_deserializes_minimal() {
        let cfg: McpServerConfig = serde_json::from_str(
            r#"{"name": "github", "command": "npx"}"#,
        )
        .unwrap();
        assert_eq!(cfg.name, "github");
        assert!(cfg.enabled);
        assert!(cfg.args.is_empty());
    }

    #[test]
    fn tool_deserializes_with_input_schema() {
        let t: McpTool = serde_json::from_str(
            r#"{"name": "search", "description": "Search repos", "inputSchema": {"type": "object"}}"#,
        )
        .unwrap();
        assert_eq!(t.name, "search");
        assert!(t.input_schema.is_object());
    }

    #[tokio::test]
    async fn call_tool_fails_cleanly_when_not_connected() {
        let mut mgr = McpManager::new();
        let err = mgr
            .call_tool("missing", "tool", serde_json::json!({}))
            .await
            .unwrap_err();
        assert!(err.contains("not connected"));
    }
}
