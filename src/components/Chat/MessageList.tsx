import React from "react";
import { ChatMessage } from "../../stores/chatStore";

interface MessageListProps {
  messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="message-list empty">
        <p className="empty-text">No messages yet. Start a conversation!</p>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((msg) => (
        <div key={msg.id} className={`message-bubble role-${msg.role}`}>
          <div className="message-header">
            <span className="message-author">
              {msg.role === "user" ? "You" : msg.role === "assistant" ? "BuzzAgent" : "System"}
            </span>
            <span className="message-time">
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="message-content">
            {msg.content.split("\n").map((line, i) => (
              <p key={i}>{line || "\u00A0"}</p>
            ))}
          </div>
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="message-attachments">
              {msg.attachments.map((att, i) => (
                <div key={i} className="attachment">
                  {att.type === "image" && att.data && (
                    <img src={att.data} alt={att.name} className="attachment-image" />
                  )}
                  {att.type === "file" && (
                    <span className="attachment-file">{att.name}</span>
                  )}
                  {att.type === "screenshot" && att.data && (
                    <img src={att.data} alt={att.name} className="attachment-image" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
