import { Tool, ToolResult } from "../types";

export interface ToolApprovalRequest {
  id: string;
  name: string;
  description: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export class ToolSystem {
  private tools: Map<string, Tool> = new Map();
  private approvals: Map<string, boolean> = new Map();

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        output: "",
        error: `Tool '${name}' not found`,
      };
    }

    if (tool.requiresApproval) {
      const approved = await this.requestApproval(name, args);
      if (!approved) {
        return {
          success: false,
          output: "",
          error: "Tool execution denied by user",
        };
      }
    }

    try {
      const result = await tool.execute(args);
      return result;
    } catch (error) {
      return {
        success: false,
        output: "",
        error: String(error),
      };
    }
  }

  private async requestApproval(name: string, args: Record<string, unknown>): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const event = new CustomEvent("tool-approval-request", {
        detail: { id: requestId, name, args },
      });
      window.dispatchEvent(event);

      const handler = (e: CustomEvent) => {
        if (e.detail && e.detail.id === requestId) {
          window.removeEventListener("tool-approval-response", handler as EventListener);
          resolve(e.detail.approved as boolean);
        }
      };
      window.addEventListener("tool-approval-response", handler as EventListener);
    });
  }

  async approveTool(name: string): Promise<void> {
    this.approvals.set(name, true);
  }

  async denyTool(name: string): Promise<void> {
    this.approvals.set(name, false);
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  async listToolNames(): Promise<string[]> {
    return Array.from(this.tools.keys());
  }
}

export const toolSystem = new ToolSystem();

toolSystem.registerTool({
  name: "read_file",
  description: "Read a file from the filesystem",
  requiresApproval: false,
  execute: async (args) => {
    const path = args.path as string;
    const resp = await fetch(`/api/read?path=${encodeURIComponent(path)}`);
    const text = await resp.text();
    return { success: true, output: text };
  },
});

toolSystem.registerTool({
  name: "write_file",
  description: "Write content to a file",
  requiresApproval: true,
  execute: async (args) => {
    const path = args.path as string;
    const content = args.content as string;
    const resp = await fetch(`/api/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
    if (!resp.ok) {
      return { success: false, output: "", error: await resp.text() };
    }
    return { success: true, output: `File ${path} written successfully` };
  },
});

toolSystem.registerTool({
  name: "run_command",
  description: "Execute a shell command",
  requiresApproval: true,
  execute: async (args) => {
    const command = args.command as string;
    const resp = await fetch(`/api/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!resp.ok) {
      return { success: false, output: "", error: await resp.text() };
    }
    const data = await resp.json();
    return {
      success: true,
      output: data.stdout,
    };
  },
});

toolSystem.registerTool({
  name: "git_diff",
  description: "Show git diff for the project",
  requiresApproval: false,
  execute: async () => {
    const { invoke } = await import("./ipc");
    const diffs = await invoke("git_diff");
    return { success: true, output: JSON.stringify(diffs) };
  },
});
