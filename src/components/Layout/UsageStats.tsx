import React from "react";
import { useModelStore } from "../../stores/modelStore";

export function UsageStats() {
  const { usage } = useModelStore();

  return (
    <div className="usage-stats">
      <div className="usage-item">
        <span className="usage-label">Tokens</span>
        <span className="usage-value">{usage.sessionTokens.toLocaleString()}</span>
      </div>
      <div className="usage-item">
        <span className="usage-label">Cost</span>
        <span className="usage-value">${usage.sessionCost.toFixed(4)}</span>
      </div>
      <div className="usage-item">
        <span className="usage-label">Total Tokens</span>
        <span className="usage-value">{usage.totalTokens.toLocaleString()}</span>
      </div>
      <div className="usage-item">
        <span className="usage-label">Total Cost</span>
        <span className="usage-value">${usage.totalCost.toFixed(2)}</span>
      </div>
    </div>
  );
}
