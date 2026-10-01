import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MessageWithParts } from "../../core/types";
import { useApp } from "../../store/app";
import { Message } from "./Message";
import { ChatErrorBanner } from "./ErrorCard";
import { TurnStatus } from "./TurnStatus";

/** Below this many messages, virtualization costs more than it saves. */
const VIRTUALIZE_THRESHOLD = 40;
/** Distance from the bottom still counted as "following the stream". */
const STICKY_PX = 120;

interface Props {
  messages: MessageWithParts[];
  busy: boolean;
}

/**
 * The message stream.
 *
 * Two behaviours matter more than anything visual here:
 *   * Follow the tail while streaming, but stop the moment the user scrolls up.
 *     Yanking someone back to the bottom mid-read is the single most annoying
 *     bug in chat UIs.
 *   * Virtualize long sessions so thousands of parts stay smooth.
 */
export function MessageList({ messages, busy }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  // Errors render as the last item INSIDE the scrolled conversation; subscribe
  // here so a new error participates in scroll-following like any message.
  const hasError = useApp((s) => s.lastError !== null);
  const turnActive = useApp((s) => s.busy || s.turnStatus !== null);

  const atBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= STICKY_PX;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const onScroll = useCallback(() => {
    setFollowing(atBottom());
  }, [atBottom]);

  // Keep pinned to the tail as content grows, but only while following.
  useLayoutEffect(() => {
    if (following) scrollToBottom();
  }, [messages, busy, hasError, turnActive, following, scrollToBottom]);

  const virtualize = messages.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    // Rough starting guess; measureElement corrects it after paint.
    estimateSize: () => 160,
    overscan: 8,
    enabled: virtualize,
  });

  useEffect(() => {
    if (virtualize && following) virtualizer.scrollToIndex(messages.length - 1);
  }, [virtualize, following, messages.length, virtualizer]);

  const lastIndex = messages.length - 1;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain"
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {virtualize ? (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={messages[item.index].info.id}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <Message
                  message={messages[item.index]}
                  streaming={busy && item.index === lastIndex}
                />
              </div>
            ))}
          </div>
        ) : (
          messages.map((message, i) => (
            <Message
              key={message.info.id}
              message={message}
              streaming={busy && i === lastIndex}
            />
          ))
        )}

        {/* Live turn status (Thinking Ns / Retry reason) — also participates
            in scroll-following so the user sees it instead of a silent tail. */}
        <TurnStatus />

        {hasError && <ChatErrorBanner />}

        {/* Breathing room so the last message is never glued to the composer. */}
        <div className="h-4" />
      </div>

      {!following && (
        <button
          type="button"
          onClick={() => {
            setFollowing(true);
            scrollToBottom(true);
          }}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-overlay)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] shadow-[var(--shadow-panel)] transition-colors hover:text-[var(--fg-primary)]"
        >
          <ArrowDown size={13} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
