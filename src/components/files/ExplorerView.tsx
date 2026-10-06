import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

/**
 * Project file tree for the left sidebar (the VS Code "Explorer").
 *
 * Viewing goes through the core (`GET /file/content`); mutations (create,
 * rename, delete, save) go through the desktop backend, which the core has no
 * write endpoints for. Single click opens the file in the Editor window.
 */
export function ExplorerView() {
  const { projectDir, busy, openWindow, fsVersion, bumpFsVersion, language } = useApp(
    useShallow((s) => ({
      projectDir: s.projectDir,
      busy: s.busy,
      openWindow: s.openWindow,
      fsVersion: s.fsVersion,
      bumpFsVersion: s.bumpFsVersion,
      language: s.language,
    }))
  );
  const [levels, setLevels] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingDir, setLoadingDir] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Right-click menu state: which entry, and where the menu shows. */
  const [menu, setMenu] = useState<
    { path: string; absPath: string; isDir: boolean; x: number; y: number } | null
  >(null);
  /** Inline rename/new prompts live on the tree rows themselves (VS Code style). */
  const [draft, setDraft] = useState<
    | { kind: "newFile" | "newFolder" | "rename"; dirPath: string; initial: string; target?: string }
    | null
  >(null);

  /** Inline confirm for file/folder deletion. Not a Tauri dialog: the
   * `plugin:dialog|confirm` ACL fails in packaged builds (see the AppImage
   * crash reports), so we gate the delete locally. */
  const [deleteTarget, setDeleteTarget] = useState<
    { path: string; isDir: boolean; name: string } | null
  >(null);

  const loadLevel = useCallback(
    async (rel: string) => {
      if (!projectDir) return;
      setLoadingDir(rel);
      setError(null);
      try {
        const entries = await invoke<FsEntry[]>("fs_tree", {
          projectDir,
          path: rel || null,
        });
        setLevels((prev) => ({ ...prev, [rel]: entries }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingDir(null);
      }
    },
    [projectDir]
  );

  // A project switch must show the new project's tree, not a stale cache:
  // drop every loaded level and expanded state, then load the new root.
  useEffect(() => {
    setLevels({});
    setExpanded({});
    setSelected(null);
    setMenu(null);
    if (projectDir) void loadLevel("");
  }, [projectDir, loadLevel]);

  // The agent may create files mid-session: refresh open levels when a turn
  // ends — and after any local create/rename/delete (fsVersion bumps).
  useEffect(() => {
    if (busy) return;
    const expandedAndLevelKeys = new Set([
      ...Object.keys(expanded).filter((k) => expanded[k]),
      ...Object.keys(levels).filter((k) => k !== ""),
    ]);
    for (const rel of expandedAndLevelKeys) {
      void loadLevel(rel);
    }
    void loadLevel("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, fsVersion]);

  const toggleDir = (entry: FsEntry) => {
    const isOpen = expanded[entry.path];
    setExpanded((prev) => ({ ...prev, [entry.path]: !isOpen }));
    if (!isOpen && !levels[entry.path]) void loadLevel(entry.path);
  };

  // Close the context menu on any click elsewhere, on Escape — and honor the
  // shortcuts VS Code users expect while the menu is open: F2 renames, Delete
  // deletes (with the same confirm dialog the menu item uses).
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      } else if (e.key === "F2") {
        e.preventDefault();
        const entry = findEntry(levels, menu.path);
        if (entry) {
          startRename(entry);
          close();
        }
      } else if (e.key === "Delete") {
        e.preventDefault();
        const entry = findEntry(levels, menu.path);
        if (entry) {
          void deleteEntry(entry);
          close();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, levels]);

  /** Browser previews HTML/SVG straight off disk via its file:// handling. */
  const VIEWABLE = [".html", ".htm", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp"];
  const isViewable = (path: string) =>
    VIEWABLE.some((ext) => path.toLowerCase().endsWith(ext));

  /** Hand the file to the Browser panel: open its tab and pass the path. */
  const openInBrowserPanel = (absPath: string) => {
    openWindow("browser");
    window.dispatchEvent(new CustomEvent("buzzagent:browser-open-file", { detail: absPath }));
  };

  /** Open with the OS default handler (desktop runtime only). */
  const openExternally = async (absPath: string) => {
    try {
      await invoke("open_external", { path: absPath });
    } catch (e) {
      // Web preview has no desktop runtime — say so instead of failing silently.
      setError(
        e instanceof Error
          ? `${e.message} (desktop app required)`
          : `${String(e)} (desktop app required)`
      );
    }
  };

  /** Open the containing folder with the OS file manager. */
  const revealInFileManager = async (absPath: string) => {
    const dir = absPath.replace(/\/[^/]+\/?$/, "") || "/";
    await openExternally(dir);
  };

  const copyPath = async (absPath: string) => {
    try {
      await navigator.clipboard.writeText(absPath);
    } catch {
      setError("Clipboard is unavailable");
    }
  };

  const fsMutate = async (action: "createFile" | "createDir" | "rename" | "delete", args: Record<string, unknown>) => {
    if (!projectDir) return;
    const command = {
      createFile: "fs_create_file",
      createDir: "fs_create_dir",
      rename: "fs_rename",
      delete: "fs_delete",
    }[action];
    try {
      await invoke(command, { projectDir, ...args });
      bumpFsVersion();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Click a file → open it in the Editor window (docks into the center area,
   * loads the content through the core, fully editable + savable).
   */
  const onFile = (entry: FsEntry) => {
    setSelected(entry.path);
    void useApp.getState().openInEditor(entry.path);
  };

  const contextProps = (entry: FsEntry) => ({
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      const abs = `${projectDir?.replace(/\/+$/, "")}/${entry.path.replace(/^\/+/, "")}`;
      setMenu({ path: entry.path, absPath: abs, isDir: entry.is_dir, x: e.clientX, y: e.clientY });
    },
  });

  const startNewFile = (dirPath: string) => {
    setDraft({ kind: "newFile", dirPath, initial: "" });
    // The inline input renders inside the target folder's level — open it.
    if (dirPath) setExpanded((prev) => ({ ...prev, [dirPath]: true }));
  };
  const startNewFolder = (dirPath: string) => {
    setDraft({ kind: "newFolder", dirPath, initial: "" });
    if (dirPath) setExpanded((prev) => ({ ...prev, [dirPath]: true }));
  };
  const startRename = (entry: FsEntry) =>
    setDraft({ kind: "rename", dirPath: entry.path, initial: entry.name, target: entry.path });

  const submitDraft = async () => {
    if (!draft) return;
    const name = draft.initial.trim();
    if (!name) {
      setDraft(null);
      return;
    }
    const parent = draft.dirPath;
    if (draft.kind === "rename" && draft.target) {
      const to = parent.includes("/")
        ? `${parent.slice(0, parent.lastIndexOf("/"))}/${name}`
        : name;
      await fsMutate("rename", { path: draft.target, to });
      if (selected === draft.target) setSelected(to);
      // Follow the rename in the Editor in place: keep the draft content,
      // only the path changes — reloading would drop unsaved edits.
      const { editorFile, setEditorPath } = useApp.getState();
      if (editorFile?.path === draft.target) setEditorPath(to);
    } else {
      const path = parent ? `${parent}/${name}` : name;
      await fsMutate(draft.kind === "newFile" ? "createFile" : "createDir", { path });
      // Open a just-created file right away; reveal a new folder in the tree.
      if (draft.kind === "newFile") {
        setSelected(path);
        void useApp.getState().openInEditor(path);
      } else {
        setExpanded((prev) => ({ ...prev, [parent]: true }));
      }
    }
    setDraft(null);
  };

  const deleteEntry = (entry: { path: string; is_dir: boolean; name: string }) => {
    // Route through a local confirm modal (Tauri dialog plugin ACL is unreliable
    // on Linux AppImage builds and is the exact crash signature in the changelog).
    setDeleteTarget({ path: entry.path, isDir: entry.is_dir, name: entry.name });
    setMenu(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await fsMutate("delete", { path: target.path, isDir: target.isDir });
    // The Editor must not keep showing a ghost of a deleted file.
    const open = useApp.getState().editorFile;
    if (open && (open.path === target.path || open.path.startsWith(`${target.path}/`))) {
      useApp.getState().closeEditor();
    }
    if (selected === target.path) setSelected(null);
  };

  const renderLevel = (rel: string, depth: number) => {
    const entries = levels[rel];
    if (!entries) {
      return loadingDir === rel ? (
        <Loader2 size={12} className="ml-2 animate-spin text-[var(--fg-muted)]" />
      ) : null;
    }
    return (
      <ul className={depth === 0 ? "" : "ml-3 border-l border-[var(--border-subtle)] pl-1.5"}>
        {entries.map((entry) => (
          <li key={entry.path}>
            {entry.is_dir ? (
              <button
                type="button"
                onClick={() => toggleDir(entry)}
                {...contextProps(entry)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                style={{ paddingLeft: depth * 10 + 6 }}
              >
                {expanded[entry.path] ? (
                  <ChevronDown size={11} className="shrink-0 text-[var(--fg-muted)]" />
                ) : (
                  <ChevronRight size={11} className="shrink-0 text-[var(--fg-muted)]" />
                )}
                {expanded[entry.path] ? (
                  <FolderOpen size={12} className="shrink-0 text-[var(--accent)]" />
                ) : (
                  <Folder size={12} className="shrink-0 text-[var(--accent)]" />
                )}
                <span className="truncate">{entry.name}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onFile(entry)}
                {...contextProps(entry)}
                className={`flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] ${
                  selected === entry.path
                    ? "bg-[var(--bg-active)] text-[var(--fg-primary)]"
                    : "text-[var(--fg-secondary)]"
                }`}
                style={{ paddingLeft: depth * 10 + 22 }}
              >
                <FileText size={12} className="shrink-0 text-[var(--fg-muted)]" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 text-2xs text-[var(--fg-muted)]">
                  {formatSize(entry.size)}
                </span>
              </button>
            )}
            {entry.is_dir && expanded[entry.path] && renderLevel(entry.path, depth + 1)}
            {/* Inline new-file/new-folder input right under the folder row it
                targets — always renders, even if the level is still loading. */}
            {draft && draft.dirPath === entry.path && draft.kind !== "rename" && (
              <li>
                <InlineNameInput
                  key={`${draft.kind}:${draft.dirPath}`}
                  depth={depth + 1}
                  initial={draft.initial}
                  placeholder={draft.kind === "newFile" ? "file name…" : "folder name…"}
                  onSubmit={() => void submitDraft()}
                  onCancel={() => setDraft(null)}
                />
              </li>
            )}
            {draft && draft.kind === "rename" && draft.target === entry.path && (
              <InlineNameInput
                key={`rename:${draft.target}`}
                depth={depth}
                initial={draft.initial}
                placeholder="new name…"
                autoFocusSelect
                onSubmit={() => void submitDraft()}
                onCancel={() => setDraft(null)}
              />
            )}
          </li>
        ))}
      </ul>
    );
  };

  const headerButton =
    "flex size-5 items-center justify-center rounded-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-[var(--fg-primary)]">
          Files
        </h2>
        <div className="ml-auto flex items-center gap-0.5">
          {/* New file / folder: apply to the project root or the selected dir. */}
          <button
            type="button"
            onClick={() => startNewFile(selectedDirOf(selected, levels))}
            title={t(language, "files.newFile")}
            aria-label={t(language, "files.newFile")}
            className={headerButton}
          >
            <FilePlus2 size={11} />
          </button>
          <button
            type="button"
            onClick={() => startNewFolder(selectedDirOf(selected, levels))}
            title={t(language, "files.newFolder")}
            aria-label={t(language, "files.newFolder")}
            className={headerButton}
          >
            <FolderPlus size={11} />
          </button>
          <button
            type="button"
            onClick={() => void loadLevel("")}
            title="Refresh"
            aria-label="Refresh file tree"
            className={headerButton}
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-2 mb-1 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-2 py-1.5 text-2xs text-[var(--danger)]"
        >
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5" onClick={() => setMenu(null)}>
        {!projectDir ? (
          <p className="px-1 text-xs text-[var(--fg-muted)]">No project open.</p>
        ) : loadingDir === "" && !levels[""] ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-[var(--fg-muted)]">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {renderLevel("", 0)}
            {/* Root-level new-file/folder draft (no parent row to attach to). */}
            {draft && draft.dirPath === "" && draft.kind !== "rename" && (
              <InlineNameInput
                key={`${draft.kind}:root`}
                depth={0}
                initial={draft.initial}
                placeholder={draft.kind === "newFile" ? "file name…" : "folder name…"}
                onSubmit={() => void submitDraft()}
                onCancel={() => setDraft(null)}
              />
            )}
          </>
        )}
      </div>

      {menu && (
        <FileContextMenu
          menu={menu}
          isViewable={isViewable}
          onOpenInBrowser={openInBrowserPanel}
          onOpenExternally={(p) => void openExternally(p)}
          onReveal={(p) => void revealInFileManager(p)}
          onCopyPath={(p) => void copyPath(p)}
          onNewFile={() => startNewFile(menu.isDir ? menu.path : parentOf(menu.path))}
          onNewFolder={() => startNewFolder(menu.isDir ? menu.path : parentOf(menu.path))}
          onRename={() => {
            const entry = findEntry(levels, menu.path);
            if (entry) startRename(entry);
          }}
          onDelete={() => {
            const entry = findEntry(levels, menu.path);
            if (entry) void deleteEntry(entry);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {deleteTarget && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) void setDeleteTarget(null);
          }}
        >
          <div className="w-full max-w-xs rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] p-4 shadow-[var(--shadow-panel)]">
            <p className="text-xs font-semibold text-[var(--danger)]">
              {t(language, "files.deleteConfirm").replace("{{name}}", deleteTarget.name)}
            </p>
            <p className="mt-1.5 text-2xs text-[var(--fg-secondary)]">
              This action can not be undone.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-2xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="rounded-md bg-[var(--danger)] px-3 py-1.5 text-2xs font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The directory a new file/folder should land in: a selected folder means
 * itself, a selected file means its parent, nothing selected means the root.
 */
function selectedDirOf(
  selected: string | null,
  levels: Record<string, FsEntry[]>
): string {
  if (!selected) return "";
  const entry = findEntry(levels, selected);
  if (entry?.is_dir) return entry.path;
  return parentOf(selected);
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function findEntry(
  levels: Record<string, FsEntry[]>,
  path: string
): FsEntry | null {
  for (const entries of Object.values(levels)) {
    const hit = entries.find((e) => e.path === path);
    if (hit) return hit;
  }
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The one-line input for new-file/new-folder/rename, VS Code-style. */
function InlineNameInput({
  initial,
  placeholder,
  depth,
  autoFocusSelect,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  depth: number;
  autoFocusSelect?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (autoFocusSelect) {
      // Rename: select the stem, keep the extension (VS Code behavior).
      const dot = el.value.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
    }
  }, [autoFocusSelect]);
  return (
    <div style={{ paddingLeft: depth * 10 + 6 }} className="py-0.5 pr-1">
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onSubmit}
        className="w-full rounded-xs border border-[var(--accent)] bg-[var(--bg-base)] px-1.5 py-0.5 font-mono text-2xs text-[var(--fg-primary)] focus:outline-none"
      />
    </div>
  );
}

/**
 * Right-click menu for a file or folder — the VS Code set of verbs: open,
 * reveal, copy path, create, rename, delete. Items that cannot work in this
 * runtime are hidden rather than left dead on screen.
 */
function FileContextMenu({
  menu,
  isViewable,
  onOpenInBrowser,
  onOpenExternally,
  onReveal,
  onCopyPath,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onClose,
}: {
  menu: { path: string; absPath: string; isDir: boolean; x: number; y: number };
  isViewable: (path: string) => boolean;
  onOpenInBrowser: (absPath: string) => void;
  onOpenExternally: (absPath: string) => void;
  onReveal: (absPath: string) => void;
  onCopyPath: (absPath: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const language = useApp((s) => s.language);
  const viewable = !menu.isDir && isViewable(menu.path);

  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]";

  const itemBtn = (icon: React.ReactNode, label: string, action: () => void, key?: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        action();
        onClose();
      }}
      className={item}
    >
      {icon}
      {label}
      {key && <span className="ml-auto pl-3 text-2xs text-[var(--fg-muted)]">{key}</span>}
    </button>
  );

  return (
    <div
      className="fixed z-50 min-w-48 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] py-1 shadow-[var(--shadow-panel)]"
      style={{
        left: Math.min(menu.x, window.innerWidth - 200),
        top: Math.min(menu.y, window.innerHeight - 260),
      }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {!menu.isDir && itemBtn(<FileText size={13} className="text-[var(--accent)]" />, t(language, "files.openInEditor"), () => void useApp.getState().openInEditor(menu.path))}
      {viewable &&
        itemBtn(<Globe size={13} className="text-[var(--accent)]" />, t(language, "files.openInBrowser"), () => onOpenInBrowser(menu.absPath))}
      {itemBtn(<ExternalLink size={13} className="text-[var(--fg-muted)]" />, t(language, "files.openExternally"), () => onOpenExternally(menu.absPath))}
      {itemBtn(<FolderOpen size={13} className="text-[var(--fg-muted)]" />, t(language, "files.reveal"), () => onReveal(menu.absPath))}
      {itemBtn(<Copy size={13} className="text-[var(--fg-muted)]" />, t(language, "files.copyPath"), () => onCopyPath(menu.absPath))}

      <div className="my-1 border-t border-[var(--border-subtle)]" />

      {itemBtn(<FilePlus2 size={13} className="text-[var(--fg-muted)]" />, t(language, "files.newFile"), onNewFile)}
      {itemBtn(<FolderPlus size={13} className="text-[var(--fg-muted)]" />, t(language, "files.newFolder"), onNewFolder)}
      {itemBtn(<Pencil size={13} className="text-[var(--fg-muted)]" />, t(language, "files.rename"), onRename, "F2")}
      {itemBtn(<Trash2 size={13} className="text-[var(--danger)]" />, t(language, "files.delete"), onDelete, "Del")}

      <div className="mt-1 border-t border-[var(--border-subtle)] px-3 pb-0.5 pt-1">
        <span className="flex items-center gap-1.5 truncate font-mono text-2xs text-[var(--fg-muted)]">
          <X size={9} className="shrink-0" aria-hidden />
          Esc to close
        </span>
      </div>
    </div>
  );
}
