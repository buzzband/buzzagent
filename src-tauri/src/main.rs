mod agent;
mod browser;
mod git;
mod mcp;

use serde_json::Value;
use tauri::State;
use tokio::sync::Mutex as AsyncMutex;

use agent::AgentManager;
use browser::BrowserManager;
use git::GitManager;
use mcp::McpManager;

pub struct AppState {
    pub agent: AsyncMutex<AgentManager>,
    pub browser: AsyncMutex<BrowserManager>,
    pub git: AsyncMutex<GitManager>,
    pub mcp: AsyncMutex<McpManager>,
    /// Last project path chosen/used; persisted across commands in-session.
    pub project_path: AsyncMutex<Option<String>>,
}

#[tauri::command]
fn greet(name: String) -> String {
    format!("BuzzAgent is ready. Hello, {}!", name)
}

#[tauri::command]
async fn start_agent(
    window: tauri::Window,
    state: State<'_, AppState>,
    config: agent::AgentConfig,
    task: String,
) -> Result<(), String> {
    {
        let mut project = state.project_path.lock().await;
        *project = Some(config.project_path.clone());
    }
    {
        let mut git = state.git.lock().await;
        git.set_project(std::path::PathBuf::from(&config.project_path));
    }
    let mut agent = state.agent.lock().await;
    agent.start(config, task, window).await
}

#[tauri::command]
async fn send_message(
    window: tauri::Window,
    state: State<'_, AppState>,
    message: String,
) -> Result<(), String> {
    let mut agent = state.agent.lock().await;
    agent.send_message(&message, window).await
}

#[tauri::command]
async fn stop_agent(state: State<'_, AppState>) -> Result<(), String> {
    let mut agent = state.agent.lock().await;
    agent.stop()
}

#[tauri::command]
async fn agent_is_running(state: State<'_, AppState>) -> Result<bool, String> {
    let agent = state.agent.lock().await;
    Ok(agent.is_running())
}

#[tauri::command]
async fn accept_diff(
    state: State<'_, AppState>,
    file_path: String,
    hunk_index: Option<usize>,
) -> Result<(), String> {
    let mut agent = state.agent.lock().await;
    agent.accept_diff(&file_path, hunk_index)
}

#[tauri::command]
async fn reject_diff(state: State<'_, AppState>, file_path: String) -> Result<(), String> {
    let mut agent = state.agent.lock().await;
    agent.reject_diff(&file_path)
}

#[tauri::command]
async fn get_project_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let project = state.project_path.lock().await;
    Ok(project.clone())
}

#[tauri::command]
async fn set_api_key(
    state: State<'_, AppState>,
    provider: String,
    #[allow(unused_variables)] api_key: String,
) -> Result<(), String> {
    // Keys live in the frontend store (BYOK). The backend reads them from the
    // agent config when a task starts; this command exists for parity with the
    // UI and future secure key storage.
    let _ = (provider, state);
    Ok(())
}

/// Read a text file (used by the file explorer and agent UI).
#[tauri::command]
async fn read_file(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let project = state.project_path.lock().await;
    let project_dir = project.clone().unwrap_or_else(|| ".".to_string());
    let full = std::path::Path::new(&project_dir).join(&path);
    // Only allow reads inside the project directory.
    if !full.starts_with(&project_dir) {
        return Err("Path escapes project directory".into());
    }
    std::fs::read_to_string(full).map_err(|e| e.to_string())
}

