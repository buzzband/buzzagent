import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import {
  ErrorBoundary,
  reportToBackend,
  saveCrashReport,
  showWindowErrorOverlay,
  surfacePreviousCrash,
} from "./components/ErrorBoundary";
import "./styles/index.css";

// Very first statement that runs: proves the frontend executed at all.
// A missing `buzzagent.jsboot` after a "white window" report means the
// webview never loaded the bundle — a loader problem, not an app crash.
try {
  localStorage.setItem("buzzagent.jsboot", new Date().toISOString());
} catch {
  // Storage unavailable — diagnostics degrade, the app still runs.
}

// Tauri v2 replaces window.confirm/alert/prompt with IPC-based versions that
// return PROMISES. Two bugs fall out of that: `if (confirm(...))` is always
// truthy (a Promise), so a "Remove provider?" dialog deletes immediately; and
// without the matching ACL entry the call rejects — the very
// "Command plugin:dialog|confirm not allowed by ACL" crash report. Restore the
// BROWSER semantics: a synchronous boolean with no permissions involved.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  const nativeConfirm = window.confirm.bind(window);
  const nativeAlert = window.alert.bind(window);
  const isTauriDialog = (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function" &&
    typeof (value as { tag?: unknown }).tag === "string" &&
    (value as { tag: string }).tag.startsWith("plugin:");
  window.confirm = ((message?: string): boolean => {
    try {
      const result = nativeConfirm(message);
      if (!isTauriDialog(result)) return result === true;
      void Promise.resolve(result).catch(() => undefined); // swallow ACL rejections
      return false;
    } catch {
      return false;
    }
  }) as typeof window.confirm;
  window.alert = ((message?: unknown): void => {
    try {
      const result = nativeAlert(message) as unknown;
      if (isTauriDialog(result)) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Alert is best-effort by nature.
    }
  }) as typeof window.alert;
}

// Global safety net — installed BEFORE the first render so even an exception
// during module evaluation or boot is captured instead of leaving a blank
// window with no clue. Unhandled async rejections (store actions, SSE
// callbacks) and stray event-handler errors land here.
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const report = {
      message: event.message || "Unknown error",
      stack: event.error?.stack,
      kind: "window" as const,
      at: Date.now(),
    };
    saveCrashReport(report);
    reportToBackend(report);
    try {
      showWindowErrorOverlay(report);
    } catch {
      // DOM not ready / re-entrant failure — the saved report is enough.
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const report = {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      kind: "unhandledrejection" as const,
      at: Date.now(),
    };
    saveCrashReport(report);
    reportToBackend(report);
    try {
      showWindowErrorOverlay(report);
    } catch {
      // Same as above.
    }
  });
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

// A crash report from the previous run explains a "blank again" complaint:
// surface it once — then clear it, so the next launches start clean.
try {
  surfacePreviousCrash();
} catch {
  // Cosmetic only.
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
