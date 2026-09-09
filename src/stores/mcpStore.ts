import { create } from "zustand";
import { invoke } from "../services/ipc";

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  tools?: McpTool[];
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
  serverName?: string;
}

interface BackendMcpServerStatus {
  name: string;
  connected: boolean;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
}

interface McpStore {
  servers: McpServer[];
  allTools: McpTool[];
  connected: boolean;
  loading: boolean;

  loadServers: () => Promise<void>;
  addServer: (server: Omit<McpServer, "id">) => Promise<void>;
  updateServer: (id: string, data: Partial<McpServer>) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  toggleServer: (id: string) => Promise<void>;
  connectAll: () => Promise<void>;
  callTool: (serverName: string, toolName: string, args: unknown) => Promise<unknown>;
}

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  allTools: [],
  connected: false,
  loading: false,

  loadServers: async () => {
    set({ loading: true });
    try {
      const statuses: BackendMcpServerStatus[] = await invoke("mcp_list_servers");
      set((state) => {
        // Merge backend statuses into the local registry (keeps command
        // details entered by the user for servers it already knows).
        const servers: McpServer[] = statuses.map((s) => {
          const known = state.servers.find((x) => x.name === s.name);
          return {
            id: known?.id ?? s.name,
            name: s.name,
            command: known?.command ?? "",
            args: known?.args ?? [],
            env: known?.env,
            enabled: s.connected,
            tools: s.tools.map((t) => ({ ...t, serverName: s.name })),
          };
        });
        const allTools = servers.flatMap((s) =>
          (s.tools ?? []).map((t) => ({ ...t, serverName: s.name }))
        );
        return {
          servers,
          allTools,
          connected: statuses.some((s) => s.connected),
        };
      });
    } catch (err) {
      console.warn("mcp_list_servers failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  addServer: async (server) => {
    const config = {
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
      enabled: server.enabled,
    };
    await invoke("mcp_add_server", { config });
    set((state) => ({
      servers: [...state.servers, { ...server, id: server.name }],
    }));
    await get().loadServers();
  },

  updateServer: async (id, data) => {
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, ...data } : s)),
    }));
  },

  removeServer: async (id) => {
    const server = get().servers.find((s) => s.id === id);
    if (server) {
      try {
        await invoke("mcp_remove_server", { server: server.name });
      } catch (err) {
        console.warn("mcp_remove_server failed:", err);
      }
    }
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
      allTools: state.allTools.filter((t) => t.serverName !== server?.name),
    }));
  },

  toggleServer: async (id) => {
    const server = get().servers.find((s) => s.id === id);
    if (!server) return;
    const nextEnabled = !server.enabled;
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === id ? { ...s, enabled: nextEnabled } : s
      ),
    }));
    try {
      if (nextEnabled) {
        await invoke("mcp_add_server", {
          config: {
            name: server.name,
            command: server.command,
            args: server.args,
            env: server.env,
            enabled: true,
          },
        });
      } else {
        await invoke("mcp_disconnect", { server: server.name });
      }
    } catch (err) {
      // Revert on failure.
      set((state) => ({
        servers: state.servers.map((s) =>
          s.id === id ? { ...s, enabled: !nextEnabled } : s
        ),
      }));
      console.warn("MCP toggle failed:", err);
      return;
    }
    await get().loadServers();
  },

  connectAll: async () => {
    await get().loadServers();
  },

  callTool: async (serverName, toolName, args) => {
    return invoke("mcp_call_tool", { server: serverName, tool: toolName, args });
  },
}));
