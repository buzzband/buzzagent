import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import {
  ArrowRight,
  Copy,
  Download,
  Globe,
  Loader2,
  MousePointer,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  RefreshCw,
  Terminal,
  Type,
} from "lucide-react";
import { copyText } from "../ErrorBoundary";

interface ConsoleEntry {
  level: string;
  message: string;
  timestamp: number;
}

/** Below this width the tools column would leave no room for the preview. */
const TOOLS_AUTO_COLLAPSE_PX = 720;

interface ChangedFile {
  path: string;
  status: string;
}

/** Files a browser can actually render straight off disk. */
const VIEWABLE = [".html", ".htm", ".svg"];

export function BrowserPanel() {
  const { projectDir, busy } = useApp(
    useShallow((s) => ({ projectDir: s.projectDir, busy: s.busy }))
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const [toolsOpen, setToolsOpen] = useState(true);
  const userToggledTools = useRef(false);
  const [url, setUrl] = useState("http://localhost:3000");
  const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<ConsoleEntry[]>([]);
  const [mode, setMode] = useState<"managed" | "attach">("managed");
  const [cdpUrl, setCdpUrl] = useState("http://127.0.0.1:9222");
  /** One-time discovery report for the empty state (which browsers did we see). */
  const [discovery, setDiscovery] = useState<string | null>(null);
  /** One-click open-source Chromium install (distro package manager + pkexec). */
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [installHint, setInstallHint] = useState<string | null>(null);

  // Interaction controls
  const [clickSelector, setClickSelector] = useState("");
  const [typeSelector, setTypeSelector] = useState("");
  const [typeText, setTypeText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const viewableFiles = changedFiles
    .filter((f) => f.status !== "deleted")
    .filter((f) => VIEWABLE.some((ext) => f.path.toLowerCase().endsWith(ext)))
    .slice(0, 8);

  const fetchLogs = async () => {
    try {
      const entries = await invoke<ConsoleEntry[]>("browser_console_logs");
      setLogs(entries);
    } catch {
      // Ignored if browser not started yet
    }
  };

  const handleNavigate = async (targetUrl = url) => {
    if (!targetUrl.trim()) return;
    // Local files the agent just created open straight off disk.
    if (!/^\w+:\/\//.test(targetUrl)) {
      const absolute = targetUrl.startsWith("/")
        ? targetUrl
        : `${projectDir?.replace(/\/+$/, "")}/${targetUrl}`;
      targetUrl = `file://${absolute}`;
    }
    setLoading(true);
    setError(null);
    try {
      const base64Png = await invoke<string>("browser_navigate", { url: targetUrl.trim() });
      setScreenshot(base64Png);
      await fetchLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshot = async () => {
    setLoading(true);
    setError(null);
    try {
      const base64Png = await invoke<string>("browser_screenshot");
      setScreenshot(base64Png);
      await fetchLogs();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = async (newMode: "managed" | "attach") => {
    setMode(newMode);
    try {
      await invoke("browser_set_mode", {
        attachUrl: newMode === "attach" ? cdpUrl : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClick = async () => {
    if (!clickSelector.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      await invoke("browser_click", { selector: clickSelector.trim() });
      await handleScreenshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  };

  const handleType = async () => {
    if (!typeSelector.trim() || !typeText) return;
    setActionLoading(true);
    setError(null);
    try {
      await invoke("browser_type", {
        selector: typeSelector.trim(),
        text: typeText,
      });
      await handleScreenshot();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
    // Fetch once so the empty state can explain what is missing *before* the
    // first failed navigate: which Chromium-family browser was found (or not).
    invoke<string>("browser_discovery_report")
      .then((report) => {
        setDiscovery(report);
        // No browser: prepare the manual-install fallback command too.
        if (!report.startsWith("found:")) {
          invoke<string>("browser_install_hint")
            .then(setInstallHint)
            .catch(() => setInstallHint(null));
        }
      })
      .catch(() => setDiscovery(null));
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    setInstallMsg(null);
    try {
      const msg = await invoke<string>("browser_install_chromium");
      setInstallMsg(msg);
      // Re-run discovery so the empty state flips to "browser in use".
      await invoke<string>("browser_discovery_report")
        .then(setDiscovery)
        .catch(() => undefined);
    } catch (e) {
      setInstallMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  };

  // Explorer right-click "Open in browser panel": open the file straight off
  // disk. The event arrives right after the browser tab is opened, so store
  // the path in the URL bar too — the user sees where the page came from.
  useEffect(() => {
    const open = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (!path) return;
      setUrl(path);
      void handleNavigate(path);
    };
    window.addEventListener("buzzagent:browser-open-file", open);
    return () => window.removeEventListener("buzzagent:browser-open-file", open);
  }, // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const loadChangedFiles = useCallback(async () => {
    if (!projectDir) return;
    try {
      const report = await invoke<{ repo: boolean; changes: ChangedFile[] }>("git_changes", {
        projectDir,
      });
      setChangedFiles(report.changes);
    } catch {
      // The diff panel surfaces git errors; this list is a convenience.
    }
  }, [projectDir]);

  // The point of the loop: agent wrote index.html -> one click shows it.
  useEffect(() => {
    if (!busy) void loadChangedFiles();
  }, [busy, loadChangedFiles]);

  /**
   * Collapse the tools column automatically when the panel is narrow, e.g. in
   * split view next to the chat. A manual toggle wins from then on, so the
   * layout never fights the user.
   */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (userToggledTools.current || width === 0) return;
      setToolsOpen(width >= TOOLS_AUTO_COLLAPSE_PX);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="flex h-full flex-col bg-[var(--bg-base)]">
      {/* Top navigation bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5">
        <div className="flex items-center gap-1 rounded-md bg-[var(--bg-raised)] p-0.5 text-2xs">
          <button
            type="button"
            onClick={() => void handleModeChange("managed")}
            className={`rounded-xs px-2 py-1 font-medium transition-colors ${
              mode === "managed"
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
            }`}
          >
            Managed Headless
          </button>
          <button
            type="button"
            onClick={() => void handleModeChange("attach")}
            className={`rounded-xs px-2 py-1 font-medium transition-colors ${
              mode === "attach"
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
            }`}
          >
            Attach Chrome (CDP)
          </button>
        </div>

        {mode === "attach" && (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={cdpUrl}
              onChange={(e) => setCdpUrl(e.target.value)}
              placeholder="http://127.0.0.1:9222"
              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)]"
            />
            <button
              type="button"
              onClick={() => void handleModeChange("attach")}
              className="rounded-md border border-[var(--border-default)] px-2 py-1 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
            >
              Connect
            </button>
          </div>
        )}

        <div className="flex min-w-[280px] flex-1 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1 focus-within:border-[var(--accent)]">
          <Globe size={14} className="shrink-0 text-[var(--fg-muted)]" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleNavigate();
            }}
            placeholder="http://localhost:3000"
            className="w-full bg-transparent text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => void handleNavigate()}
          disabled={loading}
          className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
          Navigate
        </button>

        <button
          type="button"
          onClick={() => void handleScreenshot()}
          disabled={loading}
          title="Capture latest screenshot"
          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-4 mt-2 flex items-start gap-2 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]"
        >
          <span className="selectable min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => void copyText(error)}
            title="Copy error"
            aria-label="Copy error"
            className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
          >
            <Copy size={12} />
          </button>
        </div>
      )}

      {/* Main Viewport & Tools */}
      <div className="flex min-h-0 flex-1">
        {/* Left/Center: Viewport preview */}
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center overflow-auto p-3">
          {screenshot ? (
            <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-md">
              <img
                src={`data:image/png;base64,${screenshot}`}
                alt="Browser Viewport"
                className="max-h-[60vh] max-w-full object-contain"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--bg-raised)] text-[var(--fg-muted)]">
                <Globe size={24} />
              </div>
              <h3 className="mt-3 text-sm font-medium text-[var(--fg-primary)]">
                No active page preview
              </h3>
              <p className="mt-1 max-w-sm text-xs text-[var(--fg-secondary)]">
                Enter a URL (e.g. your local dev server <code>http://localhost:3000</code>) and
                click Navigate. The agent uses this browser to inspect running apps.
              </p>
              {mode === "attach" && (
                <div className="mt-4 flex items-center gap-2 rounded-md bg-[var(--accent-subtle)] px-3 py-1.5 text-2xs text-[var(--accent)]">
                  <Radio size={12} className="animate-pulse" />
                  CDP Attach active: connects to real Chrome profile
                </div>
              )}
              {mode === "managed" && discovery && (
                <div
                  className={`mt-4 max-w-md rounded-md px-3 py-1.5 text-left text-2xs ${
                    discovery.startsWith("found:")
                      ? "bg-[var(--bg-raised)] text-[var(--fg-muted)]"
                      : "bg-[var(--warning-subtle,rgba(234,179,8,0.12))] text-[var(--warning,#eab308)]"
                  }`}
                >
                  <span className="selectable block">
                    {discovery.startsWith("found:") ? (
                      <>Browser in use: <code className="font-mono">{discovery.replace("found: ", "")}</code></>
                    ) : (
                      discovery
                    )}
                  </span>
                  {!discovery.startsWith("found:") && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleInstall()}
                        disabled={installing}
                        title="Installs the open-source Chromium through your distro's package manager (the OS asks for your password)"
                        className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1 font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        {installing ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        Install Chromium (open source)
                      </button>
                      {installHint && (
                        <button
                          type="button"
                          onClick={() => void copyText(installHint)}
                          title="Copy the manual install command"
                          className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 transition-colors hover:text-[var(--fg-primary)]"
                        >
                          <Copy size={11} />
                          Copy command
                        </button>
                      )}
                    </div>
                  )}
                  {installMsg && (
                    <p className="selectable mt-2 break-words">{installMsg}</p>
                  )}
                </div>
              )}

              {viewableFiles.length > 0 && (
                <div className="mt-5 w-full max-w-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-left">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                    New files to preview
                  </p>
                  <div className="mt-2 space-y-1">
                    {viewableFiles.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => {
                          setUrl(file.path);
                          void handleNavigate(file.path);
                        }}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 font-mono text-2xs text-[var(--accent)] transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <Globe size={11} />
                        <span className="truncate">{file.path}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/*
         * Right side: developer controls & CDP console.
         *
         * Collapsible because at split-view widths a fixed 320px column left
         * almost nothing for the page preview. Collapsed by default when the
         * panel is narrow (see `tools` initial state).
         */}
        {!toolsOpen ? (
          <button
            type="button"
            onClick={() => {
              userToggledTools.current = true;
              setToolsOpen(true);
            }}
            title="Show interaction tools and console"
            className="flex w-9 shrink-0 flex-col items-center gap-2 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] py-3 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
          >
            <PanelRightOpen size={14} />
            <span className="text-2xs [writing-mode:vertical-rl]">Tools</span>
            {logs.length > 0 && (
              <span className="rounded bg-[var(--bg-raised)] px-1 text-2xs">{logs.length}</span>
            )}
          </button>
        ) : (
        <div className="flex w-72 shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {/* Interaction widget */}
          <div className="border-b border-[var(--border-subtle)] p-3">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                <MousePointer size={12} />
                Quick Interaction
              </h4>
              <button
                type="button"
                onClick={() => {
                  userToggledTools.current = true;
                  setToolsOpen(false);
                }}
                title="Hide tools panel"
                className="rounded p-0.5 text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
              >
                <PanelRightClose size={13} />
              </button>
            </div>

            {/* Click */}
            <div className="mt-2 flex gap-1">
              <input
                type="text"
                value={clickSelector}
                onChange={(e) => setClickSelector(e.target.value)}
                placeholder="button.submit, #login"
                className="min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]"
              />
              <button
                type="button"
                onClick={() => void handleClick()}
                disabled={actionLoading || !clickSelector.trim()}
                className="rounded bg-[var(--bg-raised)] px-2 py-1 text-2xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40"
              >
                Click
              </button>
            </div>

            {/* Type */}
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-1 text-2xs text-[var(--fg-muted)]">
                <Type size={11} />
                <span>Type text into element:</span>
              </div>
              <input
                type="text"
                value={typeSelector}
                onChange={(e) => setTypeSelector(e.target.value)}
                placeholder="input[name='email']"
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]"
              />
              <div className="flex gap-1">
                <input
                  type="text"
                  value={typeText}
                  onChange={(e) => setTypeText(e.target.value)}
                  placeholder="text to type…"
                  className="min-w-0 flex-1 rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 text-2xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)]"
                />
                <button
                  type="button"
                  onClick={() => void handleType()}
                  disabled={actionLoading || !typeSelector.trim() || !typeText}
                  className="rounded bg-[var(--bg-raised)] px-2 py-1 text-2xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40"
                >
                  Type
                </button>
              </div>
            </div>
          </div>

          {/* Console logs header */}
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
              <Terminal size={12} />
              Console Logs
            </span>
            <span className="text-2xs text-[var(--fg-muted)]">{logs.length} entries</span>
          </div>

          {/* Console logs list */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-2xs">
            {logs.length === 0 ? (
              <p className="p-2 text-center text-[var(--fg-muted)]">No console entries recorded.</p>
            ) : (
              <div className="space-y-1">
                {logs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`selectable rounded px-1.5 py-0.5 leading-snug ${
                      log.level === "error"
                        ? "bg-[var(--danger-subtle)] text-[var(--danger)]"
                        : log.level === "warn"
                          ? "bg-[var(--warning-subtle)] text-[var(--warning)]"
                          : "text-[var(--fg-secondary)]"
                    }`}
                  >
                    <span className="opacity-60">[{log.level}] </span>
                    <span>{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
