//! Browser MCP server: exposes the headless-Chromium controller to the agent
//! as Model Context Protocol tools over stdio.
//!
//! The core spawns this binary with `--mcp-browser` (registered automatically
//! in the sandbox config). Tools: navigate, screenshot, console, click, type,
//! eval, close. The same `headless_chrome` stack the Browser panel uses, with
//! the AppImage-safe launch flags (`--no-sandbox`, `--disable-gpu`,
//! `--disable-dev-shm-usage`).
//!
//! Protocol: newline-delimited JSON-RPC 2.0 (MCP stdio transport).

use std::io::{BufRead, Write};

use headless_chrome::{Browser, LaunchOptionsBuilder};
use serde_json::{json, Value};

use crate::browser::{chromium_discovery_report, find_chromium_executable};

/// Console collector injected after each navigation: keeps the last entries
/// available to the agent via `browser_console`.
const CONSOLE_COLLECTOR: &str = r#"
(() => {
  if (window.__buzz) return;
  window.__buzz = { logs: [] };
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level];
    console[level] = function (...args) {
      try {
        window.__buzz.logs.push([level, args.map((a) => {
          try { return typeof a === "string" ? a : JSON.stringify(a); }
          catch { return String(a); }
        }).join(" ")]);
        if (window.__buzz.logs.length > 200) window.__buzz.logs.shift();
      } catch {}
      original.apply(console, args);
    };
  }
  window.addEventListener("error", (e) => {
    window.__buzz.logs.push(["error", `${e.message} @ ${e.filename}:${e.lineno}`]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    window.__buzz.logs.push(["error", `unhandled rejection: ${String(e.reason)}`]);
  });
})();
"#;

struct McpBrowser {
    browser: Option<Browser>,
}

impl McpBrowser {
    fn new() -> Self {
        Self { browser: None }
    }

    fn ensure(&mut self) -> Result<&Browser, String> {
        if self.browser.is_none() {
            let executable = find_chromium_executable().ok_or_else(|| {
                format!(
                    "No Chromium-family browser found. Install Chrome/Chromium/Edge/Brave. Details: {}",
                    chromium_discovery_report()
                )
            })?;
            let options = LaunchOptionsBuilder::default()
                .headless(true)
                .path(Some(executable))
                .window_size(Some((1280, 900)))
                .args(vec![
                    std::ffi::OsStr::new("--no-sandbox"),
                    std::ffi::OsStr::new("--disable-gpu"),
                    std::ffi::OsStr::new("--disable-dev-shm-usage"),
                ])
                .build()
                .map_err(|e| format!("Browser launch options error: {}", e))?;
            self.browser = Some(
                Browser::new(options).map_err(|e| format!("Failed to launch the browser: {}", e))?,
            );
        }
        Ok(self.browser.as_ref().expect("checked: browser launched"))
    }

    fn navigate(&mut self, args: &Value) -> Result<Value, String> {
        let url = args
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or("`url` is required")?;
        let browser = self.ensure()?;
        let tab = match browser.get_tabs().lock().ok().and_then(|t| t.last().cloned()) {
            Some(tab) => tab,
            None => browser.new_tab().map_err(|e| e.to_string())?,
        };
        tab.navigate_to(url)
            .map_err(|e| format!("Navigation failed: {}", e))?;
        tab.wait_until_navigated()
            .map_err(|e| format!("Page load failed: {}", e))?;
        // Install the console collector for this document.
        let _ = tab.evaluate(CONSOLE_COLLECTOR, false);
        let title = tab
            .evaluate("document.title", false)
            .ok()
            .and_then(|r| r.value.clone())
            .map(|v| v.as_str().unwrap_or("").to_string())
            .unwrap_or_default();
        Ok(json!({
            "content": [{ "type": "text", "text": format!("Navigated to {}\nTitle: {}", url, title) }]
        }))
    }

    fn screenshot_to(&mut self, path: &std::path::Path) -> Result<String, String> {
        let browser = self.ensure()?;
        let tab = browser
            .get_tabs()
            .lock()
            .ok()
            .and_then(|t| t.last().cloned())
            .ok_or("No tab open — call navigate first")?;
        let png = tab
            .capture_screenshot(
                headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Png,
                None,
                None,
                true,
            )
            .map_err(|e| format!("Screenshot failed: {}", e))?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(path, &png).map_err(|e| format!("Cannot write screenshot: {}", e))?;
        Ok(path.to_string_lossy().to_string())
    }

