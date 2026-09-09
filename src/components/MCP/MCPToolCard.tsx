import React, { useState } from "react";
import { McpTool } from "../../stores/mcpStore";
import { useMcpStore } from "../../stores/mcpStore";

export function MCPToolCard({ tool }: { tool: McpTool }) {
  const [expanded, setExpanded] = useState(false);
  const callTool = useMcpStore((state) => state.callTool);

  const handleCall = async () => {
    try {
      await callTool(tool.serverName || "", tool.name, {});
    } catch (err) {
      console.error("Tool call failed:", err);
    }
  };

  return (
    <div className="mcp-tool-card">
      <div className="mcp-tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="mcp-tool-name">{tool.name}</span>
        <span className="mcp-tool-expand">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="mcp-tool-details">
          <p>{tool.description}</p>
          <button onClick={handleCall} className="mcp-tool-call-btn">
            Call Tool
          </button>
        </div>
      )}
    </div>
  );
}
