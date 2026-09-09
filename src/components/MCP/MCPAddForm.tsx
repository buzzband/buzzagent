import React, { useState } from "react";
import { McpServer } from "../../stores/mcpStore";

interface MCPAddFormProps {
  onSave: (config: Omit<McpServer, "id">) => Promise<void>;
  onCancel: () => void;
}

export function MCPAddForm({ onSave, onCancel }: MCPAddFormProps) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedArgs = args.split(" ").filter((a) => a.trim());
    const parsedEnv: Record<string, string> = {};

    if (env.trim()) {
      env.split("\n").forEach((line) => {
        const [key, value] = line.split("=");
        if (key && value) {
          parsedEnv[key.trim()] = value.trim();
        }
      });
    }

    await onSave({
      name,
      command,
      args: parsedArgs,
      env: Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined,
       enabled: true,
    });
  };

  return (
    <div className="mcp-add-form-backdrop">
      <form className="mcp-add-form" onSubmit={handleSubmit}>
        <h3>Add MCP Server</h3>

        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. GitHub"
          />
        </label>

        <label>
          Command
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            required
            placeholder="e.g. npx"
          />
        </label>

        <label>
          Arguments
          <input
            type="text"
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="e.g. @modelcontextprotocol/server-github --flag"
          />
        </label>

        <label>
          Environment (KEY=VALUE per line)
          <textarea
            value={env}
            onChange={(e) => setEnv(e.target.value)}
            placeholder="PAT=mcp_xxx&#10;GITHUB_USER=octocat"
            rows={3}
          />
        </label>

        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Add Server
          </button>
        </div>
      </form>
    </div>
  );
}
