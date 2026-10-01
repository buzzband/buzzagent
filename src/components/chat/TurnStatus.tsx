import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

/**
 * Live turn status: "Thinking 12s…" while the model streams, and — when the
 * provider call fails and the core schedules a retry — the actual reason:
 * "Retry 2 · Provider response headers timed out after 300000ms".
 *
 * This exists because the core can sit in a retry loop for minutes (5-minute
 * provider header timeouts) while the UI showed nothing but a silent spinner.
 * The elapsed counter re-renders once per second while a turn is active.
 */
export function TurnStatus() {
  const busy = useApp((s) => s.busy);
  const turnStatus = useApp((s) => s.turnStatus);
  const language = useApp((s) => s.language);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  if (!busy || !turnStatus) return null;

  const seconds = Math.max(0, Math.floor((Date.now() - turnStatus.since) / 1000));
  const isRetry = turnStatus.type === "retry";

  return (
    <div
      className="flex items-center gap-2 px-1 py-1 text-xs text-[var(--fg-muted)]"
      role="status"
      aria-live="polite"
    >
      <Loader2 size={13} className="shrink-0 animate-spin text-[var(--accent)]" />
      {isRetry ? (
        <span className="min-w-0 truncate text-[var(--warning)]">
          {t(language, "turn.retry")
            .replace("{n}", String(turnStatus.attempt ?? 1))}
          {turnStatus.message ? ` — ${turnStatus.message}` : ""}
        </span>
      ) : (
        <span className="min-w-0 truncate">
          {t(language, "turn.thinking").replace("{s}", String(seconds))}
        </span>
      )}
    </div>
  );
}
