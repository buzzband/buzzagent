import React, { useState, useEffect } from "react";
import { useMcpStore, McpServer } from "../../stores/mcpStore";

export function MCPMarketplace() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const POPULAR_MCP_SERVERS: McpServer[] = [
    {
      id: "mcp-fs",
      name: "Filesystem",
      command: "npx",
      args: ["@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
      enabled: false,
    },
    {
      id: "mcp-git",
      name: "Git",
      command: "uv",
      args: ["tool", "run", "git-mcp-server"],
      enabled: false,
    },
    {
      id: "mcp-fetch",
      name: "Fetch",
      command: "uvx",
      args: ["mcp-server-fetch"],
      enabled: false,
    },
    {
      id: "mcp-brave",
      name: "Brave Search",
      command: "uvx",
      args: ["mcp-brave-search"],
      enabled: false,
    },
    {
      id: "mcp-github",
      name: "GitHub",
      command: "npx",
      args: ["@modelcontextprotocol/server-github"],
      enabled: false,
    },
    {
      id: "mcp-puppeteer",
      name: "Puppeteer",
      command: "npx",
      args: ["@modelcontextprotocol/server-puppeteer"],
      enabled: false,
    },
  ];

  useEffect(() => {
    setServers(POPULAR_MCP_SERVERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = servers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleInstall = async (server: McpServer) => {
    setLoading(true);
    try {
      await useMcpStore.getState().addServer(server);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mcp-marketplace">
      <div className="marketplace-header">
        <h3>MCP Marketplace</h3>
        <input
          type="text"
          placeholder="Search MCP servers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="marketplace-list">
        {filtered.map((server) => (
          <div key={server.id} className="marketplace-item">
            <div className="marketplace-info">
              <h4>{server.name}</h4>
              <code>{server.command} {server.args.join(" ")}</code>
            </div>
            <button
              onClick={() => handleInstall(server)}
              disabled={loading}
              className="btn-install"
            >
              {loading ? "Installing…" : "Install"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
