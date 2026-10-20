import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
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
  const { messages, busy } = useApp(
    useShallow((s) => ({
      messages: s.messages,
      busy: s.busy,
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
      <div className="px-4 pb-2">
        <TodoPanel />
      </div>
    </div>
  );
}
