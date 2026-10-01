/**
 * Types mirroring the OpenCode core API (pinned 1.18.30).
 *
 * These are hand-written on purpose for the subset we consume, and follow the
 * shapes verified in `docs/core-api-notes.md`. Do not invent fields: if the UI
 * needs something new, check the live `/doc` spec first.
 */

export interface CoreConnection {
  base_url: string;
  username: string;
  password: string;
  directory: string;
}

export type CoreState = "stopped" | "starting" | "running" | "failed";

export interface CoreStatus {
  state: CoreState;
  connection: CoreConnection | null;
  error: string | null;
  version: string | null;
  managed: boolean;
  log: string[];
}

export interface Health {
  healthy: boolean;
  version: string;
}

export interface Project {
  id: string;
  worktree: string;
  vcs: string | null;
}

export interface Session {
  id: string;
  slug?: string;
  projectID?: string;
  directory?: string;
  parentID?: string;
  title: string;
  version?: string;
  cost?: number;
  tokens?: Tokens;
  time: { created: number; updated: number };
}

export interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface ProviderModel {
  id?: string;
  name?: string;
  limit?: { context?: number; output?: number };
  cost?: { input?: number; output?: number };
  reasoning?: boolean;
  attachment?: boolean;
}

export interface Provider {
  id: string;
  name: string;
  env?: string[];
  api?: string | null;
  models: Record<string, ProviderModel>;
}

export interface ProviderList {
  all: Provider[];
  default: Record<string, string>;
  connected: string[];
}

/** One entry of `GET /provider/auth`, describing how to authenticate. */
export interface ProviderAuthMethod {
  type: string;
  label?: string;
}

export type MessageRole = "user" | "assistant";

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: MessageRole;
  time?: { created: number; completed?: number };
  cost?: number;
  tokens?: Tokens;
  modelID?: string;
  providerID?: string;
  error?: { name?: string; message?: string; data?: unknown } | null;
}

/**
 * A message part. The core emits a discriminated union; we model the members
 * the UI renders and keep unknown members visible rather than dropping them.
 */
export interface Part {
  id?: string;
  messageID?: string;
  sessionID?: string;
  type:
    | "text"
    | "reasoning"
    | "tool"
    | "step-start"
    | "step-finish"
    | "file"
    | "agent"
    | "patch"
    | "snapshot"
    | string;
  text?: string;
  /** Tool name, when `type === "tool"`. */
  tool?: string;
  callID?: string;
  state?: ToolState;
  /** File parts. */
  filename?: string;
  mime?: string;
  url?: string;
  time?: { start?: number; end?: number };
  tokens?: Tokens;
  cost?: number;
}

export type ToolStatus = "pending" | "running" | "completed" | "error";

export interface ToolState {
  status: ToolStatus;
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
}

export interface MessageWithParts {
  info: MessageInfo;
  parts: Part[];
}

export interface FileDiff {
  file?: string;
  path?: string;
  added?: number;
  removed?: number;
  patch?: string;
  before?: string | null;
  after?: string | null;
  status?: string;
}

export interface FileStatusEntry {
  path: string;
  added?: number;
  removed?: number;
  status?: string;
}

export interface Agent {
  name: string;
  description?: string;
  mode?: string;
  model?: ModelRef;
}

export interface Command {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  template?: string;
}

export interface QueuedMessage {
  id: string;
  text: string;
  model: ModelRef;
  agent?: string;
  createdAt: number;
}

export interface McpStatus {
  status?: string;
  error?: string;
  tools?: string[];
}

export interface SkillInfo {
  name: string;
  description?: string;
  location: string;
  /** Skills flagged `slash` are invokable as /name in a session. */
  slash?: boolean;
  content?: string;
}

export interface Todo {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled" | string;
  priority?: string;
}

/** SSE envelope: `{ id, type, properties }`. */
export interface CoreEvent {
  id?: string;
  type: string;
  properties?: Record<string, unknown>;
}

/** A pending permission request surfaced by the core. */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  messageID?: string;
  callID?: string;
  title?: string;
  tool?: string;
  /** Free-form payload; rendered defensively. */
  metadata?: Record<string, unknown>;
  time?: { created: number };
}

export type PermissionReply = "once" | "always" | "reject";
