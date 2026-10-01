import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, RefreshCw, Terminal, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  initialError?: string | null;
}

export function CoreLogModal({ open, onClose, title = "Agent Core Logs", initialError }: Props) {
  const [log, setLog] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);

  const fetchLog = async () => {
    setLoading(true);
    try {
      const text = await invoke<string>("core_log");
      setLog(text || "(No log entries recorded yet)");
    } catch (e) {
      setLog(`Failed to fetch log: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void fetchLog();
      const timer = window.setInterval(() => void fetchLog(), 1500);
      return () => window.clearInterval(timer);
    }
  }, [open]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, log]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copy = async () => {
    const fullText = (initialError ? `Error: ${initialError}\n\n` : "") + log;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignored
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-[var(--accent)]" />
            <h3 className="text-xs font-semibold text-[var(--fg-primary)]">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
            >
              {copied ? <Check size={12} className="text-[var(--success)]" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => void fetchLog()}
              disabled={loading}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
              title="Close (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Initial error if any */}
        {initialError && (
          <div className="border-b border-[var(--danger)]/30 bg-[var(--danger-subtle)] px-4 py-2 text-xs text-[var(--danger)]">
            <span className="font-semibold">Startup failure: </span>
            <span className="font-mono">{initialError}</span>
          </div>
        )}

        {/* Log body */}
        <pre
          ref={scrollRef}
          className="selectable min-h-[220px] flex-1 overflow-auto bg-[var(--bg-base)] p-4 font-mono text-2xs leading-relaxed text-[var(--fg-secondary)]"
        >
          {log}
        </pre>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-2xs text-[var(--fg-muted)]">
          <span>Live output from <code>opencode serve</code> process</span>
          <span>Press <kbd className="font-sans">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
