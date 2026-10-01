import { useEffect } from "react";
import { X } from "lucide-react";
import { useApp } from "../store/app";
import { t } from "../lib/i18n";
import { BUILTINS } from "../lib/builtinCommands";

/**
 * /help — list the built-in GUI commands plus the project's own commands
 * (GET /command). Opened by the /help and /commands built-ins.
 */
export function HelpModal() {
  const open = useApp((s) => s.helpModalOpen);
  const setOpen = useApp((s) => s.setHelpModalOpen);
  const commands = useApp((s) => s.commands);
  const language = useApp((s) => s.language);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

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
