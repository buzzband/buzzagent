import React, { useState, useEffect } from "react";
import { useMcpStore } from "../../stores/mcpStore";
import { MCPServerCard } from "./MCPServerCard";
import { MCPAddForm } from "./MCPAddForm";

export function MCPHub() {
  const { servers, allTools, loadServers, toggleServer, removeServer, connectAll, loading } =
    useMcpStore();
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleToggle = async (id: string) => {
    await toggleServer(id);
  };

  return (
    <div className="mcp-hub">
      <div className="mcp-header">
        <h3>MCP Hub</h3>
        <button className="mcp-refresh" onClick={connectAll} disabled={loading}>
          {loading ? "🔄" : "↻"}
        </button>
      </div>

      <div className="mcp-tools-summary">
        <span>{allTools.length} tools available</span>
      </div>

      <div className="mcp-servers">
        {servers.length === 0 && (
          <p className="mcp-empty">No MCP servers configured yet.</p>
        )}
        {servers.map((server) => (
          <MCPServerCard
            key={server.id}
            server={server}
            onToggle={() => handleToggle(server.id)}
            onRemove={() => removeServer(server.id)}
          />
        ))}
      </div>

      {showAddForm && (
        <MCPAddForm
          onSave={async (config) => {
            await useMcpStore.getState().addServer(config);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <button className="mcp-add-button" onClick={() => setShowAddForm(true)}>
        + Add MCP Server
      </button>
    </div>
  );
}
