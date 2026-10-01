import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Folder,
  FolderOpen,
  History,
  Loader2,
  ScrollText,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store/app";
import { t } from "../lib/i18n";
import { CoreLogModal } from "./CoreLogModal";

/**
 * First-run screen: pick a project, then the core boots into it.
 *
 * It also carries the honest privacy disclosure. We claim no analytics and no
 * tracking, which is true — but the core does fetch a model catalogue at
 * startup, and saying so here is cheaper than being caught not saying it.
 */
export function Onboarding() {
  const {
    chooseProject,
    startupError,
    pinnedVersion,
    recentProjects,
    removeRecentProject,
    clearRecentProjects,
  } = useApp(
    useShallow((s) => ({
      chooseProject: s.chooseProject,
      startupError: s.startupError,
      pinnedVersion: s.pinnedVersion,
      recentProjects: s.recentProjects,
      removeRecentProject: s.removeRecentProject,
      clearRecentProjects: s.clearRecentProjects,
    }))
  );
  const [starting, setStarting] = useState(false);
  const [available, setAvailable] = useState(true);
  const [manualPath, setManualPath] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showLogModal, setShowLogModal] = useState(false);

  useEffect(() => {
    // Check if we are running in Tauri
    const inTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    setAvailable(inTauri);
  }, []);

  const pick = async () => {
    setStarting(true);
    setActionError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === "string") {
        await chooseProject(selected);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const submitManual = async (path = manualPath) => {
    if (!path.trim()) return;
    setStarting(true);
    setActionError(null);
    try {
      await chooseProject(path.trim());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-[var(--bg-base)] px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--fg-primary)]">
            BuzzAgent
          </h1>
          <p className="mt-1.5 text-sm text-[var(--fg-secondary)]">
            A visual workbench for AI coding agents.
          </p>
        </div>

        {/* What happens next, in three steps, before the first click — the
            newcomer should never wonder what a choice leads to. */}
        <ol className="mb-5 space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 text-xs text-[var(--fg-secondary)]">
          {["onboarding.step1", "onboarding.step2", "onboarding.step3"].map((key, i) => (
            <li key={key} className="flex items-start gap-2">
              <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-2xs font-semibold text-[var(--accent)]">
                {i + 1}
              </span>
              <span>{t(useApp.getState().language, key)}</span>
            </li>
          ))}
        </ol>

        {!available ? (
          <div className="panel p-4 text-sm text-[var(--fg-secondary)]">
            <p className="font-medium text-[var(--fg-primary)]">Desktop runtime required</p>
            <p className="mt-1.5">
              This is the web preview. The agent core runs as a local process, so
              launch the desktop app with{" "}
              <code className="font-mono text-[var(--accent)]">npm run dev</code>.
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void pick()}
              disabled={starting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {starting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Starting the agent core…
                </>
              ) : (
                <>
                  <FolderOpen size={16} />
                  Choose Project Folder
                </>
              )}
            </button>

            <div className="relative my-3 text-center text-2xs text-[var(--fg-muted)]">
              <span className="bg-[var(--bg-base)] px-2">or enter path directly</span>
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitManual();
                }}
                placeholder="/path/to/your/project or ."
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void submitManual()}
                disabled={starting || !manualPath.trim()}
                className="rounded-md bg-[var(--bg-raised)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40"
              >
                Open
              </button>
            </div>

            <div className="mt-2 flex justify-center gap-2 text-2xs text-[var(--fg-muted)]">
              <button
                type="button"
                onClick={() => void submitManual(".")}
                className="underline underline-offset-2 hover:text-[var(--fg-secondary)]"
              >
                Use current folder (.)
              </button>
            </div>

            {/* Recent Projects (up to 10) */}
            {recentProjects.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="flex items-center justify-between px-1 pb-2">
                  <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                    <History size={12} />
                    Recent Projects
                  </span>
                  <button
                    type="button"
                    onClick={clearRecentProjects}
                    className="text-2xs text-[var(--fg-muted)] hover:text-[var(--danger)]"
                  >
                    Clear history
                  </button>
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {recentProjects.map((p) => (
                    <div
                      key={p.path}
                      className="group flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <button
                        type="button"
                        onClick={() => void submitManual(p.path)}
                        disabled={starting}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <Folder size={14} className="shrink-0 text-[var(--accent)]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-[var(--fg-primary)]">
                            {p.name}
                          </div>
                          <div className="truncate font-mono text-2xs text-[var(--fg-muted)]">
                            {p.path}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeRecentProject(p.path)}
                        className="ml-2 rounded p-1 text-[var(--fg-muted)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover:opacity-100"
                        title="Remove from history"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {(actionError || startupError) && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-subtle)] p-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--danger)]">
                <Terminal size={14} />
                {actionError ? "Error selecting folder" : "The core did not start"}
              </div>
              <button
                type="button"
                onClick={() => setShowLogModal(true)}
                className="flex items-center gap-1 rounded bg-[var(--bg-base)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              >
                <ScrollText size={11} />
                View Logs
              </button>
            </div>
            <pre className="selectable mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs text-[var(--fg-secondary)]">
              {actionError || startupError}
            </pre>
          </div>
        )}

        <CoreLogModal
          open={showLogModal}
          onClose={() => setShowLogModal(false)}
          title="Startup Diagnostic Logs"
          initialError={actionError || startupError}
        />

        <div className="mt-8 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg-primary)]">
            <ShieldCheck size={13} className="text-[var(--success)]" />
            Privacy
          </div>
          <ul className="space-y-1 text-xs text-[var(--fg-secondary)]">
            <li>No analytics, no tracking, no crash reporting.</li>
            <li>Your prompts go only to the provider you configure.</li>
            <li>Conversation sharing and auto-update are disabled.</li>
            <li className="text-[var(--fg-muted)]">
              At startup the core downloads a model catalogue from
              opencode.ai. Nothing about your code is sent.
            </li>
          </ul>
        </div>

        {pinnedVersion && (
          <p className="mt-4 text-center text-2xs text-[var(--fg-muted)]">
            agent core: opencode {pinnedVersion}
          </p>
        )}
      </div>
    </div>
  );
}
