import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FileDiff as FileDiffIcon,
  FilePlus2,
  FileX2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { parsePatch, statsFor, type DiffRow } from "../../lib/diff";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";

interface ChangesReport {
  repo: boolean;
  changes: FileChange[];
}

interface FileChange {
  path: string;
  status: string;
  added: number;
  removed: number;
  patch: string | null;
  binary: boolean;
}

function statusIcon(status: string) {
  if (status === "untracked" || status === "added") return FilePlus2;
  if (status === "deleted") return FileX2;
  return FileDiffIcon;
}

/** A single diff row, with word-level marks where we detected an edit. */
function Row({ row }: { row: DiffRow }) {
  if (row.kind === "meta") return null;

  if (row.kind === "hunk") {
    return (
      <div className="bg-[var(--bg-overlay)] px-3 py-1 font-mono text-2xs text-[var(--fg-muted)]">
        {row.text}
      </div>
    );
  }

  const background =
    row.kind === "add"
      ? "bg-[var(--diff-add-bg)]"
      : row.kind === "del"
        ? "bg-[var(--diff-del-bg)]"
        : "";

  const foreground =
    row.kind === "add"
      ? "text-[var(--diff-add-fg)]"
      : row.kind === "del"
        ? "text-[var(--diff-del-fg)]"
        : "text-[var(--fg-secondary)]";

  const wordBackground =
    row.kind === "add" ? "bg-[var(--diff-add-word)]" : "bg-[var(--diff-del-word)]";

  return (
    <div className={`flex font-mono text-xs leading-relaxed ${background}`}>
      <span className="w-11 shrink-0 select-none pr-2 text-right text-[var(--fg-muted)]/60">
        {row.oldNumber ?? ""}
      </span>
      <span className="w-11 shrink-0 select-none pr-2 text-right text-[var(--fg-muted)]/60">
        {row.newNumber ?? ""}
      </span>
      <span className="w-4 shrink-0 select-none text-center text-[var(--fg-muted)]">
        {row.kind === "add" ? "+" : row.kind === "del" ? "-" : ""}
      </span>
      <span className={`selectable min-w-0 flex-1 whitespace-pre-wrap break-all pr-3 ${foreground}`}>
        {row.segments
          ? row.segments.map((segment, i) =>
              segment.changed ? (
                <mark
                  key={i}
                  className={`rounded-[2px] ${wordBackground} text-inherit`}
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              )
            )
          : row.text || "\u00A0"}
      </span>
    </div>
  );
}

function FileEntry({
  change,
  projectDir,
  onReverted,
}: {
  change: FileChange;
  projectDir: string;
  onReverted: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [reverting, setReverting] = useState(false);
  const rows = useMemo(
    () => (change.patch ? parsePatch(change.patch) : []),
    [change.patch]
  );
  const stats = useMemo(() => statsFor(rows), [rows]);
  const Icon = statusIcon(change.status);

  const revert = async () => {
    setReverting(true);
    try {
      await invoke("git_revert_file", {
        projectDir,
        path: change.path,
        untracked: change.status === "untracked",
      });
      onReverted();
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon size={13} className="shrink-0 text-[var(--fg-muted)]" />
          <span className="selectable truncate font-mono text-xs text-[var(--fg-primary)]">
            {change.path}
          </span>
          {change.status === "untracked" && (
            <span className="shrink-0 rounded-xs bg-[var(--success-subtle)] px-1 text-2xs text-[var(--success)]">
              new
            </span>
          )}
        </button>

        <span className="shrink-0 font-mono text-2xs">
          {stats.added > 0 && <span className="text-[var(--success)]">+{stats.added}</span>}
          {stats.removed > 0 && (
            <span className="ml-1 text-[var(--danger)]">−{stats.removed}</span>
          )}
        </span>

        <button
          type="button"
          onClick={() => void revert()}
          disabled={reverting}
          title={
            change.status === "untracked"
              ? "Delete this new file"
              : "Discard changes to this file"
          }
          className="flex size-6 shrink-0 items-center justify-center rounded-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--danger)] disabled:opacity-40"
        >
          <Undo2 size={12} />
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto">
          {change.binary ? (
            <p className="px-3 py-2 text-xs text-[var(--fg-muted)]">Binary file</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--fg-muted)]">No textual changes</p>
          ) : (
            rows.map((row, i) => <Row key={i} row={row} />)
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The diff panel: everything uncommitted in the project.
 *
 * Sourced from git rather than the core's diff endpoints, which returned empty
 * in testing (see docs/core-api-notes.md). It refreshes while the agent works,
 * so edits appear as they land.
 */
export function DiffPanel() {
  const { projectDir, busy } = useApp(
    useShallow((s) => ({ projectDir: s.projectDir, busy: s.busy }))
  );
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [isRepo, setIsRepo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectDir) return;
    try {
      const result = await invoke<ChangesReport>("git_changes", { projectDir });
      setChanges(result.changes);
      setIsRepo(result.repo);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [projectDir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while the agent works…
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  // …and refresh once more when the turn ends, so the very last write lands.
  useEffect(() => {
    if (!busy) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const totals = changes.reduce(
    (acc, c) => ({ added: acc.added + c.added, removed: acc.removed + c.removed }),
    { added: 0, removed: 0 }
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
        <h2 className="text-xs font-medium text-[var(--fg-primary)]">Changes</h2>
        {changes.length > 0 && (
          <span className="font-mono text-2xs text-[var(--fg-muted)]">
            {changes.length} file{changes.length === 1 ? "" : "s"}
            <span className="ml-1.5 text-[var(--success)]">+{totals.added}</span>
            <span className="ml-1 text-[var(--danger)]">−{totals.removed}</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          title="Refresh"
          aria-label="Refresh changes"
          className="ml-auto flex size-6 items-center justify-center rounded-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
        >
          <RotateCcw size={12} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-subtle)] p-3 text-xs text-[var(--danger)]"
          >
            {error}
          </div>
        ) : !loaded ? null : !isRepo ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <FileDiffIcon size={22} className="text-[var(--fg-muted)]" />
            <p className="mt-2 text-sm text-[var(--fg-secondary)]">Not a git repository</p>
            <p className="mt-0.5 max-w-xs text-xs text-[var(--fg-muted)]">
              Diffs are computed with git. Run <code>git init</code> in the project (or open a
              repository) and changes will appear here — including brand-new files.
            </p>
          </div>
        ) : changes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <FileDiffIcon size={22} className="text-[var(--fg-muted)]" />
            <p className="mt-2 text-sm text-[var(--fg-secondary)]">No changes yet</p>
            <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
              Edits the agent makes will show up here.
            </p>
          </div>
        ) : (
          changes.map((change) => (
            <FileEntry
              key={change.path}
              change={change}
              projectDir={projectDir!}
              onReverted={refresh}
            />
          ))
        )}
      </div>
    </div>
  );
}
