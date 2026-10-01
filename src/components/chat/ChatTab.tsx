import { MessageSquarePlus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import { MessageList } from "../chat/MessageList";
import { Composer } from "../chat/Composer";
import { EmptyChat } from "./EmptyChat";
import { ChatErrorBanner } from "./ErrorCard";
import { TodoPanel } from "./TodoPanel";

/**
 * The chat editor tab: the live conversation plus the composer. The tab strip
 * (not a per-panel toolbar) is the header now, so the toolbar that used to live
 * here is gone.
 */
export function ChatTab() {
  const { messages, busy, newSession, language } = useApp(
    useShallow((s) => ({
      messages: s.messages,
      busy: s.busy,
      newSession: s.newSession,
      language: s.language,
    }))
  );

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      {messages.length === 0 ? (
        <>
          <EmptyChat />
          <ChatErrorBanner />
        </>
      ) : (
        <MessageList messages={messages} busy={busy} />
      )}

      <Composer />
      {/* Always-visible "new session" right under the composer: starting a
          fresh thread must not require knowing it lives in the Projects panel
          or the command palette. */}
      <div className="flex justify-center px-4 pb-1">
        <button
          type="button"
          onClick={() => void newSession()}
          className="flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]"
        >
          <MessageSquarePlus size={13} />
          {t(language, "composer.newSession")}
        </button>
      </div>
      <div className="px-4 pb-2">
        <TodoPanel />
      </div>
    </div>
  );
}
