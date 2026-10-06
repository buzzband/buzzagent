use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Chrome/Chromium-family executables worth probing, in preference order.
/// Firefox is deliberately absent: the panel drives pages over the Chrome
/// DevTools Protocol (CDP), which Firefox does not speak (its remote agent is
/// a different, partially-compatible protocol). A Chromium-based browser is
/// required: Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Yandex…
const CHROMIUM_CANDIDATES: &[&str] = &[
    "google-chrome-stable",
    "google-chrome-beta",
    "google-chrome-dev",
    "google-chrome-unstable",
    "chromium",
    "chromium-browser",
    "chrome",
    "chrome-browser",
    "microsoft-edge-stable",
    "microsoft-edge",
    "msedge",
    "brave-browser",
    "brave-browser-stable",
    "vivaldi",
    "vivaldi-stable",
    "opera",
    "yandex-browser",
];

/// macOS app bundles that do not appear on PATH as bare names.
#[cfg(target_os = "macos")]
const MACOS_BUNDLES: &[&str] = &[
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
    "/Applications/Opera.app/Contents/MacOS/Opera",
];

/// Windows install locations that are not on PATH.
#[cfg(target_os = "windows")]
const WINDOWS_BUNDLES: &[&str] = &[
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Chromium\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Users\\%USERNAME%\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
];

