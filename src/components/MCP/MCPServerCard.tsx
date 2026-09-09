import React, { useState } from "react";
import { McpServer, McpTool } from "../../stores/mcpStore";
import { MCPToolCard } from "./MCPToolCard";

interface MCPServerCardProps {
  server: McpServer;
  onToggle: () => void;
  onRemove?: () => void;
}

export function MCPServerCard({ server, onToggle, onRemove }: MCPServerCardProps) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const tools: McpTool[] = server.tools || [];

  return (
    <div className={`mcp-server-card ${server.enabled ? "connected" : "disconnected"}`}>
      <div className="mcp-server-header">
        <span className="mcp-server-name">{server.name}</span>
        <div className="mcp-server-status">
          <span className={`mcp-status-indicator ${server.enabled ? "connected" : "disconnected"}`}>
            {server.enabled ? "●" : "○"}
          </span>
          <button onClick={onToggle} className="mcp-toggle-btn">
            {server.enabled ? "Disconnect" : "Connect"}
          </button>
          {onRemove && (
            <button onClick={onRemove} className="mcp-remove-btn" title="Remove server">
              ✕
            </button>
          )}
        </div>
      </div>

      {tools.length > 0 && (
        <button
          className="mcp-tools-toggle"
          onClick={() => setToolsExpanded(!toolsExpanded)}
        >
          {toolsExpanded ? "▼" : "▶"} {tools.length} Tools
        </button>
      )}

      {toolsExpanded && tools.length > 0 && (
        <div className="mcp-tools-list">
          {tools.map((tool) => (
            <MCPToolCard key={tool.name} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
