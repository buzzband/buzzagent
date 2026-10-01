import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import {
  highlightEditorTokens,
  type EditorHighlight,
  type CodeTheme,
} from "../../lib/highlight";

/** File extension → Shiki grammar. Keep in step with LANG_LOADERS. */
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  rs: "rust",
  py: "python",
  pyi: "python",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  diff: "diff",
  patch: "diff",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  go: "go",
  toml: "toml",
};

function languageForPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  return EXT_LANG[ext] ?? "text";
}

function resolvedTheme(theme: string): CodeTheme {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme === "light" ? "light" : "dark";
}

/**
 * The Editor window: the file an Explorer click lands in — editable, syntax
 * highlighted, with an explicit Save (Ctrl/Cmd+S too).
 *
 * Highlighting is a Shiki token overlay *behind* a transparent textarea (the
 * CodeMirror/VS Code trick): the textarea keeps native caret, selection and
 * keyboard behavior, while the overlay paints the colors. Both layers use the
 * identical font metrics and scroll together, so text and colors stay glued.
 */
export function EditorWindow() {
  const { editorFile, setEditorContent, saveEditor, closeEditor, language, theme } = useApp(
    useShallow((s) => ({
      editorFile: s.editorFile,
      setEditorContent: s.setEditorContent,
      saveEditor: s.saveEditor,
      closeEditor: s.closeEditor,
      language: s.language,
      theme: s.theme,
    }))
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Highlight result *with the content it was computed from*. */
  const [highlight, setHighlight] = useState<{ content: string; result: EditorHighlight | null }>(
    { content: "", result: null }
  );
  const codeTheme = resolvedTheme(theme);

  const grammar = editorFile ? languageForPath(editorFile.path) : "text";

  // (Re)highlight whenever the content, grammar or app theme settles. Two
  // rules keep typing instant:
  //   * 120ms debounce — a keystroke storm re-tokenizes once, not per key;
  //   * the overlay carries the content it was built from — while it lags
  //     behind the draft, the component renders plain text instead, so every
  //     keystroke is visible the moment it lands and colors re-pigment after.
  const content = editorFile?.content;
  const fileStatus = editorFile?.status;
  useEffect(() => {
    if (!content || fileStatus !== "ready") {
      setHighlight({ content: "", result: null });
      return;
    }
    const timer = window.setTimeout(() => {
      let cancelled = false;
      void highlightEditorTokens(content, grammar, codeTheme).then((result) => {
        if (!cancelled) setHighlight({ content, result });
      });
      return () => {
        cancelled = true;
      };
    }, 120);
    return () => window.clearTimeout(timer);
  }, [content, fileStatus, grammar, codeTheme]);

  // A newly opened file resets the dirty flag; typing sets it again.
  useEffect(() => {
    setDirty(false);
  }, [editorFile?.path]);

  const save = async () => {
    if (!editorFile || saving) return;
    setSaving(true);
    try {
      await saveEditor();
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+S saves without leaving the keyboard.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };

  /** The highlighted overlay: one <span> per Shiki token — only when the
      tokens belong to the *current* draft; otherwise plain text. */
  const overlay = useMemo(() => {
    if (!highlight.result || highlight.content !== content) return null;
    return highlight.result.tokens.map((token, i) => {
      const style: React.CSSProperties = {};
      if (token.color) style.color = token.color;
      if (token.fontStyle) {
        if (token.fontStyle & 1) style.fontStyle = "italic";
        if (token.fontStyle & 2) style.fontWeight = "bold";
        if (token.fontStyle & 4) style.textDecoration = "underline";
      }
      return (
        <span key={i} style={style}>
          {token.text}
        </span>
      );
    });
  }, [highlight, content]);

  if (!editorFile) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[var(--fg-muted)]">
        {t(language, "editor.empty")}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]"
      onKeyDown={onKeyDown}
    >
      {/* Header: path + status + actions */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5">
        <span
          className="min-w-0 flex-1 truncate font-mono text-2xs text-[var(--fg-secondary)]"
          title={editorFile.path}
        >
          {editorFile.path}
          {dirty ? " •" : ""}
        </span>
        <span className="shrink-0 rounded-xs bg-[var(--bg-raised)] px-1.5 py-0.5 font-mono text-2xs text-[var(--fg-muted)]">
          {grammar === "text" ? "plain" : grammar}
        </span>
        {editorFile.status === "loading" && (
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--fg-muted)]" />
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || editorFile.status !== "ready"}
          title={t(language, "editor.save")}
          aria-label={t(language, "editor.save")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)] disabled:opacity-40"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        </button>
        <button
          type="button"
          onClick={() => closeEditor()}
          title={t(language, "editor.close")}
          aria-label={t(language, "editor.close")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
        >
          <X size={13} />
        </button>
      </div>

      {editorFile.status === "error" ? (
        <div
          role="alert"
          className="m-3 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]"
        >
          {editorFile.error}
        </div>
      ) : (
        <HighlightScroll
          content={editorFile.content}
          overlay={overlay ?? editorFile.content}
          onType={(value) => {
            setEditorContent(value);
            setDirty(true);
          }}
          readOnly={editorFile.status !== "ready"}
          path={editorFile.path}
        />
      )}

      {/* Footer hint: save state, in words. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-2xs text-[var(--fg-muted)]">
        {dirty ? (
          <span>{t(language, "editor.unsaved")}</span>
        ) : (
          <span>{t(language, "editor.saved")}</span>
        )}
        <span className="ml-auto">Ctrl+S</span>
      </div>
    </div>
  );
}

/**
 * The two-layer editing surface: colored tokens underneath, transparent
 * textarea on top. Both share the exact same font, padding, tab size and
 * white-space handling; the textarea is the scroll owner and the overlay
 * mirrors its scrollTop every frame it changes (translate3d is cheaper than
 * scrollTop on WebKitGTK and never re-layouts the token DOM).
 */
function HighlightScroll({
  content,
  /** Highlighted token spans — or the raw content string as plain fallback. */
  overlay,
  onType,
  readOnly,
  path,
}: {
  content: string;
  overlay: React.ReactNode;
  onType: (value: string) => void;
  readOnly: boolean;
  path: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const syncScroll = () => {
    const from = inputRef.current;
    const to = overlayRef.current;
    if (!from || !to) return;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
  };

  // Content changes can grow/shrink the text: re-sync after commit too.
  useEffect(syncScroll, [content]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={overlayRef}
        aria-hidden
        className="editor-overlay pointer-events-none absolute inset-0 overflow-hidden p-3"
      >
        <pre className="whitespace-pre-wrap break-words">{overlay}</pre>
      </div>
      <textarea
        ref={inputRef}
        value={content}
        onChange={(e) => onType(e.target.value)}
        onScroll={syncScroll}
        readOnly={readOnly}
        spellCheck={false}
        data-editor-path={path}
        aria-label={path}
        className="editor-input absolute inset-0 h-full w-full resize-none overflow-y-auto bg-transparent p-3 focus:outline-none"
      />
    </div>
  );
}
