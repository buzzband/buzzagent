import React from "react";
import { useAgentStore } from "../../stores/agentStore";

export function StatusBar({ isRunning }: { isRunning: boolean }) {
  const { effort, agent, provider } = useAgentStore();

  const statusText = isRunning ? "Agent is running..." : "Idle";
  const statusClass = isRunning ? "running" : "idle";

  return (
    <div className={`status-bar ${statusClass}`}>
      <div className="status-left">
        <span className="status-dot" />
        <span className="status-text">{statusText}</span>
      </div>

      <div className="status-center">
        {agent && (
          <>
            <span className="status-model">{agent.provider} / {agent.model}</span>
            <span className="status-effort">Effort: {effort}</span>
          </>
        )}
      </div>

      <div className="status-right">
        {provider && (
          <span className="status-provider">
            {provider.connected ? "●" : "○"} {provider.model}
          </span>
        )}
        <span className="status-version">v0.1.0</span>
      </div>
    </div>
  );
}
