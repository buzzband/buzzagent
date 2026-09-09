import { McpServer, McpTool } from "../stores/mcpStore";
import * as ipc from "./ipc";

export class McpClient {
  private servers: Map<string, McpServer> = new Map();

  async addServer(config: Omit<McpServer, "id">): Promise<void> {
    await ipc.invoke("mcp_add_server", { config });
    const server: McpServer = { ...config, id: crypto.randomUUID() };
    this.servers.set(server.name, server);
  }

  async listTools(serverName: string): Promise<McpTool[]> {
    const result = await ipc.invoke<{ tools: McpTool[] }>("mcp_list_tools", { server: serverName });
    return result.tools;
  }

  async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    return await ipc.invoke("mcp_call_tool", {
      server: serverName,
      tool: toolName,
      args,
    });
  }

  async disconnectServer(serverName: string): Promise<void> {
    await ipc.invoke("mcp_disconnect", { server: serverName });
    this.servers.delete(serverName);
  }

  getServers(): McpServer[] {
    return Array.from(this.servers.values());
  }
}

export const mcpClient = new McpClient();
