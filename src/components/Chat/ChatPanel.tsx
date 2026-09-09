import React, { useState, useRef, useEffect } from "react";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ToolCallCard } from "./ToolCallCard";
import { useAgentStore, Message, ToolCall } from "../../stores/agentStore";
import { ChatMessage } from "../../stores/chatStore";

export function ChatPanel() {
  const { messages, toolCalls, isRunning, sendMessage, stopAgent } = useAgentStore();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolCalls]);

  const handleSubmit = async () => {
    if (!input.trim() || isRunning) return;
    await sendMessage(input);
    setInput("");
  };

  const handleStop = async () => {
    await stopAgent();
  };

  const chatMessages: ChatMessage[] = messages.map((msg: Message, i: number) => ({
    id: `${msg.role}-${i}`,
    role: msg.role === "system" ? "system" : msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  }));

  return (
    <div className="chat-panel">
      <div className="messages-area">
        <MessageList messages={chatMessages} />

        {toolCalls.map((call: ToolCall) => (
          <ToolCallCard key={call.id} call={call} />
        ))}

        {isRunning && (
          <div className="typing-indicator">
            <span>BuzzAgent</span>
            <span className="dots">
              <span>·</span>
              <span>·</span>
              <span>·</span>
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isRunning}
      />

      {isRunning && (
        <button className="stop-button" onClick={handleStop}>
          ⏹ Stop
        </button>
      )}
    </div>
  );
}
