import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";import {
  ChevronDown,
  MessageSquarePlus,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import type { Session } from "../../core/types";

function projectName(dir: string): string {
  return dir.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || dir;
}

function relativeTime(ms?: number): string {
  if (!ms) return "";
  const seconds = Math.round((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One session row with inline rename.
 *
 * Renaming was never reachable from the UI before even though the core
 * supports it (`PATCH /session/:id`) — every session stayed "New session"
 * forever. Double-click or the pencil icon starts the edit; Enter saves,
 * Escape cancels, blur saves (the least surprising of the three).
 */
function RenameableSession({
  session,
  active,
  onOpen,
}: {
  session: Session;
  active: boolean;
  onOpen: () => void;
}) {
  const renameSession = useApp((s) => s.renameSession);
  const reportError = useApp((s) => s.reportError);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = async () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === session.title) return;
    try {
      await renameSession(session.id, next);
    } catch (error) {
      // Refused by the core — surface it rather than a silent console error.
      reportError(error);
    }
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") {
              setDraft(session.title);
              setEditing(false);
            }
          }}
          onBlur={() => void commit()}
          aria-label="Session name"
          className="w-full rounded-xs border border-[var(--accent)] bg-[var(--bg-base)] px-1.5 py-0.5 text-xs text-[var(--fg-primary)] focus:outline-none"
        />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={() => {
          setDraft(session.title);
          setEditing(true);
        }}
        aria-current={active ? "true" : undefined}
        className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1 text-left transition-colors ${
          active
            ? "bg-[var(--bg-active)] text-[var(--fg-primary)]"
            : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
        }`}
      >
        <span className="w-full truncate pr-9 text-xs">
          {session.title || "Untitled"}
        </span>
        <span className="text-2xs text-[var(--fg-muted)]">
          {relativeTime(session.time?.updated)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(session.title);
          setEditing(true);
        }}
        title="Rename session"
        aria-label={`Rename ${session.title || "session"}`}
        className="absolute right-7 top-1 flex size-5 items-center justify-center rounded-xs text-[var(--fg-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-active)] hover:text-[var(--fg-primary)] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Pencil size={10} />
      </button>
    </>
  );
}

/**
 * Projects overview: sessions grouped by the directory they belong to, the way
 * Orca-style workbenches present parallel work. The current project is pinned
 * on top; a session from another project switches the core to that project.
 */
export function ProjectsList() {
  const {
    sessions,
    sessionId,
    projectDir,
    openSession,
    newSession,
    deleteSession,
    openProjectSession,
    chooseProject,
    recentProjects,
    hiddenProjects,
    removeProject,
  } = useApp(
    useShallow((s) => ({
      sessions: s.sessions,
      sessionId: s.sessionId,
      projectDir: s.projectDir,
      openSession: s.openSession,
      newSession: s.newSession,
      deleteSession: s.deleteSession,
      openProjectSession: s.openProjectSession,
      chooseProject: s.chooseProject,
      recentProjects: s.recentProjects,
      hiddenProjects: s.hiddenProjects,
      removeProject: s.removeProject,
    }))
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Poisoned persisted data must degrade, not kill the whole workbench render
  // (a non-array here used to white-screen the app on project open).
  const hidden = Array.isArray(hiddenProjects) ? hiddenProjects : [];

  const addProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") await chooseProject(selected);
  };

  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const dir = session.directory || projectDir || "unknown";
    if (hidden.includes(dir)) continue;
    const list = groups.get(dir) ?? [];
    list.push(session);
    groups.set(dir, list);
  }
  // Past projects without sessions stay visible, exactly like Onorca lists them.
  for (const recent of recentProjects) {
    if (!groups.has(recent.path) && !hidden.includes(recent.path)) {
      groups.set(recent.path, []);
    }
  }

  // Current project first, then the rest by most recent activity.
  const ordered = [...groups.entries()].sort(([dirA, a], [dirB, b]) => {
    const aCurrent = dirA === projectDir ? 1 : 0;
    const bCurrent = dirB === projectDir ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    return (b[0]?.time?.updated ?? 0) - (a[0]?.time?.updated ?? 0);
  });

  const open = async (session: Session) => {
    const dir = session.directory || projectDir;
    if (!dir) {
      await openSession(session.id);
      return;
    }
    await openProjectSession(dir, session.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2 py-1.5">
        <span className="text-2xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
          {t(useApp.getState().language, "sidebar.projects")}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void newSession()}
            title="New session"
            aria-label="New session"
            className="flex size-5 items-center justify-center rounded-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
          >
            <MessageSquarePlus size={13} />
          </button>
          <button
            type="button"
            onClick={() => void addProject()}
            title="Add project"
            aria-label="Add project"
            className="flex size-5 items-center justify-center rounded-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
          >
            <FolderPlus size={13} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {ordered.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-[var(--fg-muted)]">
            No sessions yet. Send a message to start one.
          </p>
        )}

        {ordered.map(([dir, list]) => {
          const isCurrent = dir === projectDir;
          const isCollapsed = collapsed[dir] ?? false;
          return (
            <div key={dir} className="mb-1.5">
              <div className="group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-[var(--bg-hover)]">
                <button
                  type="button"
                  onClick={() => {
                    // Clicking a project selects it: for another project this
                    // switches the core (its sessions and file tree come with
                    // it). The chevron column collapses; the row opens.
                    if (dir !== projectDir) {
                      if (list.length > 0) {
                        void openProjectSession(dir, list[0].id);
                      } else {
                        void chooseProject(dir);
                      }
                    } else {
                      setCollapsed((prev) => ({ ...prev, [dir]: !isCollapsed }));
                    }
                  }}
                  onContextMenu={(e) => {
                    // Right-click always just collapses/expands.
                    e.preventDefault();
                    setCollapsed((prev) => ({ ...prev, [dir]: !isCollapsed }));
                  }}
                  aria-expanded={!isCollapsed}
                  title={dir !== projectDir ? "Open project" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <ChevronDown
                    size={11}
                    className={`shrink-0 text-[var(--fg-muted)] transition-transform ${
                      isCollapsed ? "-rotate-90" : ""
                    }`}
                  />
                  <Folder size={11} className="shrink-0 text-[var(--accent)]" />
                  <span
                    className="min-w-0 flex-1 truncate text-2xs font-semibold text-[var(--fg-secondary)]"
                    title={dir}
                  >
                    {projectName(dir)}
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 rounded-xs bg-[var(--accent-subtle)] px-1 text-2xs text-[var(--accent)]">
                      {t(useApp.getState().language, "sidebar.current")}
                    </span>
                  )}
                  <span className="shrink-0 text-2xs text-[var(--fg-muted)]">{list.length}</span>
                </button>
                {!isCurrent && dir !== "unknown" && (
                  <button
                    type="button"
                    onClick={() => removeProject(dir)}
                    title="Remove from list"
                    aria-label={`Remove project ${projectName(dir)}`}
                    className="shrink-0 rounded p-0.5 text-[var(--fg-muted)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              {!isCollapsed && list.length === 0 && !isCurrent && (
                <div className="ml-6 pb-1">
                  <button
                    type="button"
                    onClick={() => void chooseProject(dir)}
                    className="text-2xs text-[var(--accent)] hover:underline"
                  >
                    Open project
                  </button>
                </div>
              )}

              {!isCollapsed && (
                <ul className="ml-3 space-y-0.5 border-l border-[var(--border-subtle)] pl-1.5">
                  {list.map((session) => {
                    const active = session.id === sessionId;
                    return (
                      <li key={session.id} className="group relative">
                        <RenameableSession
                          session={session}
                          active={active}
                          onOpen={() => void open(session)}
                        />

                        <button
                          type="button"
                          onClick={async () => {
                            if (dir === projectDir) {
                              await deleteSession(session.id);
                            }
                            // Deleting a session of another project would mean a
                            // core switch mid-flight; keep it honest and skip. (It
                            // also used to write an empty project config into that
                            // directory — creating junk files in unrelated projects.)
                          }}
                          title="Delete session"
                          aria-label={`Delete ${session.title || "session"}`}
                          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-xs text-[var(--fg-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-active)] hover:text-[var(--danger)] focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Skills and MCP are their own dockable panels now (SkillsPanel /
          McpPanel) — they no longer live at the bottom of Projects. */}
    </div>
  );
}
