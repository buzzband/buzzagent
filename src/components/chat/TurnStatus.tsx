import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import { BeeWorking } from "./BeeWorking";

/**
 * Live turn status: the buzzing bee + "BuzzAgent is working… 12s" while the
 * model streams or tools run, plus the running tool's name and — when the
 * provider call fails and the core schedules a retry — the actual reason
 * ("Retry 2 · getaddrinfo ETIMEOUT").
 *
 * The bee exists because a silent spinner left users unsure whether the agent
 * was doing anything at all. v2 emits no "busy" status frame, so `busy` alone
 * (set the moment a prompt is sent) must always surface this indicator.
 */
export function TurnStatus() {
  const { busy, turnStatus, messages, language } = useApp(
    useShallow((s) => ({
      busy: s.busy,
      turnStatus: s.turnStatus,
      messages: s.messages,
      language: s.language,
    }))
  );
  const [, tick] = useState(0);
  const busySince = useRef<number | null>(null);

  // Track when the current turn started, so the counter is right even when
  // no status frame ever arrives.
  useEffect(() => {
    if (busy && busySince.current === null) busySince.current = Date.now();
    if (!busy) busySince.current = null;
  }, [busy]);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  if (!busy) return null;

  const since = turnStatus?.since ?? busySince.current ?? Date.now();
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const isRetry = turnStatus?.type === "retry";

  // Most recent tool still running/streaming, if any — names what the agent
  // is doing right now ("bash …"), not just that it is busy.
  let runningTool: string | undefined;
  for (let i = messages.length - 1; i >= 0 && !runningTool; i -= 1) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j];
      if (
        part.type === "tool" &&
        (part.state?.status === "running" || part.state?.status === "streaming")
      ) {
        runningTool = part.tool ?? part.callID ?? "tool";
        break;
      }
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-1 my-1 flex items-center gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-subtle)]/40 px-3 py-2"
    >
      <BeeWorking />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-[var(--fg-primary)]">
            {t(language, "turn.working")}
          </span>
          <span className="font-mono text-2xs text-[var(--fg-muted)]">{seconds}s</span>
        </div>
        <div
          className={`truncate text-2xs ${
            isRetry ? "text-[var(--warning)]" : "text-[var(--fg-muted)]"
          }`}
        >
          {isRetry
            ? `${t(language, "turn.retry").replace("{n}", String(turnStatus?.attempt ?? 1))}${
                turnStatus?.message ? ` — ${turnStatus.message}` : ""
              }`
            : runningTool
              ? `${runningTool} …`
              : ""}
        </div>
        <div className="bee-shimmer-bar mt-1.5" />
      </div>
    </div>
  );
}
