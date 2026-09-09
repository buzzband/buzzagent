// Core agent types — kept in sync with src-tauri/src/agent.rs serialization.

export type EffortLevel = "low" | "medium" | "high" | "max";

export interface AgentConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  projectPath: string;
  effort: EffortLevel;
}

// Tool system interfaces
export interface Tool {
  name: string;
  description: string;
  requiresApproval: boolean;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/** Event emitted by the Rust agent core over the `agent-event` channel. */
export interface AgentEvent {
  type: "text" | "tool_call" | "tool_result" | "diff" | "status" | "error" | "done";
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  chunk?: string;
  message?: string;
  diff?: DiffPayload;
  tool?: { name: string; args: Record<string, unknown> };
}

/** `AgentEvent::Diff` from the backend. */
export interface DiffPayload {
  file_path: string;
  content: string;
}

/** Entry returned by the `git_diff` command. */
export interface BackendDiffEntry {
  file: string;
  hunks: Array<{
    index: number;
    old_start: number;
    old_lines: number;
    new_start: number;
    new_lines: number;
    content: string;
  }>;
  status: "pending" | "accepted" | "rejected";
}
