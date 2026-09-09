import React, { useState } from "react";
import { ToolCall } from "../../stores/agentStore";

interface ToolCallCardProps {
  call: ToolCall;
}

export function ToolCallCard({ call }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: "⏳",
    running: "🔄",
    completed: "✅",
    error: "❌",
  }[call.status];

  return (
    <div className={`tool-call-card status-${call.status}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-icon">{statusIcon}</span>
        <span className="tool-call-name">{call.name}</span>
        <span className="tool-call-status">{call.status}</span>
        <button
          className="tool-call-expand"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? "▼" : "▶"}
        </button>
      </div>

      {expanded && (
        <div className="tool-call-details">
          {call.input && (
            <div className="tool-call-args">
              <pre>{JSON.stringify(call.input, null, 2)}</pre>
            </div>
          )}
          {call.result && (
            <div className="tool-call-result">
              <pre>{call.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
