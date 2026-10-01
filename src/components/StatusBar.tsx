import { useEffect, useMemo, useState } from "react";
import { Circle, Coins, PanelLeftOpen, ScrollText, ShieldCheck } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../store/app";
import { t } from "../lib/i18n";
import { buildId } from "./ErrorBoundary";
import { CoreLogModal } from "./CoreLogModal";
import { contextPercent, fmtCompact as fmt, sessionUsage } from "../lib/sessionUsage";

/**
 * Status bar.
 *
 * Its job is to make the invisible visible: is the core actually running, which
 * version, and is anything phoning home. A silent failure here is the worst
 * outcome, so the core's own log is one click away.
 */
export function StatusBar() {
  const { core, busy, turnStatus, layout, toggleArea, pinnedVersion, projectDir, language, messages, model, providers } =
    useApp(
      useShallow((s) => ({
        core: s.core,
        busy: s.busy,
        turnStatus: s.turnStatus,
        layout: s.layout,
        toggleArea: s.toggleArea,
        pinnedVersion: s.pinnedVersion,
        projectDir: s.projectDir,
        language: s.language,
        messages: s.messages,
        model: s.model,
        providers: s.providers,
      }))
    );
  const [logOpen, setLogOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);

  const usage = useMemo(() => sessionUsage(messages), [messages]);
  const contextLimit = useMemo(() => {
    if (!model || !providers) return null;
    const def = providers.all.find((p) => p.id === model.providerID)?.models?.[model.modelID];
    return def?.limit?.context ?? null;
  }, [model, providers]);
  const contextPct = contextPercent(usage, contextLimit);

  // ErrorCard asks to show the core log for core-origin errors: listen once.
  useEffect(() => {
    const open = () => setLogOpen(true);
    window.addEventListener("buzzagent:open-core-log", open);
    return () => window.removeEventListener("buzzagent:open-core-log", open);
  }, []);

  const running = core?.state === "running";
  const failed = core?.state === "failed";

  return (
    <>
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-2xs text-[var(--fg-muted)]">
        {!layout.areaVisible.left && (
          <button
            type="button"
            onClick={() => toggleArea("left")}
            title="Show left sidebar"
            aria-label="Show left sidebar"
            className="flex size-4 items-center justify-center rounded-xs hover:text-[var(--fg-primary)]"
          >
            <PanelLeftOpen size={12} />
          </button>
        )}

        <span className="flex items-center gap-1.5" title={core?.error ?? undefined}>
          <Circle
            size={7}
            fill="currentColor"
            className={
              failed
                ? "text-[var(--danger)]"
                : running
                  ? busy
                    ? "animate-pulse text-[var(--warning)]"
                    : "text-[var(--success)]"
                  : "text-[var(--fg-muted)]"
            }
          />
          {failed
            ? t(language, "status.failed")
            : running
              ? busy && turnStatus?.type === "retry"
                ? t(language, "turn.retry").replace("{n}", String(turnStatus.attempt ?? 1))
                : busy
                  ? t(language, "status.working")
                  : t(language, "status.ready")
              : t(language, "status.stopped")}
        </span>

        {core?.version && (
          <span
            className="font-mono"
            title={t(language, "status.versionHint")}
          >
            opencode {core.version}
            {pinnedVersion && core.version !== pinnedVersion && (
              <span className="ml-1 text-[var(--warning)]" title={t(language, "status.unpinnedHint")}>
                (unpinned)
              </span>
            )}
          </span>
        )}

        {core && !core.managed && (
          <span title={t(language, "status.attachedHint")}>
            {t(language, "status.attached")}
          </span>
        )}

        {/* Session usage chip: tokens, context bar and cost (like /context + /cost). */}
        <span className="relative ml-auto flex items-center gap-3">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setUsageOpen(!usageOpen)}
              title="Session token usage and cost"
              className="flex items-center gap-1.5 rounded px-1 py-0.5 font-mono transition-colors hover:text-[var(--fg-primary)]"
            >
              <Coins size={10} className="text-[var(--warning)]" />
              <span>{fmt(usage.input)}→{fmt(usage.output)}</span>
              {contextPct !== null && (
                <span className="flex h-1 w-12 overflow-hidden rounded-full bg-[var(--border-subtle)]">
                  <span
                    className={`h-full ${
                      contextPct > 85
                        ? "bg-[var(--danger)]"
                        : contextPct > 60
                          ? "bg-[var(--warning)]"
                          : "bg-[var(--success)]"
                    }`}
                    style={{ width: `${contextPct}%` }}
                  />
                </span>
              )}
              {usage.cost > 0 && <span>${usage.cost.toFixed(3)}</span>}
            </button>
          )}
          <span className="flex items-center gap-1" title="No analytics, no tracking, no crash reporting">
            <ShieldCheck size={10} className="text-[var(--success)]" />
            {t(language, "status.noTelemetry")}
          </span>

          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="flex items-center gap-1 hover:text-[var(--fg-primary)]"
            title={t(language, "status.logHint")}
          >
            <ScrollText size={10} />
            {t(language, "status.log")}
          </button>

          {/* Exact download id: rebuilds share one version string, so "which
              build do you run" must be answerable at a glance. */}
          <span
            className="selectable font-mono"
            title={`BuzzAgent ${pinnedVersion ?? ""} build ${buildId()} — include this in bug reports`}
          >
            b.{buildId()}
          </span>

          {projectDir && (
            <span className="selectable max-w-64 truncate font-mono" title={projectDir}>
              {projectDir}
            </span>
          )}

          {/* Usage popover: totals + per-message breakdown (last turns). */}
          {usageOpen && messages.length > 0 && (
            <div className="absolute bottom-full right-0 z-30 mb-1.5 w-72 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] p-2.5 shadow-[var(--shadow-panel)]">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-2xs text-[var(--fg-secondary)]">
                <span>input</span><span className="text-right">{usage.input.toLocaleString()}</span>
                <span>output</span><span className="text-right">{usage.output.toLocaleString()}</span>
                <span>reasoning</span><span className="text-right">{usage.reasoning.toLocaleString()}</span>
                <span>cache read</span><span className="text-right">{usage.cacheRead.toLocaleString()}</span>
                <span>cache write</span><span className="text-right">{usage.cacheWrite.toLocaleString()}</span>
                <span>cost</span><span className="text-right">${usage.cost.toFixed(4)}</span>
              </div>
              {contextLimit && (
                <p className="mt-1.5 border-t border-[var(--border-subtle)] pt-1.5 text-2xs text-[var(--fg-muted)]">
                  context ≈ {fmt(usage.input + usage.cacheRead)} / {fmt(contextLimit)} ({contextPct}%)
                  {contextPct !== null && contextPct > 60 && 
                    " — consider /compact"}
                </p>
              )}
              <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto border-t border-[var(--border-subtle)] pt-1.5">
                {[...messages]
                  .filter((m) => m.info?.tokens)
                  .slice(-10)
                  .reverse()
                  .map((m) => (
                    <div key={m.info.id} className="flex items-center justify-between gap-2 font-mono text-2xs">
                      <span className={m.info.role === "user" ? "text-[var(--fg-muted)]" : "text-[var(--fg-secondary)]"}>
                        {m.info.role === "user" ? "you" : "agent"}
                      </span>
                      <span className="text-[var(--fg-muted)]">
                        {fmt(m.info.tokens!.input)}→{fmt(m.info.tokens!.output)}
                        {(m.info.cost ?? 0) > 0 && ` · $${m.info.cost!.toFixed(4)}`}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </span>
      </div>

      <CoreLogModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Agent Core Logs"
        initialError={core?.error}
      />
    </>
  );
}