    fn screenshot(&mut self) -> Result<Value, String> {
        let browser = self.ensure()?;
        let tab = browser
            .get_tabs()
            .lock()
            .ok()
            .and_then(|t| t.last().cloned())
            .ok_or("No tab open — call browser_navigate first")?;
        let png = tab
            .capture_screenshot(
                headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Png,
                None,
                None,
                true,
            )
            .map_err(|e| format!("Screenshot failed: {}", e))?;
        use base64::Engine as _;
        let data = base64::engine::general_purpose::STANDARD.encode(&png);
        Ok(json!({
            "content": [
                { "type": "image", "data": data, "mimeType": "image/png" },
                { "type": "text", "text": format!("Screenshot of the current page ({} bytes PNG).", png.len()) }
            ]
        }))
    }

    fn console(&mut self) -> Result<Value, String> {
        let browser = self.ensure()?;
        let tab = browser
            .get_tabs()
            .lock()
            .ok()
            .and_then(|t| t.last().cloned())
            .ok_or("No tab open — call browser_navigate first")?;
        let result = tab
            .evaluate("JSON.stringify(window.__buzz ? window.__buzz.logs : [])", false)
            .map_err(|e| format!("Console read failed: {}", e))?;
        let raw = result
            .value
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "[]".into());
        let entries: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!([]));
        let lines = entries
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|e| {
                        let level = e.get(0).and_then(|v| v.as_str()).unwrap_or("log");
                        let text = e.get(1).and_then(|v| v.as_str()).unwrap_or("");
                        format!("[{}] {}", level, text)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let body = if lines.is_empty() {
            "Console is empty (no messages since navigation).".to_string()
        } else {
            lines.join("\n")
        };
        Ok(json!({ "content": [{ "type": "text", "text": body }] }))
    }

    fn click(&mut self, args: &Value) -> Result<Value, String> {
        let selector = args
            .get("selector")
            .and_then(|v| v.as_str())
            .ok_or("`selector` is required")?;
        let browser = self.ensure()?;
        let tab = browser
            .get_tabs()
            .lock()
            .ok()
            .and_then(|t| t.last().cloned())
            .ok_or("No tab open — call browser_navigate first")?;
        tab.wait_for_element(selector)
            .map_err(|e| format!("Element '{}' not found: {}", selector, e))?;
        tab.find_element(selector)
            .map_err(|e| e.to_string())?
            .click()
            .map_err(|e| format!("Click failed: {}", e))?;
        Ok(json!({ "content": [{ "type": "text", "text": format!("Clicked {}", selector) }] }))
    }

    fn type_text(&mut self, args: &Value) -> Result<Value, String> {
        let selector = args
            .get("selector")
            .and_then(|v| v.as_str())
            .ok_or("`selector` is required")?;
        let text = args
            .get("text")
            .and_then(|v| v.as_str())
            .ok_or("`text` is required")?;
        let browser = self.ensure()?;
        let tab = browser
            .get_tabs()
            .lock()
            .ok()
            .and_then(|t| t.last().cloned())
            .ok_or("No tab open — call browser_navigate first")?;
        tab.wait_for_element(selector)
            .map_err(|e| format!("Element '{}' not found: {}", selector, e))?;
        tab.find_element(selector)
            .map_err(|e| e.to_string())?
            .click()
            .map_err(|e| format!("Focus failed: {}", e))?;
        tab.type_str(text)
            .map_err(|e| format!("Typing failed: {}", e))?;
        Ok(json!({ "content": [{ "type": "text", "text": format!("Typed into {}", selector) }] }))
    }

    fn eval(&mut self, args: &Value) -> Result<Value, String> {
        let expression = args
            .get("expression")
            .and_then(|v| v.as_str())
            .ok_or("`expression` is required")?;
        let browser = self.ensure()?;
        let tab = browser
            .get_tabs()
            .lock()
            .ok()
            .and_then(|t| t.last().cloned())
            .ok_or("No tab open — call browser_navigate first")?;
        let result = tab
            .evaluate(expression, true)
            .map_err(|e| format!("Evaluation failed: {}", e))?;
        let text = result
            .value
            .map(|v| v.to_string())
            .unwrap_or_else(|| "(no value)".into());
        Ok(json!({ "content": [{ "type": "text", "text": text }] }))
    }

    fn close(&mut self) -> Result<Value, String> {
        self.browser = None; // Drop kills Chrome (headless_chrome).
        Ok(json!({ "content": [{ "type": "text", "text": "Browser closed." }] }))
    }
}