/// Find a usable Chromium-family executable. `CHROME` env var wins (it is what
/// headless_chrome itself honors, so we mirror it for consistent messaging),
/// then PATH candidates, then platform install locations.
fn find_chromium_executable() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("CHROME") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return Some(p);
        }
    }
    for name in CHROMIUM_CANDIDATES {
        if let Ok(path) = which::which(name) {
            return Some(path);
        }
    }
    #[cfg(target_os = "macos")]
    for path in MACOS_BUNDLES {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    #[cfg(target_os = "windows")]
    {
        for path in WINDOWS_BUNDLES {
            let expanded =
                path.replace("%USERNAME%", &std::env::var("USERNAME").unwrap_or_default());
            let p = PathBuf::from(&expanded);
            if p.exists() {
                return Some(p);
            }
        }
    }
    // Well-known locations that are not on every PATH (snap shims on Ubuntu).
    #[cfg(target_os = "linux")]
    for path in ["/snap/bin/chromium", "/snap/bin/chromium-browser"] {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Explain Firefox's presence (and why it cannot help) in discovery reports.
fn firefox_note() -> String {
    match which::which("firefox").or_else(|_| which::which("firefox-esr")) {
        Ok(path) => format!(
            " Firefox was found ({}), but it does not implement the Chrome DevTools Protocol, so it cannot drive this panel.",
            path.display()
        ),
        Err(_) => String::new(),
    }
}

/// Human-facing discovery result for the panel's error message.
pub fn chromium_discovery_report() -> String {
    match find_chromium_executable() {
        Some(path) => format!("found: {}", path.display()),
        None => {
            let names = CHROMIUM_CANDIDATES
                .iter()
                .take(6)
                .copied()
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "no Chromium-family browser found (tried: {}, …).{} Install Chrome, Chromium, Edge or Brave — the Install Chromium button does it for you — or switch the panel to Attach mode and point it at a running Chrome with --remote-debugging-port.",
                names,
                firefox_note()
            )
        }
    }
}

/// Manual install command for the first distro package manager we recognize
/// (shown in the panel and offered as a copyable fallback).
pub fn install_command_hint() -> String {
    for (probe, command) in [
        ("apt-get", "sudo apt-get install -y chromium"),
        ("dnf", "sudo dnf install -y chromium"),
        ("pacman", "sudo pacman -S --needed chromium"),
        ("zypper", "sudo zypper install chromium"),
    ] {
        if which::which(probe).is_ok() {
            return command.to_string();
        }
    }
    "flatpak install -y flathub org.chromium.Chromium".to_string()
}

/// One-click install of an open-source Chromium through the distro package
/// manager so the managed (CDP) panel can drive it. pkexec raises the system
/// authentication prompt; the command is fixed (no user input), so it is safe
/// by construction. Flatpak's Chromium is deliberately not auto-installed:
/// its binary cannot be driven over CDP from outside the sandbox.
pub async fn install_chromium() -> Result<String, String> {
    if let Some(path) = find_chromium_executable() {
        return Ok(format!(
            "A Chromium-family browser is already installed: {}",
            path.display()
        ));
    }
    let (probe, args): (&str, Vec<&str>) = if which::which("apt-get").is_ok() {
        ("apt-get", vec!["install", "-y", "chromium"])
    } else if which::which("dnf").is_ok() {
        ("dnf", vec!["install", "-y", "chromium"])
    } else if which::which("pacman").is_ok() {
        ("pacman", vec!["-S", "--needed", "--noconfirm", "chromium"])
    } else if which::which("zypper").is_ok() {
        ("zypper", vec!["--non-interactive", "install", "chromium"])
    } else {
        return Err(format!(
            "No supported package manager found (apt/dnf/pacman/zypper). Install Chromium manually: {}",
            install_command_hint()
        ));
    };
    let status = tokio::process::Command::new("pkexec")
        .arg(probe)
        .args(&args)
        .status()
        .await
        .map_err(|e| {
            format!(
                "Could not run pkexec ({}). Install manually: {}",
                e,
                install_command_hint()
            )
        })?;
    if !status.success() {
        return Err(format!(
            "Install did not complete (exit {}). You can run it manually: {}",
            status.code().unwrap_or(-1),
            install_command_hint()
        ));
    }
    match find_chromium_executable() {
        Some(path) => Ok(format!("Chromium installed: {}", path.display())),
        None => Err(format!(
            "Install finished, but no Chromium executable is on PATH — restart BuzzAgent so PATH changes are picked up. Manual check: {}",
            install_command_hint()
        )),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BrowserMode {
    Managed,
    Attach { cdp_url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConfig {
    pub mode: BrowserMode,
    pub width: u32,
    pub height: u32,
    /// Explicit executable override; None = probe the system (CHROME env, PATH
    /// candidates, platform install locations).
    pub executable: Option<PathBuf>,
}

impl Default for BrowserConfig {
    fn default() -> Self {
        BrowserConfig {
            mode: BrowserMode::Managed,
            width: 1280,
            height: 800,
            executable: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleEntry {
    pub level: String,
    pub message: String,
    pub timestamp: u64,
}

type SharedBrowser = Arc<Mutex<Option<headless_chrome::Browser>>>;

/// Browser controller backed by a locally installed Chrome/Chromium in
/// headless mode. A single browser instance is reused across navigations.
pub struct BrowserManager {
    config: BrowserConfig,
    console_logs: Vec<ConsoleEntry>,
    browser: SharedBrowser,
}

impl BrowserManager {
    pub fn new() -> Self {
        BrowserManager {
            config: BrowserConfig::default(),
            console_logs: Vec::new(),
            browser: Arc::new(Mutex::new(None)),
        }
    }

    pub fn with_config(config: BrowserConfig) -> Self {
        BrowserManager {
            config,
            console_logs: Vec::new(),
            browser: Arc::new(Mutex::new(None)),
        }
    }

    async fn get_or_launch(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, Option<headless_chrome::Browser>>, String> {
        let mut guard = self.browser.lock().await;
        if guard.is_none() {
            let browser = match &self.config.mode {
                BrowserMode::Managed => {
                    // Resolve the executable ourselves instead of letting the
                    // library fail with its bare "is it installed on PATH?":
                    // our probe covers more names and, crucially, can say in
                    // the error *what the user should install*.
                    let executable = self
                        .config
                        .executable
                        .clone()
                        .or_else(find_chromium_executable)
                        .ok_or_else(|| {
                            format!(
                                "No Chromium-family browser found. Firefox does not work here (this panel speaks the Chrome DevTools Protocol). Install Chrome, Chromium, Edge or Brave — or use Attach mode with a running Chrome. Details: {}",
                                chromium_discovery_report()
                            )
                        })?;
                    let options = headless_chrome::LaunchOptionsBuilder::default()
                        .headless(true)
                        .path(Some(executable))
                        .window_size(Some((self.config.width, self.config.height)))
                        .build()
                        .map_err(|e| format!("Browser launch options error: {}", e))?;
                    headless_chrome::Browser::new(options).map_err(|e| {
                        format!(
                            "Failed to launch the browser ({}): {}",
                            chromium_discovery_report(),
                            e
                        )
                    })?
                }
                BrowserMode::Attach { cdp_url } => {
                    let ws_url = resolve_cdp_ws_url(cdp_url).await?;
                    headless_chrome::Browser::connect(ws_url)
                        .map_err(|e| format!("Failed to attach to Chrome at {}: {}", cdp_url, e))?
                }
            };
            *guard = Some(browser);
        }
        Ok(guard)
    }

    pub fn set_config(&mut self, config: BrowserConfig) {
        self.config = config;
    }

    /// Navigate the headless browser to `url` and wait for the page to load.
    pub async fn navigate(&mut self, url: &str) -> Result<(), String> {
        {
            let guard = self.get_or_launch().await?;
            let browser = guard.as_ref().unwrap();
            let tab = browser
                .new_tab()
                .map_err(|e| format!("Failed to open tab: {}", e))?;
            tab.navigate_to(url)
                .map_err(|e| format!("Navigation failed: {}", e))?;
            tab.wait_until_navigated()
                .map_err(|e| format!("Page load failed: {}", e))?;
        }
        self.console_logs.push(ConsoleEntry {
            level: "info".into(),
            message: format!("Navigated to {}", url),
            timestamp: now_ms(),
        });
        Ok(())
    }

    /// Capture a PNG screenshot of the current page, returned as base64.
    pub async fn screenshot(&self) -> Result<String, String> {
        let guard = self.browser.lock().await;
        let browser = guard
            .as_ref()
            .ok_or_else(|| "Browser not started — navigate first".to_string())?;
        let tab = current_tab(browser)?;
        let png = tab
            .capture_screenshot(
                headless_chrome::protocol::cdp::Page::CaptureScreenshotFormatOption::Png,
                None,
                None,
                true,
            )
            .map_err(|e| format!("Screenshot failed: {}", e))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(png))
    }

    /// Click an element matched by CSS selector.
    pub async fn click(&mut self, selector: &str) -> Result<(), String> {
        let guard = self.get_or_launch().await?;
        let browser = guard.as_ref().unwrap();
        let tab = current_tab(browser)?;
        tab.wait_for_element(selector)
            .map_err(|e| format!("Element '{}' not found: {}", selector, e))?;
        tab.find_element(selector)
            .map_err(|e| e.to_string())?
            .click()
            .map_err(|e| format!("Click failed: {}", e))?;
        Ok(())
    }

    /// Type text into the focused element; focuses the element matched by
    /// CSS selector first.
    pub async fn type_text(&mut self, selector: &str, text: &str) -> Result<(), String> {
        let guard = self.get_or_launch().await?;
        let browser = guard.as_ref().unwrap();
        let tab = current_tab(browser)?;
        tab.wait_for_element(selector)
            .map_err(|e| format!("Element '{}' not found: {}", selector, e))?;
        let element = tab.find_element(selector).map_err(|e| e.to_string())?;
        element
            .click()
            .map_err(|e| format!("Focus failed: {}", e))?;
        tab.type_str(text)
            .map_err(|e| format!("Typing failed: {}", e))?;
        Ok(())
    }

    pub fn get_console_logs(&self) -> Vec<ConsoleEntry> {
        self.console_logs.clone()
    }

    pub fn add_console_entry(&mut self, entry: ConsoleEntry) {
        self.console_logs.push(entry);
    }
}

async fn resolve_cdp_ws_url(cdp_url: &str) -> Result<String, String> {
    if cdp_url.starts_with("ws://") || cdp_url.starts_with("wss://") {
        return Ok(cdp_url.to_string());
    }
    let base = cdp_url.trim_end_matches('/');
    let endpoint = format!("{}/json/version", base);
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Chrome CDP at {}: {}", endpoint, e))?;

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse CDP version response: {}", e))?;

    json.get("webSocketDebuggerUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "CDP response missing webSocketDebuggerUrl".to_string())
}

/// Most recently opened tab (the one the last navigate() created).
fn current_tab(browser: &headless_chrome::Browser) -> Result<Arc<headless_chrome::Tab>, String> {
    browser
        .get_tabs()
        .lock()
        .map_err(|_| "Browser tab list poisoned".to_string())?
        .last()
        .cloned()
        .ok_or_else(|| "No open tab".to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_managed() {
        let cfg = BrowserConfig::default();
        assert!(matches!(cfg.mode, BrowserMode::Managed));
        assert_eq!(cfg.width, 1280);
    }

    #[test]
    fn install_hint_names_chromium() {
        assert!(install_command_hint().contains("chromium"));
    }

    #[test]
    fn console_entries_accumulate() {
        let mut mgr = BrowserManager::new();
        mgr.add_console_entry(ConsoleEntry {
            level: "error".into(),
            message: "boom".into(),
            timestamp: 1,
        });
        assert_eq!(mgr.get_console_logs().len(), 1);
    }
}