/// Write a text file directly (bypasses the agent's staged-diff flow — used
/// by the editor panel for manual edits).
#[tauri::command]
async fn write_file(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    let project = state.project_path.lock().await;
    let project_dir = project.clone().unwrap_or_else(|| ".".to_string());
    let full = std::path::Path::new(&project_dir).join(&path);
    if !full.starts_with(&project_dir) {
        return Err("Path escapes project directory".into());
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(full, content).map_err(|e| e.to_string())
}

/// List project files up to a small depth (for the file explorer).
#[tauri::command]
async fn list_files(state: State<'_, AppState>, path: Option<String>) -> Result<Vec<String>, String> {
    let project = state.project_path.lock().await;
    let project_dir = project.clone().unwrap_or_else(|| ".".to_string());
    let root = std::path::Path::new(&project_dir).join(path.unwrap_or_default());
    let mut out = Vec::new();
    let mut stack = vec![(root.clone(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 3 || out.len() > 2000 {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            let rel = entry
                .path()
                .strip_prefix(&root)
                .unwrap_or(entry.path().as_path())
                .to_string_lossy()
                .to_string();
            if entry.path().is_dir() {
                out.push(format!("{}/", rel));
                stack.push((entry.path(), depth + 1));
            } else {
                out.push(rel);
            }
        }
    }
    out.sort();
    Ok(out)
}

/// Run a shell command in the project directory and return its output.
#[tauri::command]
async fn shell_exec(state: State<'_, AppState>, command: String) -> Result<Value, String> {
    let project = state.project_path.lock().await;
    let project_dir = project.clone().unwrap_or_else(|| ".".to_string());
    let output = tokio::process::Command::new(if cfg!(windows) { "cmd" } else { "sh" })
        .arg(if cfg!(windows) { "/C" } else { "-c" })
        .arg(&command)
        .current_dir(&project_dir)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "stdout": String::from_utf8_lossy(&output.stdout),
        "stderr": String::from_utf8_lossy(&output.stderr),
        "code": output.status.code(),
    }))
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

#[tauri::command]
async fn git_diff(state: State<'_, AppState>) -> Result<Vec<git::DiffEntry>, String> {
    let git = state.git.lock().await;
    git.pending_diffs()
}

#[tauri::command]
async fn git_status(state: State<'_, AppState>) -> Result<String, String> {
    let git = state.git.lock().await;
    git.status()
}

#[tauri::command]
async fn git_worktree_create(
    state: State<'_, AppState>,
    branch: String,
) -> Result<String, String> {
    let git = state.git.lock().await;
    git.create_worktree(&branch)
}

#[tauri::command]
async fn mcp_list_servers(
    state: State<'_, AppState>,
) -> Result<Vec<mcp::McpServerStatus>, String> {
    let mcp = state.mcp.lock().await;
    Ok(mcp.list_servers())
}

#[tauri::command]
async fn mcp_add_server(
    state: State<'_, AppState>,
    config: mcp::McpServerConfig,
) -> Result<(), String> {
    let mut mcp = state.mcp.lock().await;
    mcp.add_server(config).await
}

#[tauri::command]
async fn mcp_remove_server(state: State<'_, AppState>, server: String) -> Result<(), String> {
    let mut mcp = state.mcp.lock().await;
    mcp.remove_server(&server).await
}

#[tauri::command]
async fn mcp_disconnect(state: State<'_, AppState>, server: String) -> Result<(), String> {
    let mut mcp = state.mcp.lock().await;
    mcp.disconnect_server(&server).await;
    Ok(())
}

#[tauri::command]
async fn mcp_list_tools(
    state: State<'_, AppState>,
    server: String,
) -> Result<Vec<mcp::McpTool>, String> {
    let mut mcp = state.mcp.lock().await;
    mcp.list_tools(&server).await
}

#[tauri::command]
async fn mcp_call_tool(
    state: State<'_, AppState>,
    server: String,
    tool: String,
    args: Value,
) -> Result<Value, String> {
    let mut mcp = state.mcp.lock().await;
    mcp.call_tool(&server, &tool, args).await
}

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .manage(AppState {
            agent: AsyncMutex::new(AgentManager::new()),
            browser: AsyncMutex::new(BrowserManager::new()),
            git: AsyncMutex::new(GitManager::new()),
            mcp: AsyncMutex::new(McpManager::new()),
            project_path: AsyncMutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            start_agent,
            send_message,
            stop_agent,
            agent_is_running,
            accept_diff,
            reject_diff,
            get_project_path,
            set_api_key,
            read_file,
            write_file,
            list_files,
            shell_exec,
            browser_navigate,
            browser_screenshot,
            browser_click,
            browser_type,
            browser_console_logs,
            git_diff,
            git_status,
            git_worktree_create,
            mcp_list_servers,
            mcp_add_server,
            mcp_remove_server,
            mcp_disconnect,
            mcp_list_tools,
            mcp_call_tool,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
