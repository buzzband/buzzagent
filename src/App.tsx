import { useEffect, useState } from "react";
// Selector subscriptions: without them every store change re-renders the whole
// tree — on WebKitGTK (Linux) that is what made clicks feel 1–2s slow.
import { useShallow } from "zustand/react/shallow";
import { Toaster } from "sonner";
import { Minus, Square, X } from "lucide-react";
import appIcon from "./assets/app-icon.svg";
import { applyTheme, useApp } from "./store/app";
import { ZOOM_LEVELS, applyZoom, loadZoomIndex, zoomActionFromEvent } from "./lib/zoom";
import { logPhase } from "./components/ErrorBoundary";
import { Onboarding } from "./components/Onboarding";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { CoreLogModal } from "./components/CoreLogModal";
import { SettingsPanel } from "./components/SettingsPanel";
import { HelpModal } from "./components/HelpModal";
import { Workbench } from "./components/workbench/Workbench";
import { AppContextMenu } from "./components/AppContextMenu";

export function App() {
  const { phase, theme, boot, settingsOpen, setSettingsOpen, frameMode } = useApp(
    useShallow((s) => ({
      phase: s.phase,
      theme: s.theme,
      boot: s.boot,
      settingsOpen: s.settingsOpen,
      setSettingsOpen: s.setSettingsOpen,
      frameMode: s.frameMode,
    }))
  );
  const [bootLogOpen, setBootLogOpen] = useState(false);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the stored frame mode on startup (the store only touches it on change).
  useEffect(() => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setDecorations(frameMode === "system");
      } catch {
        // Plain browser: no window to decorate.
      }
    })();
  }, [frameMode]);

  // Restore the tray icon when the user left it enabled. The native side
  // cannot read localStorage, so JS replays the setting after every launch.
  useEffect(() => {
    if (localStorage.getItem("buzzagent.tray_enabled") !== "true") return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("app_toggle_tray", { enabled: true }).catch(() => undefined)
    );
  }, []);

  // UI zoom: WebKitGTK has no built-in Ctrl+plus/minus/wheel zoom, so the app
  // applies the stored level on boot and owns the shortcuts itself.
  useEffect(() => {
    void applyZoom(ZOOM_LEVELS[loadZoomIndex()]);
  }, []);

  useEffect(() => {
    const change = useApp.getState().changeZoom;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = zoomActionFromEvent(event);
      if (!action) return;
      event.preventDefault();
      change(action);
    };
    const onWheel = (event: WheelEvent) => {
      const action = zoomActionFromEvent(event);
      if (!action) return;
      event.preventDefault();
      change(action);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Follow the OS when the user asked us to.
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  // Phase breadcrumbs reach debug.log: a "blank window" report then carries
  // the last phase the UI was in, which halves the guesswork remotely.
  useEffect(() => {
    logPhase(phase);
  }, [phase]);

  if (phase === "boot") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[var(--bg-base)] p-4">
        <div className="text-center">
          <div className="mx-auto size-5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" />
          <p className="mt-3 text-xs text-[var(--fg-muted)]">Starting the agent core…</p>
          <button
            type="button"
            onClick={() => setBootLogOpen(true)}
            className="mt-4 text-2xs text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
          >
            View live startup logs
          </button>
        </div>
        <CoreLogModal
          open={bootLogOpen}
          onClose={() => setBootLogOpen(false)}
          title="Startup Logs"
        />
      </div>
    );
  }

  if (phase === "onboarding") return <AutopilotOrOnboarding />;

  return (
    <>
      <TrayNewSessionListener />
      <AppContextMenu />
      <div className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-base)]">
        {frameMode === "custom" && <CustomTitlebar />}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <Workbench />
        </div>

        <StatusBar />
        <CommandPalette />
        <HelpModal />
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <Toaster
          theme="system"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--bg-overlay)",
              border: "1px solid var(--border-default)",
              color: "var(--fg-primary)",
              fontSize: "13px",
            },
          }}
        />
      </div>
    </>
  );
}

/**
 * Scripted-run seam (Xvfb/CI): a native folder dialog cannot be driven
 * headlessly, so when `BUZZAGENT_AUTOPILOT_PROJECT` is set the onboarding
 * screen auto-picks that project after a short delay. Without the variable
 * this is the plain Onboarding — zero behavioural change for users.
 */
function AutopilotOrOnboarding() {
  const [autopilot, setAutopilot] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const target = await invoke<string | null>("ui_autopilot");
        if (!cancelled && target) setAutopilot(target);
      } catch {
        // Plain browser or absent command: plain onboarding.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!autopilot) return;
    const id = window.setTimeout(() => {
      void useApp.getState().chooseProject(autopilot);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [autopilot]);
  return <Onboarding />;
}

/**
 * The tray menu cannot touch the store, so "New session" arrives as a Tauri
 * event; here it is translated into the same action as the sidebar button.
 */
function TrayNewSessionListener() {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const stop = await listen("tray://new-session", () => {
          void useApp.getState().newSession();
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // Plain browser: no Tauri events.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return null;
}

/**
 * Own window header for the "custom frame" mode (VS Code style): a thin
 * drag-region strip with app identity and window controls. The native
 * decorations are hidden in this mode.
 */
function CustomTitlebar() {
  const minimize = () => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().minimize().catch(() => undefined)
    );
  };
  const toggleMaximize = () => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().toggleMaximize().catch(() => undefined)
    );
  };
  const close = () => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().close().catch(() => undefined)
    );
  };

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-3"
    >
      <img src={appIcon} alt="" aria-hidden className="mr-1.5 size-3.5" />
      <span className="text-2xs font-medium text-[var(--fg-secondary)]">BuzzAgent</span>
      <div className="ml-auto flex h-full">
        <button
          type="button"
          onClick={minimize}
          aria-label="Minimize"
          className="flex h-full w-11 items-center justify-center text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
        >
          <Minus size={12} />
        </button>
        <button
          type="button"
          onClick={toggleMaximize}
          aria-label="Maximize"
          className="flex h-full w-11 items-center justify-center text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
        >
          <Square size={9} />
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center text-[var(--fg-secondary)] transition-colors hover:bg-[var(--danger)] hover:text-white"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
