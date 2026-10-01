import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal as TerminalIcon } from "lucide-react";

/**
 * Command-line window: a live, read-only view of the agent core's stdout
 * (`opencode serve`). It is the window the user can dock into any area to watch
 * the agent's shell/tool output without opening the log modal.
 */
export function TerminalPanel() {
  const [log, setLog] = useState("");
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    const fetchLog = async () => {
      try {
        const text = await invoke<string>("core_log");
        if (alive) setLog(text || "");
      } catch {
        // Core may not be running yet; keep the last output.
      }
    };
    void fetchLog();
    const timer = window.setInterval(() => void fetchLog(), 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5">
        <TerminalIcon size={12} className="text-[var(--accent)]" />
        <span className="text-2xs font-medium text-[var(--fg-secondary)]">Agent output</span>
        <span className="ml-auto font-mono text-2xs text-[var(--fg-muted)]">opencode serve</span>
      </div>
      <pre
        ref={ref}
        className="selectable min-h-0 flex-1 overflow-auto bg-[var(--bg-base)] p-3 font-mono text-2xs leading-relaxed text-[var(--fg-secondary)]"
      >
        {log || "No output yet."}
      </pre>
    </div>
  );
}
