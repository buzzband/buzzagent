import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Scissors,
  TextSelect,
} from "lucide-react";
import { useApp } from "../store/app";
import { t } from "../lib/i18n";

/**
 * Global right-click menu for the whole app.
 *
 * WebKitGTK ships no native context menu, so right-click used to do nothing
 * outside the file tree (which has its own menu). This fills the gap with the
 * universal edit verbs — driven through the Tauri clipboard plugin API — so
 * text fields, selected chat text and code blocks behave like users expect.
 * Elements can opt out or extend it via `data-ctx="false"`.
 */

/** Read the editable root the user right-clicked, if any. */
function editableTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>("input, textarea, [contenteditable='true']");
}

export function AppContextMenu() {
  const language = useApp((s) => s.language);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [editable, setEditable] = useState(false);

  useEffect(() => {
    // The native GTK menu is suppressed so ours is the only one.
    const suppress = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-ctx='native']")) return;
      event.preventDefault();

      const selection = window.getSelection();
      const selected = Boolean(selection && selection.toString().length > 0);
      const field = editableTarget(event.target);
      setHasSelection(selected);
      setEditable(Boolean(field));
      setPos({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("contextmenu", suppress);
    return () => window.removeEventListener("contextmenu", suppress);
  }, []);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [pos]);

  if (!pos) return null;

  const write = (text: string) => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  const copySelection = () => {
    const text = window.getSelection()?.toString() ?? "";
    if (text) write(text);
  };

  const pasteInto = () => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (!text) return;
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement
        ) {
          // Straightforward case: a focused text field.
          const start = active.selectionStart ?? active.value.length;
          const end = active.selectionEnd ?? active.value.length;
          const next = active.value.slice(0, start) + text + active.value.slice(end);
          active.value = next;
          const caret = start + text.length;
          active.setSelectionRange(caret, caret);
          active.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          const field = editableTarget(document.activeElement);
          if (field?.isContentEditable) {
            field.focus();
            document.execCommand("insertText", false, text);
          }
        }
      })
      .catch(() => undefined);
  };

  const selectAll = () => {
    const field = editableTarget(document.activeElement);
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.select();
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(document.body);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)] disabled:opacity-40 disabled:hover:bg-transparent";
  const keycap =
    "ml-auto pl-3 font-mono text-2xs text-[var(--fg-muted)]";

  const entries: React.ReactNode[] = [];
  if (hasSelection) {
    entries.push(
      <button key="copy" type="button" className={item} onClick={copySelection}>
        <Copy size={13} />
        {t(language, "ctx.copy")}
        <span className={keycap}>Ctrl+C</span>
      </button>,
      <button
        key="cut"
        type="button"
        className={item}
        disabled={!editable}
        onClick={() => {
          copySelection();
          document.execCommand("delete");
        }}
      >
        <Scissors size={13} />
        {t(language, "ctx.cut")}
        <span className={keycap}>Ctrl+X</span>
      </button>
    );
  }
  entries.push(
    <button key="paste" type="button" className={item} onClick={pasteInto}>
      <ClipboardPaste size={13} />
      {t(language, "ctx.paste")}
      <span className={keycap}>Ctrl+V</span>
    </button>
  );
  if (editable) {
    entries.push(
      <button key="selectall" type="button" className={item} onClick={selectAll}>
        <TextSelect size={13} />
        {t(language, "ctx.selectAll")}
        <span className={keycap}>Ctrl+A</span>
      </button>
    );
  }
  if (hasSelection) {
    entries.push(
      <button
        key="copybackend"
        type="button"
        className={item}
        onClick={() => {
          copySelection();
          // Belt and braces: some WebKit builds block webview clipboard writes
          // for non-editable content; the backend clipboard always works.
          const text = window.getSelection()?.toString() ?? "";
          if (text) void invoke("clipboard_write_text", { text }).catch(() => undefined);
        }}
      >
        <ClipboardCopy size={13} />
        {t(language, "ctx.copyAlt")}
      </button>
    );
  }

  return (
    <div
      className="fixed z-[100] min-w-44 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] py-1 shadow-[var(--shadow-panel)]"
      style={{
        left: Math.min(pos.x, window.innerWidth - 190),
        top: Math.min(pos.y, window.innerHeight - 200),
      }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries}
    </div>
  );
}
