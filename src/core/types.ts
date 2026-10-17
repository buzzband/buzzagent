/**
 * Types for the OpenCode core API.
 *
 * OpenCode v2 (`opencode serve`, pinned 2.0.32) wraps every list response in
 * a `{ location, data }` envelope, embeds message parts inline in
 * `content`, and names the model fields `Model.Ref = { id, providerID,
 * variant }`. The types below model the subset we consume; the client layer
 * adapts them into the internal shapes the UI was built on
 * (`MessageWithParts`, `Part`, `CoreEvent`) so the store is insulated from
 * wire churn.
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

/** `GET /api/info` — v2 readiness + identity. */
export interface Health {
  version: string;
  pid: number;
  urls: string[];
  paths: Record<string, string>;
  capabilities: Record<string, boolean>;
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

/** v2 `Model.Ref`. The UI's legacy `modelID` maps to wire `id`. */
export interface ModelRef {
  providerID: string;
  modelID: string;
  variant?: string;
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

/** Raw v2 provider entry (before grouping into the internal shape). */
export interface ProviderModelInfo {
  id: string;
  modelID?: string;
  providerID: string;
  name?: string;
  reasoning?: boolean;
  attachment?: boolean;
  limit?: { context?: number; output?: number };
  cost?: unknown;
  settings?: Record<string, unknown>;
  package?: string;
}

export interface ProviderList {
  all: Provider[];
  default: Record<string, string>;
  connected: string[];
}

/** One auth method of a v2 integration. */
export interface ProviderAuthMethod {
  type: "key" | "env" | "oauth" | "command" | string;
  label?: string;
  names?: string[];
}

export type MessageRole = "user" | "assistant" | string;

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: MessageRole;
  time?: { created: number; completed?: number; streamed?: number };
  cost?: number;
  tokens?: Tokens;
  modelID?: string;
  providerID?: string;
  error?: { name?: string; message?: string; data?: unknown } | null;
}

/**
 * A message part (internal shape; adapted from v2 inline content).
 */
export interface Part {
  id?: string;
  messageID?: string;
  sessionID?: string;
  ordinal?: number;
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

export type ToolStatus = "pending" | "streaming" | "running" | "completed" | "error";

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

/**
 * SSE event, internal shape. v2 sends `{ id, created, type, data, location,
 * durable }`; the client adapter copies `data` into `properties` so the
 * store's event handling keeps a single shape.
 */
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
