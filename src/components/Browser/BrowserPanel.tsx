import React, { useState } from "react";
import { BrowserToolbar } from "./BrowserToolbar";
import { DevTools } from "./DevTools";
import { ConsoleLogs } from "./ConsoleLogs";
import { invoke } from "../../services/ipc";

interface BackendConsoleEntry {
  level: string;
  message: string;
  timestamp: number;
}

interface ConsoleLog {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: number;
}

function toConsoleLogs(entries: BackendConsoleEntry[]): ConsoleLog[] {
  return entries
    .filter((e): e is BackendConsoleEntry & { level: ConsoleLog["level"] } =>
      ["log", "warn", "error", "info"].includes(e.level)
    )
    .map((e) => ({ level: e.level, message: e.message, timestamp: e.timestamp }));
}

/**
 * Embedded browser: navigation and screenshots run in the backend's headless
 * Chrome; the panel shows the captured screenshot. The agent can drive the
 * same browser session through its own tool set.
 */
export function BrowserPanel() {
  const [url, setUrl] = useState("http://localhost:1420");
  const [isLoading, setIsLoading] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [title, setTitle] = useState("BuzzAgent Browser");
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [showDevTools, setShowDevTools] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNavigate = async (targetUrl: string) => {
    const normalized =
      /^https?:\/\//i.test(targetUrl) ? targetUrl : `http://${targetUrl}`;
    setIsLoading(true);
    setError(null);
    try {
      setTitle(normalized);
      const base64 = await invoke<string>("browser_navigate", { url: normalized });
      setScreenshot(base64);
      setUrl(normalized);
      try {
        const entries = await invoke<BackendConsoleEntry[]>("browser_console_logs");
        setConsoleLogs(toConsoleLogs(entries));
      } catch {
        // Console logs are best-effort.
      }
    } catch (err) {
      setError(String(err));
      setConsoleLogs((prev) => [
        ...prev,
        { level: "error", message: `Navigation error: ${err}`, timestamp: Date.now() },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScreenshot = async () => {
    setIsLoading(true);
    try {
      const base64 = await invoke<string>("browser_screenshot");
      setScreenshot(base64);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="browser-panel">
      <BrowserToolbar
        url={url}
        title={title}
        isLoading={isLoading}
        onNavigate={handleNavigate}
        onRefresh={() => handleNavigate(url)}
        onBack={() => handleNavigate(url)}
        onForward={() => handleNavigate(url)}
        onToggleDevTools={() => setShowDevTools(!showDevTools)}
        onScreenshot={handleScreenshot}
      />

      <div className="browser-content">
        {error && <div className="browser-error">{error}</div>}
        {screenshot ? (
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt={`Screenshot of ${url}`}
            className="browser-screenshot"
          />
        ) : (
          <div className="browser-placeholder">
            <p>Enter a URL and press navigate to load a page.</p>
            <p className="browser-hint">
              Screenshots are captured with headless Chrome by the backend.
            </p>
          </div>
        )}
      </div>

      <ConsoleLogs logs={consoleLogs} onClear={() => setConsoleLogs([])} />

      {showDevTools && <DevTools logs={consoleLogs} />}
    </div>
  );
}
