import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder, GitBranch, Loader2, Plus, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";

interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
  is_main: boolean;
}

/**
 * Worktree orchestration.
 *
 * Each worktree is an isolated checkout, so an agent can work on a branch
 * without disturbing the main tree. Opening one restarts the core in that
 * directory — the core is per-project, so a different tree means a different
 * core instance.
 */
export function WorktreePanel() {
  const { projectDir, chooseProject } = useApp(
    useShallow((s) => ({ projectDir: s.projectDir, chooseProject: s.chooseProject }))
  );
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!projectDir) return;
    try {
      setWorktrees(await invoke<WorktreeInfo[]>("git_worktrees", { projectDir }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir]);

  const create = async () => {
    if (!branch.trim() || !projectDir) return;
    setBusy(true);
    setError(null);
    try {
      await invoke<string>("git_worktree_add", { projectDir, branch: branch.trim() });
      setBranch("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (path: string) => {
    if (!projectDir) return;
    setBusy(true);
    try {
      await invoke("git_worktree_remove", { projectDir, path });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-subtle)] px-4 py-2">
        <h2 className="text-xs font-medium text-[var(--fg-primary)]">Worktrees</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-3 flex gap-2">
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder="new-branch-name"
            aria-label="Branch name"
            className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !branch.trim()}
            className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Create
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-3 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]"
          >
            {error}
          </div>
        )}

        {worktrees.length === 0 ? (
          <p className="px-1 text-xs text-[var(--fg-muted)]">
            Not a git repository, or no worktrees yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {worktrees.map((tree) => {
              const active = tree.path === projectDir;
              return (
                <li
                  key={tree.path}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    active
                      ? "border-[var(--accent)]/40 bg-[var(--accent-subtle)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                  }`}
                >
                  <GitBranch size={13} className="shrink-0 text-[var(--fg-muted)]" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs text-[var(--fg-primary)]">
                        {tree.branch ?? "(detached)"}
                      </span>
                      {tree.is_main && (
                        <span className="shrink-0 rounded-xs bg-[var(--bg-overlay)] px-1 text-2xs text-[var(--fg-muted)]">
                          main
                        </span>
                      )}
                    </div>
                    <div className="selectable truncate text-2xs text-[var(--fg-muted)]">
                      {tree.path}
                    </div>
                  </div>

                  {!active && (
                    <button
                      type="button"
                      onClick={() => void chooseProject(tree.path)}
                      title="Open this worktree"
                      className="shrink-0 rounded-md border border-[var(--border-default)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
                    >
                      <Folder size={11} className="mr-1 inline" />
                      Open
                    </button>
                  )}

                  {!tree.is_main && (
                    <button
                      type="button"
                      onClick={() => void remove(tree.path)}
                      title="Remove worktree"
                      aria-label={`Remove worktree ${tree.branch ?? tree.path}`}
                      className="flex size-6 shrink-0 items-center justify-center rounded-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--danger)]"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 px-1 text-2xs text-[var(--fg-muted)]">
          Opening a worktree restarts the agent core in that directory.
        </p>
      </div>
    </div>
  );
}
