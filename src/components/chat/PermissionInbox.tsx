import { ShieldAlert, Terminal } from "lucide-react";
import { useApp } from "../../store/app";
import type { PermissionRequest } from "../../core/types";

/** Pull a human-readable description out of a loosely-typed payload. */
function detail(request: PermissionRequest): string | null {
  const meta = request.metadata;
  if (!meta) return null;
  for (const key of ["command", "cmd", "filePath", "path", "url", "description"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/**
 * Permission prompt.
 *
 * The core gates destructive tools (shell, writes) behind an explicit user
 * response. Nothing here auto-approves, and "Always allow" is deliberately not
 * the primary action — it is the one that removes the gate for good.
 */
export function PermissionPrompt({ request }: { request: PermissionRequest }) {
  const answer = useApp((s) => s.answerPermission);
  const text = detail(request);
  const isShell = (request.tool ?? "").toLowerCase().includes("bash");

  return (
    <div
      role="alertdialog"
      aria-label="Permission required"
      className="mx-4 mb-3 overflow-hidden rounded-lg border border-[var(--warning)]/50 bg-[var(--warning-subtle)]"
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div className="mt-0.5 text-[var(--warning)]">
          {isShell ? <Terminal size={15} /> : <ShieldAlert size={15} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--fg-primary)]">
            {request.title || "The agent needs permission"}
          </div>

          {request.tool && (
            <div className="mt-0.5 font-mono text-2xs text-[var(--fg-muted)]">
              {request.tool}
            </div>
          )}

          {text && (
            <pre className="selectable mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--bg-base)]/60 px-2.5 py-1.5 font-mono text-xs text-[var(--fg-secondary)]">
              {text}
            </pre>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void answer(request.id, "once")}
              className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)]"
            >
              Allow once
            </button>
            <button
              type="button"
              onClick={() => void answer(request.id, "reject")}
              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1 text-xs text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
            >
              Deny
            </button>
            <button
              type="button"
              onClick={() => void answer(request.id, "always")}
              title="Stop asking for this tool in this session"
              className="ml-auto text-2xs text-[var(--fg-muted)] underline underline-offset-2 transition-colors hover:text-[var(--fg-secondary)]"
            >
              Always allow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** All pending requests, newest last so the oldest is answered first. */
export function PermissionInbox() {
  const permissions = useApp((s) => s.permissions);
  if (!permissions.length) return null;
  return (
    <div>
      {permissions.map((request) => (
        <PermissionPrompt key={request.id} request={request} />
      ))}
    </div>
  );
}
