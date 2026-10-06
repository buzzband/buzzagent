import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  KeyRound,
  PlugZap,
  RefreshCw,
  ScrollText,
  ServerCrash,
  Settings,
  Timer,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import { formatErrorReport, type ClassifiedError, type ErrorKind } from "../../lib/errors";

/** Icon per classified kind; unknown kinds get the generic warning. */
const KIND_ICON: Record<ErrorKind, typeof AlertTriangle> = {
  auth: KeyRound,
  balance: Wallet,
  "rate-limit": Zap,
  timeout: Timer,
  network: PlugZap,
  "not-found": AlertTriangle,
  server: ServerCrash,
  provider: AlertTriangle,
};

function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // WebView fallback for older environments.
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);

  return { copied, copy };
}

/**
 * Context actions per kind: the fastest path from an error to its fix.
 * Auth/balance errors open Providers; core-origin errors open the core log.
 */
function kindActions(kind: ErrorKind, source: string): { key: "providers" | "core-log" }[] {
  if (kind === "auth" || kind === "balance" || kind === "not-found") {
    return [{ key: "providers" }];
  }
  if (kind === "server" || source === "core") return [{ key: "core-log" }];
  return [];
}

/**
 * A single error rendered in full: classified headline, the verbatim message,
 * an expandable raw-detail section and a copy button that serialises
 * everything (kind, time, status, provider, model, session, message, detail).
 */
export function ErrorCard({
  error,
  onClose,
  compact = false,
}: {
  error: ClassifiedError;
  /** Hide the dismiss button (message-embedded cards stay with the message). */
  onClose?: () => void;
  compact?: boolean;
}) {
  const { language, errorDetailOpen, toggleErrorDetail, openSettingsAt } = useApp(
    useShallow((s) => ({
      language: s.language,
      errorDetailOpen: s.errorDetailOpen,
      toggleErrorDetail: s.toggleErrorDetail,
      openSettingsAt: s.openSettingsAt,
    }))
  );
  const { copied, copy } = useCopy();
  const Icon = KIND_ICON[error.kind] ?? AlertTriangle;
  const actions = kindActions(error.kind, error.source);

  const report = formatErrorReport(error);

  return (
    <div
      role="alert"
      className={`rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-subtle)] ${compact ? "px-3 py-2" : "px-3.5 py-3"}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon size={15} className="mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-semibold text-[var(--danger)]">
              {t(language, `error.kind.${error.kind}`)}
            </span>
            {error.status !== undefined && (
              <span className="rounded bg-[var(--danger)]/10 px-1.5 py-0.5 font-mono text-2xs text-[var(--danger)]">
                HTTP {error.status}
              </span>
            )}
            {error.modelID && (
              <span className="font-mono text-2xs text-[var(--fg-muted)]">
                {error.providerID ? `${error.providerID}/` : ""}
                {error.modelID}
              </span>
            )}
            <span className="text-2xs text-[var(--fg-muted)]">
              {new Date(error.time).toLocaleTimeString()}
            </span>
          </div>

          <div className="selectable mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--fg-primary)]">
            {error.message}
          </div>

          <button
            type="button"
            onClick={toggleErrorDetail}
            className="mt-1.5 flex items-center gap-1 text-2xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
          >
            {errorDetailOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {t(language, errorDetailOpen ? "error.hideDetails" : "error.details")}
          </button>
          {errorDetailOpen && (
            <pre className="selectable mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg-raised)] px-2.5 py-2 font-mono text-2xs leading-relaxed text-[var(--fg-secondary)]">
              {error.detail ?? t(language, "error.noDetails")}
            </pre>
          )}

          <div className="mt-2 flex items-center gap-1.5">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={() => {
                  if (action.key === "providers") {
                    openSettingsAt("providers");
                  } else {
                    // StatusBar owns the CoreLogModal and listens for this.
                    window.dispatchEvent(new CustomEvent("buzzagent:open-core-log"));
                  }
                }}
                className="flex items-center gap-1 rounded-md bg-[var(--accent-subtle)] px-2 py-1 text-2xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-hover)]/20"
              >
                {action.key === "providers" ? <Settings size={11} /> : <ScrollText size={11} />}
                {t(language, action.key === "providers" ? "error.actionProviders" : "error.actionCoreLog")}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void copy(report)}
              className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]"
            >
              {copied ? <Check size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
              {t(language, copied ? "error.copied" : "error.copy")}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
              >
                <X size={11} />
                {t(language, "error.dismiss")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Error display INSIDE the chat area, not under the composer — the user asked
 * for errors to live only in the chat itself. With messages present it renders
 * as the last item of the scrolled conversation (so the scroll-follow logic
 * naturally brings it into view); with an empty chat it shows under the empty
 * state. Never docked at the bottom of the window.
 *
 * Suppression: failures that already render inline — a failed message's own
 * ErrorCard, or the failing tool's card — carry the originating messageID/
 * callID. The banner hides for those (the user saw the same error twice:
 * once in the conversation and again above the composer). Store-level failures
 * with no inline carrier (connection drop, core crash) still show here.
 */
export function ChatErrorBanner() {
  const { lastError, clearError, messages } = useApp(
    useShallow((s) => ({
      lastError: s.lastError,
      clearError: s.clearError,
      messages: s.messages,
    }))
  );
  if (!lastError) return null;
  if (lastError.messageID || lastError.callID) {
    const renderedInline = messages.some((m) => {
      if (lastError.messageID && m.info.id === lastError.messageID) {
        if (m.info.error) return true;
        if (
          lastError.callID &&
          m.parts.some(
            (p) => p.type === "tool" && p.callID === lastError.callID && p.state?.status === "error"
          )
        ) {
          return true;
        }
      }
      return false;
    });
    if (renderedInline) return null;
  }
  return (
    <div className="px-4 py-2">
      <ErrorCard error={lastError} onClose={clearError} />
    </div>
  );
}

/** Small helper for components that only need to re-report a stored error. */
export function useErrorReporter() {
  const reportError = useApp((s) => s.reportError);
  const { lastError } = useApp();
  return {
    reportError,
    retry: () => {
      if (lastError) reportError({ ...lastError, message: `${lastError.message} (retried at ${new Date().toLocaleTimeString()})` });
    },
    RefreshIcon: RefreshCw,
  };
}