fn tool_defs() -> Value {
    json!([
        {
            "name": "browser_navigate",
            "description": "Open a URL in the shared headless browser (use for local dev servers and files you just wrote, e.g. http://localhost:3000 or a file:// path). Waits for load and starts console capture.",
            "inputSchema": {
                "type": "object",
                "properties": { "url": { "type": "string" } },
                "required": ["url"],
                "additionalProperties": false
            }
        },
        {
            "name": "browser_screenshot",
            "description": "Capture a PNG screenshot of the current page and return it as an image. Use it to SEE what the page looks like while coding.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "browser_console",
            "description": "Read console.log/info/warn/error messages and uncaught errors collected since the last navigation.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "browser_click",
            "description": "Click the first element matching a CSS selector.",
            "inputSchema": {
                "type": "object",
                "properties": { "selector": { "type": "string" } },
                "required": ["selector"],
                "additionalProperties": false
            }
        },
        {
            "name": "browser_type",
            "description": "Focus the element matching a CSS selector and type text into it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string" },
                    "text": { "type": "string" }
                },
                "required": ["selector", "text"],
                "additionalProperties": false
            }
        },
        {
            "name": "browser_eval",
            "description": "Evaluate a JavaScript expression in the page and return its value. Use it to inspect the DOM, computed styles or app state.",
            "inputSchema": {
                "type": "object",
                "properties": { "expression": { "type": "string" } },
                "required": ["expression"],
                "additionalProperties": false
            }
        },
        {
            "name": "browser_close",
            "description": "Close the shared headless browser.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }
    ])
}

// ---------------------------------------------------------------- CLI + daemon
//
// MCP tools are not exposed to sessions by OpenCode 2.0.32 (the server
// connects, tools are discovered, yet the model never receives them), so the
// agent drives the same browser through its `shell` and `read` tools:
//
//   buzzagent --browser-cli navigate <url>
//   buzzagent --browser-cli screenshot [path]   → prints the PNG path
//   buzzagent --browser-cli console|eval|click|type|close
//
// A persistent daemon (loopback TCP, idle-exits after 10 minutes) keeps the
// Chromium instance alive between calls. Screenshots are written to disk so
// the agent can `read` the PNG — the model then literally sees the page.

const DAEMON_PORT: u16 = 39731;

fn daemon_addr() -> String {
    let port = std::env::var("BUZZ_BROWSER_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DAEMON_PORT);
    format!("127.0.0.1:{}", port)
}

fn ensure_daemon() -> Result<(), String> {
    if std::net::TcpStream::connect_timeout(
        &daemon_addr().parse().map_err(|e| format!("{}", e))?,
        std::time::Duration::from_millis(300),
    )
    .is_ok()
    {
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    std::process::Command::new(exe)
        .arg("--browser-daemon")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Cannot start the browser daemon: {}", e))?;
    // Wait for the socket to accept (the daemon binds before launching Chrome).
    for _ in 0..80 {
        if std::net::TcpStream::connect_timeout(
            &daemon_addr().parse().map_err(|e| format!("{}", e))?,
            std::time::Duration::from_millis(200),
        )
        .is_ok()
        {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(125));
    }
    Err("The browser daemon did not start".into())
}

fn cli_request(request: &Value) -> Result<String, String> {
    use std::io::{BufRead, BufReader, Write};
    ensure_daemon()?;
    let mut stream = std::net::TcpStream::connect(daemon_addr())
        .map_err(|e| format!("Cannot reach the browser daemon: {}", e))?;
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(120)));
    writeln!(stream, "{}", request).map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(stream)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let response: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(response
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    } else {
        Err(response
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("browser command failed")
            .to_string())
    }
}

