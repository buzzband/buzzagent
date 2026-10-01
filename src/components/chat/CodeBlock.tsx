import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getCached, highlight, type CodeTheme } from "../../lib/highlight";
import { useApp } from "../../store/app";

function resolvedTheme(theme: string): CodeTheme {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme === "light" ? "light" : "dark";
}

interface Props {
  code: string;
  language: string;
  /** Streaming blocks skip the copy affordance until they settle. */
  streaming?: boolean;
  filename?: string;
}

/**
 * A code block that never flashes.
 *
 * Plain text renders on the first frame; highlighted HTML swaps in when ready.
 * Because both render into the same <pre> geometry, the swap causes no layout
 * shift — which is the whole point while tokens are still arriving.
 */
export function CodeBlock({ code, language, streaming, filename }: Props) {
  const theme = useApp((s) => s.theme);
  const codeTheme = resolvedTheme(theme);
  const [html, setHtml] = useState<string | null>(() =>
    getCached(code, language, codeTheme)
  );
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    // While the block is still streaming, render plain text and skip Shiki
    // entirely: every token would otherwise schedule a full re-highlight of
    // the growing block, which is the single heaviest thing in the chat.
    if (streaming) {
      setHtml(null);
      return;
    }
    let cancelled = false;
    const cachedNow = getCached(code, language, codeTheme);
    if (cachedNow) {
      setHtml(cachedNow);
      return;
    }
    // Keep showing the previous render until the new one is ready.
    void highlight(code, language, codeTheme).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, codeTheme, streaming]);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked; failing silently is better than a crash.
    }
  };

  return (
    <div className="code-block group relative my-2 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-3 py-1.5">
        <span className="font-mono text-2xs text-[var(--fg-muted)]">
          {filename ?? language}
        </span>
        {!streaming && (
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy code"}
            className="flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-2xs text-[var(--fg-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)] focus-visible:opacity-100 group-hover:opacity-100"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {html ? (
        // Shiki output is generated locally from the model's text; it is not
        // arbitrary remote HTML.
        <div className="selectable" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="selectable">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
