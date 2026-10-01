import { Clock, Cpu, Wrench, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";

export function MessageQueue() {
  const { queue, removeFromQueue, clearQueue, busy } = useApp(
    useShallow((s) => ({
      queue: s.queue,
      removeFromQueue: s.removeFromQueue,
      clearQueue: s.clearQueue,
      busy: s.busy,
    }))
  );

  if (queue.length === 0) return null;

  return (
    <div className="mx-4 mb-2 overflow-hidden rounded-lg border border-[var(--accent)]/30 bg-[var(--bg-surface)] shadow-xs">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--accent-subtle)]/40 px-3 py-1.5 text-2xs">
        <div className="flex items-center gap-1.5 font-medium text-[var(--accent)]">
          <Clock size={12} className={busy ? "animate-spin" : ""} />
          <span>Scheduled Queue ({queue.length} task{queue.length === 1 ? "" : "s"})</span>
        </div>
        <button
          type="button"
          onClick={clearQueue}
          className="text-2xs text-[var(--fg-muted)] hover:text-[var(--danger)]"
        >
          Clear Queue
        </button>
      </div>

      <div className="max-h-36 overflow-y-auto divide-y divide-[var(--border-subtle)]">
        {queue.map((item, idx) => (
          <div
            key={item.id}
            className="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-[var(--bg-hover)]"
          >
            <span className="shrink-0 font-mono text-2xs font-semibold text-[var(--accent)]">
              #{idx + 1}
            </span>

            <span className="min-w-0 flex-1 truncate text-[var(--fg-primary)]" title={item.text}>
              {item.text}
            </span>

            <div className="flex shrink-0 items-center gap-1.5 text-2xs">
              <span className="flex items-center gap-1 rounded bg-[var(--bg-raised)] px-1.5 py-0.5 font-mono text-[var(--fg-secondary)]">
                <Cpu size={10} />
                {item.model.modelID}
              </span>

              {item.agent && (
                <span className="flex items-center gap-1 rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[var(--fg-muted)]">
                  <Wrench size={10} />
                  {item.agent}
                </span>
              )}

              <button
                type="button"
                onClick={() => removeFromQueue(item.id)}
                title="Remove from queue"
                className="rounded p-0.5 text-[var(--fg-muted)] hover:text-[var(--danger)]"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
