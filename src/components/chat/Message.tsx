import { memo } from "react";
import { Bot, User } from "lucide-react";
import type { MessageWithParts, Part } from "../../core/types";
import { normalizeError } from "../../lib/errors";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { ErrorCard } from "./ErrorCard";
import { MessageActions } from "./MessageActions";

/** Format a token count compactly: 12.4k rather than 12403. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function Meta({ message }: { message: MessageWithParts }) {
  const { tokens, cost, modelID } = message.info;
  const total = tokens ? tokens.input + tokens.output : 0;
  if (!total && !cost && !modelID) return null;

  return (
    <div className="mt-1 flex items-center gap-2.5 text-2xs text-[var(--fg-muted)]">
      {modelID && <span className="font-mono">{modelID}</span>}
      {total > 0 && <span>{compact(total)} tokens</span>}
      {/* Cost comes from the core; we never estimate it ourselves. */}
      {typeof cost === "number" && cost > 0 && <span>${cost.toFixed(4)}</span>}
    </div>
  );
}

/** Parts the UI intentionally does not render as visible blocks. */
const SILENT_PARTS = new Set(["step-start", "step-finish", "snapshot", "patch"]);

export const Message = memo(function Message({
  message,
  streaming,
}: {
  message: MessageWithParts;
  streaming?: boolean;
}) {
  const isUser = message.info.role === "user";
  const error = message.info.error;

  const visible = message.parts.filter((p: Part) => {
    if (SILENT_PARTS.has(p.type)) return false;
    if (p.type === "text") return Boolean(p.text?.trim());
    return true;
  });

  // A turn that produced nothing yet still needs to occupy its row, or the
  // list jumps when the first token lands.
  const empty = visible.length === 0 && !error;

  return (
    <div className={`group relative px-4 py-3 ${isUser ? "" : "bg-[var(--bg-surface)]/40"}`}>
      <div className="mx-auto flex max-w-3xl gap-3">
        <div
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ${
            isUser
              ? "bg-[var(--bg-overlay)] text-[var(--fg-secondary)]"
              : "bg-[var(--accent-subtle)] text-[var(--accent)]"
          }`}
          aria-hidden
        >
          {isUser ? <User size={13} /> : <Bot size={13} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="sr-only-text">{isUser ? "You" : "Assistant"}</div>

          {visible.map((part, i) => {
            const key = part.id ?? part.callID ?? `${part.type}-${i}`;

            if (part.type === "tool") return <ToolCard key={key} part={part} />;

            if (part.type === "reasoning") {
              return (
                <details
                  key={key}
                  className="my-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2.5 py-1.5"
                >
                  <summary className="cursor-pointer text-2xs uppercase tracking-wide text-[var(--fg-muted)]">
                    Reasoning
                  </summary>
                  <div className="mt-1.5 text-xs">
                    <Markdown text={part.text ?? ""} />
                  </div>
                </details>
              );
            }

            if (part.type === "file") {
              return (
                <div
                  key={key}
                  className="my-1.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-2 py-1 font-mono text-xs text-[var(--fg-secondary)]"
                >
                  {part.filename ?? part.url ?? "file"}
                </div>
              );
            }

            const isLast = i === visible.length - 1;
            return (
              <div key={key} className={isUser ? "text-[var(--fg-primary)]" : undefined}>
                <Markdown text={part.text ?? ""} streaming={streaming && isLast} />
                {streaming && isLast && <span className="streaming-caret" aria-hidden />}
              </div>
            );
          })}

          {empty && streaming && (
            <div className="flex items-center gap-1.5 py-0.5 text-xs text-[var(--fg-muted)]">
              <span className="streaming-caret" aria-hidden />
              Thinking…
            </div>
          )}

          {error && (
            <div className="my-1.5">
              <ErrorCard
                error={normalizeError(error, {
                  sessionID: message.info.sessionID,
                  providerID: message.info.providerID,
                  modelID: message.info.modelID,
                })}
              />
            </div>
          )}

          {!isUser && <Meta message={message} />}
        </div>

        {/* Hover actions: copy always; edit (user) / rerun (assistant). Kept
            out of the text flow — an absolute row on the avatar side so the
            virtualizer's measured height stays unchanged. */}
        <div className="absolute right-2 top-1 z-10 flex items-center gap-0.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-0.5 py-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <MessageActions message={message} />
        </div>
      </div>
    </div>
  );
});
