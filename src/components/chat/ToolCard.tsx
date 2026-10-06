import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileSearch,
  Globe,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { Part } from "../../core/types";
import { CodeBlock } from "./CodeBlock";

/** Icon per tool family — recognisable at a glance while scanning a session. */
function toolIcon(tool: string) {
  const name = tool.toLowerCase();
  if (name.includes("bash") || name.includes("shell")) return Terminal;
  if (name.includes("edit") || name.includes("patch")) return FileEdit;
  if (name.includes("write")) return FilePlus;
  if (name.includes("read")) return FileSearch;
  if (name.includes("grep") || name.includes("search") || name.includes("glob"))
    return Search;
  if (name.includes("browser") || name.includes("fetch") || name.includes("web"))
    return Globe;
  return Wrench;
}

/**
 * A one-line summary of what the tool is actually doing, so the common case
 * needs no expansion. Falls back to nothing rather than dumping raw JSON.
 */
function summarise(tool: string, input?: Record<string, unknown>): string | null {
  if (!input) return null;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return null;
  };

  const name = tool.toLowerCase();
  if (name.includes("bash") || name.includes("shell")) return pick("command", "cmd");
  if (name.includes("grep") || name.includes("search")) return pick("pattern", "query");
  if (name.includes("glob") || name.includes("find")) return pick("pattern", "query", "path");
  if (name.includes("browser") || name.includes("fetch")) return pick("url", "selector");
  return pick("filePath", "path", "file", "query", "description");
}

function duration(part: Part): string | null {
  const start = part.state?.time?.start ?? part.time?.start;
  const end = part.state?.time?.end ?? part.time?.end;
  if (!start || !end || end < start) return null;
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

/** Language for the output pane, so a diff or JSON result reads properly. */
function outputLanguage(tool: string, output: string): string {
  const name = tool.toLowerCase();
  if (name.includes("edit") || name.includes("patch") || name.includes("diff"))
    return "diff";
  const trimmed = output.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "text";
}

export function ToolCard({ part }: { part: Part }) {
  const [open, setOpen] = useState(false);
  const tool = part.tool ?? "tool";
  const state = part.state;
  const status = state?.status ?? "pending";
  const Icon = toolIcon(tool);
  const summary = summarise(tool, state?.input);
  const took = duration(part);

  const running = status === "running" || status === "pending";
  const failed = status === "error";

  const statusColor = failed
    ? "text-[var(--danger)]"
    : running
      ? "text-[var(--fg-muted)]"
      : "text-[var(--success)]";

  const hasDetail = Boolean(state?.input || state?.output || state?.error);

  return (
    <div
      className={`my-1.5 overflow-hidden rounded-md border bg-[var(--bg-raised)] transition-colors ${
        failed ? "border-[var(--danger)]/40" : "border-[var(--border-subtle)]"
      }`}
    >
      <button
        type="button"
        onClick={() => hasDetail && setOpen(!open)}
        aria-expanded={open}
        disabled={!hasDetail}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:hover:bg-transparent"
      >
        {hasDetail ? (
          <ChevronRight
            size={13}
            className={`shrink-0 text-[var(--fg-muted)] transition-transform ${open ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-[13px]" />
        )}

        <Icon size={14} className={`shrink-0 ${statusColor}`} />

        <span className="shrink-0 font-mono text-xs font-medium text-[var(--fg-primary)]">
          {state?.title || tool}
        </span>

        {summary && (
          <span className="truncate font-mono text-2xs text-[var(--fg-muted)]">
            {summary}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {took && <span className="text-2xs text-[var(--fg-muted)]">{took}</span>}
          {running && <Loader2 size={12} className="animate-spin text-[var(--fg-muted)]" />}
          {status === "completed" && <Check size={12} className="text-[var(--success)]" />}
          {failed && <AlertCircle size={12} className="text-[var(--danger)]" />}
        </span>
      </button>

      {/* A failed tool always shows its error text inline (not behind a
          click): the chat error banner suppresses itself for these failures,
          so this card is the only place the message appears. */}
      {(open || failed) && hasDetail && (
        <div className="border-t border-[var(--border-subtle)] px-2.5 pb-2">
          {state?.input && (open || !failed) && Object.keys(state.input).length > 0 && (
            <Detail label="Input">
              <CodeBlock
                code={JSON.stringify(state.input, null, 2)}
                language="json"
              />
            </Detail>
          )}

          {/* The real error text, never a swallowed spinner. */}
          {state?.error && (
            <Detail label="Error">
              <pre className="selectable overflow-x-auto whitespace-pre-wrap rounded-md bg-[var(--danger-subtle)] px-3 py-2 font-mono text-xs text-[var(--danger)]">
                {state.error}
              </pre>
            </Detail>
          )}

          {state?.output && (open || !failed) && (
            <Detail label="Output">
              <CodeBlock
                code={state.output}
                language={outputLanguage(tool, state.output)}
              />
            </Detail>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
        {label}
      </div>
      {children}
    </div>
  );
}