/// `--browser-cli <op> [args...]`
pub fn run_cli(args: &[String]) -> i32 {
    let Some(op) = args.first().map(String::as_str) else {
        eprintln!("usage: buzzagent --browser-cli <navigate|screenshot|console|click|type|eval|close> [args]");
        return 2;
    };
    let request = match op {
        "navigate" => json!({ "op": "navigate", "url": args.get(1).cloned().unwrap_or_default() }),
        "screenshot" => json!({
            "op": "screenshot",
            "path": args.get(1).cloned().unwrap_or_else(|| {
                std::env::temp_dir()
                    .join("buzzagent-browser/shot.png")
                    .to_string_lossy()
                    .to_string()
            })
        }),
        "click" => json!({ "op": "click", "selector": args.get(1).cloned().unwrap_or_default() }),
        "type" => json!({
            "op": "type",
            "selector": args.get(1).cloned().unwrap_or_default(),
            "text": args[2..].join(" ")
        }),
        "eval" => json!({ "op": "eval", "expression": args[1..].join(" ") }),
        "console" | "close" => json!({ "op": op }),
        other => {
            eprintln!("unknown browser command: {}", other);
            return 2;
        }
    };
    match cli_request(&request) {
        Ok(text) => {
            println!("{}", text);
            0
        }
        Err(error) => {
            eprintln!("{}", error);
            1
        }
    }
}

/// `--browser-daemon`: serve browser commands on loopback until idle.
pub fn run_daemon() -> i32 {
    use std::io::{BufRead, BufReader, Write};
    let addr = daemon_addr();
    let listener = match std::net::TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(_) => return 0, // another daemon already owns the port
    };
    let _ = listener.set_nonblocking(true);
    let mut browser = McpBrowser::new();
    let mut last_activity = std::time::Instant::now();
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                last_activity = std::time::Instant::now();
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(120)));
                let mut line = String::new();
                let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
                let response = if reader.read_line(&mut line).is_ok() {
                    match serde_json::from_str::<Value>(&line) {
                        Ok(request) => {
                            let op = request.get("op").and_then(|v| v.as_str()).unwrap_or("");
                            let result = match op {
                                "navigate" => browser.navigate(&request),
                                "screenshot" => {
                                    let path = request
                                        .get("path")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("/tmp/buzzagent-browser/shot.png");
                                    browser
                                        .screenshot_to(std::path::Path::new(path))
                                        .map(|p| json!({ "content": [{ "type": "text", "text": p }] }))
                                }
                                "console" => browser.console(),
                                "click" => browser.click(&request),
                                "type" => browser.type_text(&request),
                                "eval" => browser.eval(&request),
                                "close" => browser.close(),
                                other => Err(format!("unknown command: {}", other)),
                            };
                            match result {
                                Ok(value) => {
                                    let text = value
                                        .pointer("/content/0/text")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    json!({ "ok": true, "text": text })
                                }
                                Err(error) => json!({ "ok": false, "error": error }),
                            }
                        }
                        Err(error) => json!({ "ok": false, "error": error.to_string() }),
                    }
                } else {
                    json!({ "ok": false, "error": "empty request" })
                };
                let _ = writeln!(stream, "{}", response);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(200));
                if last_activity.elapsed() > std::time::Duration::from_secs(600) {
                    // Idle: exit and drop the browser so nothing lingers.
                    let _ = browser.close();
                    return 0;
                }
            }
            Err(_) => return 0,
        }
    }
}

/// Entry point when the binary is started as `--mcp-browser`: serve MCP over
/// stdio until stdin closes, then exit.
pub fn run() -> i32 {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let mut browser = McpBrowser::new();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let id = message.get("id").cloned();
        // Notifications (no id) need no response; only `initialized` matters.
        let method = message.get("method").and_then(|m| m.as_str()).unwrap_or("");
        if id.is_none() {
            continue;
        }
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));

        let result: Result<Value, String> = match method {
            "initialize" => Ok(json!({
                "protocolVersion": params
                    .get("protocolVersion")
                    .and_then(|v| v.as_str())
                    .unwrap_or("2024-11-05"),
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "buzzagent-browser", "version": env!("CARGO_PKG_VERSION") }
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": tool_defs() })),
            "tools/call" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                match name {
                    "browser_navigate" => browser.navigate(&args),
                    "browser_screenshot" => browser.screenshot(),
                    "browser_console" => browser.console(),
                    "browser_click" => browser.click(&args),
                    "browser_type" => browser.type_text(&args),
                    "browser_eval" => browser.eval(&args),
                    "browser_close" => browser.close(),
                    other => Err(format!("Unknown tool: {}", other)),
                }
            }
            other => Err(format!("Unknown method: {}", other)),
        };

        let response = match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(message) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{ "type": "text", "text": message }],
                    "isError": true
                }
            }),
        };
        if writeln!(stdout, "{}", response).is_err() {
            break;
        }
        let _ = stdout.flush();
    }
    0
}
