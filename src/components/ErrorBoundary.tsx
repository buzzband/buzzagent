import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Why this exists: without a boundary, any runtime exception during a React
 * render unmounts the whole tree — the window becomes blank white with zero
 * text (the "white screen" bug report). React logs to console only, and a
 * packaged webview has no devtools open by default, so the user saw nothing
 * to report. This boundary guarantees the failure is visible, copyable and
 * recoverable without touching a terminal.
 */

/** Persisted across reloads so a crash that kills the render is still
 * diagnosable after the user restarts, and so window-level failures (which
 * bypass React) surface on the next launch too. */
export interface CrashReport {
  message: string;
  stack?: string;
  componentStack?: string;
  kind: "render" | "window" | "unhandledrejection";
  at: number;
}

/**
 * Which exact download is running. Every rebuild of a version ships under
 * the same file name, so "I still see the bug" needs the build id, not the
 * version: 0.1.13 was rebuilt several times and each had different fixes.
 */
declare const __BUILD_ID__: string;
declare const __APP_VERSION__: string;

export function buildId(): string {
  try {
    return typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "unknown";
  } catch {
    return "unknown";
  }
}

/** App version from package.json, injected at build time (Settings → About). */
export function appVersion(): string {
  try {
    return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  } catch {
    return "unknown";
  }
}

function buildIdLine(): string {
  return `Build: ${buildId()}`;
}

const CRASH_KEY = "buzzagent.lastCrash";
const CRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Save a crash report; storage failures must never mask the crash itself. */
export function saveCrashReport(report: CrashReport): void {
  try {
    localStorage.setItem(CRASH_KEY, JSON.stringify(report));
  } catch {
    // Private mode / storage full — the on-screen panel still shows it.
  }
}

