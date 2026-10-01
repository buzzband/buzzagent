import { memo, useState } from "react";
import { Check, Copy, Pencil, RotateCcw } from "lucide-react";
import type { MessageWithParts } from "../../core/types";
import { useApp } from "../../store/app";
import { copyText } from "../ErrorBoundary";

/** Plain text of a message: only its non-empty text parts, joined. */
function messageText(message: MessageWithParts): string {
  return message.parts
    .filter((p) => p.type === "text" && typeof p.text === "string" && p.text.trim())
    .map((p) => (p as { text?: string }).text ?? "")
    .join("\n\n");
}

function ActionButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * Hover actions on a chat message, the small conveniences every IDE chat has:
 *   * copy — always, via the reliable Tauri-clipboard helper;
 *   * edit — user messages: draft the text back into the composer;
 *   * rerun — assistant messages: send the same prompt again as a new turn
 *     (the practical "retry" when a reply failed or disappointed).
 *
 * The row is invisible until the message is hovered, so the stream stays
 * calm; keyboard focus reveals it too (group-focus-within).
 */
export const MessageActions = memo(function MessageActions({
  message,
}: {
  message: MessageWithParts;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.info.role === "user";
  const text = messageText(message);
  const busy = useApp((s) => s.busy);
  const send = useApp((s) => s.send);
  const insertIntoComposer = useApp((s) => s.insertIntoComposer);

  if (!text) return null;

  const copy = () => {
    void copyText(text).then((ok) => {
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    });
  };

  return (
    <>
      <ActionButton title={copied ? "Copied" : "Copy message text"} onClick={copy}>
        {copied ? <Check size={12} className="text-[var(--success)]" /> : <Copy size={12} />}
        {copied && <span>Copied</span>}
      </ActionButton>

      {isUser ? (
        <ActionButton
          title="Edit and resend — puts this text back into the composer"
          onClick={() => insertIntoComposer(text)}
        >
          <Pencil size={12} />
        </ActionButton>
      ) : (
        <ActionButton
          title="Rerun — send this prompt again as a new turn"
          onClick={() => void send(text).catch(() => undefined)}
          disabled={busy}
        >
          <RotateCcw size={12} />
        </ActionButton>
      )}
    </>
  );
});
