import { useEffect, useState } from "react";
import { X, ExternalLink, Copy, Check } from "lucide-react";
import { useApp } from "../store/app";
import { t, PROJECT_URL } from "../lib/i18n";
import { BUILTINS } from "../lib/builtinCommands";
import { copyText, buildId } from "./ErrorBoundary";

/**
 * /help — list the built-in GUI commands plus the project's own commands
 * (GET /command), with an About block pointing at the project site.
 * Opened by the /help and /commands built-ins.
 */
export function HelpModal() {
  const open = useApp((s) => s.helpModalOpen);
  const setOpen = useApp((s) => s.setHelpModalOpen);
  const commands = useApp((s) => s.commands);
  const language = useApp((s) => s.language);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const copySite = async () => {
    if (await copyText(PROJECT_URL)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2.5">
          <h2 className="text-xs font-medium text-[var(--fg-primary)]">
            {t(language, "help.title")}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded p-1 text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
          >
            <X size={13} />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-3">
          {/* ---- About ---- */}
          <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated,transparent)] p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-[var(--fg-primary)]">
                BuzzAgent{" "}
                <span className="font-normal text-[var(--fg-muted)]">
                  · {t(language, "about.title")}
                </span>
              </h3>
              <span className="font-mono text-2xs text-[var(--fg-muted)]">
                build {buildId()}
              </span>
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-[var(--fg-secondary)]">
              {t(language, "about.tagline")}
            </p>
            <button
              type="button"
              onClick={copySite}
              title={t(language, "about.siteHint")}
              className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-left font-mono text-2xs text-[var(--accent)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span className="truncate">{PROJECT_URL}</span>
              <span className="ml-auto shrink-0 text-[var(--fg-muted)]">
                {copied ? t(language, "about.copied") : t(language, "about.copy")}
              </span>
            </button>
            <a
              href={PROJECT_URL}
              onClick={(e) => {
                // Webview navigation is not permitted here; plain browsers
                // open the link themselves when the app runs as a web page.
                if ("__TAURI_INTERNALS__" in window) e.preventDefault();
              }}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 flex items-center gap-1 text-2xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
            >
              <ExternalLink size={10} />
              b4zz.com/agent
            </a>
          </div>

          <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
            {t(language, "help.builtins")}
          </p>
          {BUILTINS.map((c) => (
            <div key={c.name} className="flex items-baseline gap-2 px-1 py-1">
              <span className="font-mono text-xs text-[var(--accent)]">
                /{c.name}
                {c.argHint ? <span className="text-[var(--fg-muted)]"> {c.argHint}</span> : null}
              </span>
              <span className="text-2xs text-[var(--fg-secondary)]">
                {t(language, `help.cmd.${c.name}`, c.description)}
              </span>
            </div>
          ))}
          <p className="mt-2 text-2xs text-[var(--fg-muted)]">{t(language, "help.hints")}</p>

          {commands.length > 0 && (
            <>
              <p className="mb-1 mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-2xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                {t(language, "help.project")}
              </p>
              {commands.map((c) => (
                <div key={c.name} className="flex items-baseline gap-2 px-1 py-1">
                  <span className="font-mono text-xs text-[var(--accent)]">/{c.name}</span>
                  <span className="truncate text-2xs text-[var(--fg-secondary)]">
                    {c.description ?? ""}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
