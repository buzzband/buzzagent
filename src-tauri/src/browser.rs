use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserConfig {
    pub headless: bool,
    pub width: u32,
    pub height: u32,
}

impl Default for BrowserConfig {
    fn default() -> Self {
        BrowserConfig {
            headless: true,
            width: 1280,
            height: 800,
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

    async fn get_or_launch(&self) -> Result<tokio::sync::MutexGuard<'_, Option<headless_chrome::Browser>>, String> {
        let mut guard = self.browser.lock().await;
        if guard.is_none() {
            let options = headless_chrome::LaunchOptionsBuilder::default()
                .headless(true)
                .window_size(Some((self.config.width, self.config.height)))
                .build()
                .map_err(|e| format!("Browser launch options error: {}", e))?;
            let browser = headless_chrome::Browser::new(options).map_err(|e| {
                format!(
                    "Failed to launch Chrome/Chromium (is it installed on PATH?): {}",
                    e
                )
            })?;
            *guard = Some(browser);
        }
        Ok(guard)
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
        element.click().map_err(|e| format!("Focus failed: {}", e))?;
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
    fn default_config_is_headless() {
        let cfg = BrowserConfig::default();
        assert!(cfg.headless);
        assert_eq!(cfg.width, 1280);
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
