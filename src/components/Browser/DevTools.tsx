import React from "react";
import { ConsoleLog } from "../../services/browser";

export function DevTools({ logs }: { logs: ConsoleLog[] }) {
  return (
    <div className="devtools-panel">
      <div className="devtools-header">
        <span>DevTools</span>
        <div className="devtools-tabs">
          <button className="active">Console</button>
          <button>Network</button>
          <button>Elements</button>
        </div>
      </div>
      <div className="devtools-content">
        {logs.map((log, i) => (
          <div key={i} className={`devtool-log level-${log.level}`}>
            <span className="devtool-level">[{log.level}]</span>
            <span className="devtool-message">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