export function loadCrashReport(): CrashReport | null {
  try {
    const raw = localStorage.getItem(CRASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CrashReport;
    if (!parsed || typeof parsed.message !== "string") return null;
    if (Date.now() - (parsed.at ?? 0) > CRASH_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCrashReport(): void {
  try {
    localStorage.removeItem(CRASH_KEY);
  } catch {
    // Nothing to do — the report simply stays unread.
  }
}

/**
 * Show the previous run's crash report once at startup, then clear it.
 *
 * The report was already mirrored to debug.log when it happened, so keeping
 * it in localStorage would only nag the user on every launch for a week —
 * especially right after they install the fixed build.
 */
export function surfacePreviousCrash(): void {
  const previous = loadCrashReport();
  if (!previous) return;
  clearCrashReport();
  try {
    showWindowErrorOverlay({
      ...previous,
      message: `Last run ended with: ${previous.message}`,
    });
  } catch {
    // Cosmetic only — the report is cleared either way.
  }
}

/**
 * Copy `text` to the clipboard, preferring the Tauri command (the desktop
 * webview's async-clipboard API can refuse without any user-visible error).
 * Resolves true when something actually worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const inTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (inTauri) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("clipboard_write_text", { text });
      return true;
    }
  } catch {
    // Fall through to the web API.
  }
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Full diagnostic text for the clipboard / manual copy. */
export function formatCrash(report: CrashReport): string {
  return [
    `BuzzAgent crash (${report.kind}) at ${new Date(report.at).toISOString()}`,
    buildIdLine(),
    `Message: ${report.message}`,
    report.stack ? `\nStack:\n${report.stack}` : "",
    report.componentStack ? `\nComponent stack:\n${report.componentStack}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Mirror reports into the desktop's debug.log (via the `ui_log` command) so
 * a packaged app without devtools still leaves evidence on disk.
 * Fire-and-forget: the report must not depend on the bridge being healthy —
 * it may be the reason we are crashing.
 */
export function reportToBackend(report: CrashReport): void {
  try {
    const inTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!inTauri) return;
    const text = formatCrash(report);
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("ui_log", { level: "error", message: text }))
      .catch(() => undefined);
  } catch {
    // Never let logging itself throw.
  }
}

/**
 * Diagnostic breadcrumb for scripted/user support runs: records UI phase
 * transitions into debug.log, so "white screen at project open" comes with
 * a last-known-phase stamp instead of nothing. Best-effort by design.
 */
export function logPhase(name: string): void {
  try {
    const inTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!inTauri) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("ui_log", { level: "info", message: `phase: ${name}` }))
      .catch(() => undefined);
  } catch {
    // Best effort only.
  }
}

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Top-level boundary. Renders the app until a render-phase error happens,
 * then a self-contained recovery screen: what broke, where, and three ways
 * out (reload, reset UI state, copy diagnostics).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Remember it for this screen and for the next launch.
    const report: CrashReport = {
      message: error?.message || String(error),
      stack: error?.stack,
      componentStack: info?.componentStack ?? undefined,
      kind: "render",
      at: Date.now(),
    };
    saveCrashReport(report);
    reportToBackend(report);
    this.setState({ info });
  }

  private resetAndReload = () => {
    // The most common blank-screen cause is poisoned persisted UI state
    // (layout, zoom, caches) — clearing it is the one-shot repair a user can
    // do without us. Only our own keys are touched.
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("buzzagent.")) doomed.push(key);
      }
      doomed.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Storage unavailable — reload alone may still fix it.
    }
    window.location.reload();
  };

  private copyDiagnostics = () => {
    const { error, info } = this.state;
    if (!error) return;
    const text = formatCrash({
      message: error.message || String(error),
      stack: error.stack,
      componentStack: info?.componentStack ?? undefined,
      kind: "render",
      at: Date.now(),
    });
    void copyText(text).then((ok) => {
      if (!ok) alert("Copy failed — please select the error text manually.");
    });
  };

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--bg-base)] p-6">
        <div className="w-full max-w-xl rounded-lg border border-[var(--danger)]/50 bg-[var(--bg-surface)] p-4">
          <h1 className="flex items-baseline justify-between text-sm font-semibold text-[var(--danger)]">
            <span>Something went wrong</span>
            <span className="font-mono text-2xs font-normal text-[var(--fg-muted)]">
              build {buildId()}
            </span>
          </h1>
          <p className="mt-1 text-xs text-[var(--fg-secondary)]">
            The interface hit an unexpected error and had to stop rendering.
            The details below help identify the cause.
          </p>

          <pre className="selectable mt-3 max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-2xs text-[var(--fg-primary)]">
            {error.message || String(error)}
          </pre>

          {(error.stack || info?.componentStack) && (
            <details className="mt-2">
              <summary className="cursor-pointer text-2xs text-[var(--fg-muted)]">
                Technical details
              </summary>
              <pre className="selectable mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-2xs text-[var(--fg-muted)]">
                {error.stack ?? ""}
                {info?.componentStack ? `\n${info.componentStack}` : ""}
              </pre>
            </details>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.resetAndReload}
              className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
              title="Clears BuzzAgent's stored UI state (layout, zoom, drafts) and restarts"
            >
              Reset UI data and reload
            </button>
            <button
              type="button"
              onClick={this.copyDiagnostics}
              className="ml-auto text-2xs text-[var(--fg-muted)] underline underline-offset-2 transition-colors hover:text-[var(--fg-secondary)]"
            >
              Copy diagnostics
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Full-window overlay for errors thrown OUTSIDE React's render (event
 * handlers, async store code, SSE callbacks). Those never reach a boundary,
 * but they must not be silent either. The app below keeps running when it
 * can; the user can dismiss the overlay.
 *
 * The message is selectable text and there is an explicit Copy button:
 * a user who cannot reproduce a bug will not retype it. Clipboard goes
 * through the Tauri command first (always available in the desktop webview)
 * and falls back to the web Clipboard API.
 */
export function showWindowErrorOverlay(report: CrashReport): void {
  const host = document.createElement("div");
  host.setAttribute("role", "alert");
  host.style.cssText =
    "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "border:1px solid #b91c1c55;background:#1a1a1ae6;color:#e5e5e5;" +
    "border-radius:8px;padding:10px 12px;font:12px/1.45 ui-monospace,monospace;" +
    "box-shadow:0 8px 24px #0006;backdrop-filter:blur(4px)";

  const title = document.createElement("div");
  title.textContent = "Runtime error (the app keeps running)";
  title.style.cssText = "color:#f87171;font-weight:600;margin-bottom:4px";
  title.title = `BuzzAgent build ${buildId()}`;

  const message = document.createElement("div");
  message.textContent = report.message;
  message.style.cssText =
    "white-space:pre-wrap;word-break:break-word;max-height:8em;overflow:auto;" +
    "user-select:text;-webkit-user-select:text;cursor:text;margin-bottom:6px";

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:12px;align-items:center";

  const mkAction = (label: string, hint: string) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = hint;
    b.style.cssText =
      "all:unset;cursor:pointer;text-decoration:underline;color:#a3a3a3";
    return b;
  };

  const copy = mkAction("Copy details", "Copy the full error to the clipboard");
  copy.addEventListener("click", (event) => {
    event.preventDefault();
    const text = formatCrash(report);
    const done = () => {
      copy.textContent = "Copied ✓";
      window.setTimeout(() => {
        copy.textContent = "Copy details";
      }, 1600);
    };
    // Desktop: the Tauri clipboard command bypasses webview permission quirks.
    void copyText(text).then((ok) => {
      if (ok) {
        done();
      } else {
        copy.textContent = "Copy failed — select the text above";
      }
    });
  });

  const dismiss = mkAction("Dismiss", "Hide this panel");
  dismiss.addEventListener("click", () => host.remove());

  const build = document.createElement("span");
  build.textContent = `build ${buildId()}`;
  build.style.cssText = "margin-left:auto;color:#737373;font-size:10px";
  build.title = "Exact download identifier — include it in bug reports";

  actions.append(copy, dismiss, build);
  panel.append(title, message, actions);
  host.appendChild(panel);
  document.body.appendChild(host);
}
