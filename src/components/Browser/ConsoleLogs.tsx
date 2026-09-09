import React, { useState } from "react";
import { ConsoleLog } from "../../services/browser";

export function ConsoleLogs({ logs, onClear }: { logs: ConsoleLog[]; onClear: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`console-logs ${expanded ? "expanded" : ""}`}>
      <div className="console-header" onClick={() => setExpanded(!expanded)}>
        <span>Console ({logs.length})</span>
        <div className="console-actions">
          <button onClick={onClear}>Clear</button>
          <span className="expand-toggle">{expanded ? "▼" : "▲"}</span>
        </div>
      </div>

      {expanded && (
        <div className="console-scroll">
          {logs.map((log, i) => (
            <div key={i} className={`console-entry level-${log.level}`}>
              <span className="console-timestamp">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`console-level ${log.level}`}>[{log.level}]</span>
              <span className="console-message">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 