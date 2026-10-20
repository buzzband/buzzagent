/**
 * HTTP + SSE client for the local OpenCode v2 core.
 *
 * Inside the Tauri desktop app every request is proxied through Rust
 * (`core_http` / `core_events_start`): the webview's own network stack picks
 * up desktop-session proxies (GNOME/KDE), and on such machines its
 * `fetch("http://127.0.0.1:<port>")` never reaches the loopback even with
 * `NO_PROXY` set. The Rust side uses reqwest built with `.no_proxy()`, so the
 * webview network stack is taken out of the loopback path entirely.
 *
 * In a plain browser (dev against a terminal-run core) we fall back to direct
 * `fetch` + a hand-rolled SSE reader, which also keeps the unit tests simple.
 *
 * v2 adaptation (see PLAN.md): every list response arrives in a
 * `{ location, data }` envelope, sessions are cursor-paginated, message parts
 * live inline in `content`, and events are namespaced
 * (`session.text.delta`, `session.execution.succeeded`, …). The adapters in
 * this file translate the wire into the internal shapes the store was built
 * on, so the UI is insulated from the churn.
 *
 * Deliberately dependency-free.
 */

import { invoke, Channel } from "@tauri-apps/api/core";

import type {
  Agent,
  Command,
  CoreConnection,
  CoreEvent,
  FileDiff,
  FileStatusEntry,
  Health,
  McpStatus,
  MessageInfo,
  MessageWithParts,
  ModelRef,
  Part,
  PermissionReply,
  Project,
  Provider,
  ProviderAuthMethod,
  ProviderList,
  ProviderModelInfo,
  Session,
  SkillInfo,
  Todo,
  ToolState,
} from "./types";

export class CoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/** True when running inside the Tauri desktop webview. */
function inTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// Rust returns the body base64 (URL-safe alphabet) so binary payloads survive
// the IPC boundary; these helpers convert it back without a second copy of
// every byte through `String.fromCharCode` at once (hence the chunking).

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Shape of the response returned by the Rust `core_http` command. */
interface CoreHttpResponse {
  status: number;
  bodyBase64: string;
  contentType: string;
}

/** Chunks the Rust `core_events_start` pump sends over its channel. */
type CoreEventChunk =
  | { type: "event"; payload: string }
  | { type: "connected" }
  | { type: "dropped"; message: string };

// ------------------------------------------------------------------ adapters

/** v2 envelope: `{ location, data }` (some responses skip `location`). */
interface Envelope<T> {
  location?: unknown;
  data: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwrap a v2 envelope if present; pass anything else through. */
function unwrap<T>(body: unknown): T {
  if (isRecord(body) && "data" in body && (body["location"] !== undefined || body["cursor"] !== undefined || "data" in body)) {
    return body["data"] as T;
  }
  return body as T;
}

/** v2 wire session. */
interface WireSession {
  id: string;
  projectID?: string;
  parentID?: string;
  title?: string;
  cost?: number;
  tokens?: Session["tokens"];
  time?: { created?: number; updated?: number };
  location?: { directory?: string };
}

function adaptSession(wire: WireSession): Session {
  return {
    id: wire.id,
    projectID: wire.projectID,
    parentID: wire.parentID,
    directory: wire.location?.directory,
    title: wire.title ?? "Untitled",
    cost: wire.cost,
    tokens: wire.tokens,
    time: {
      created: wire.time?.created ?? 0,
      updated: wire.time?.updated ?? wire.time?.created ?? 0,
    },
  };
}

/** v2 wire message — parts inline in `content`. */
interface WireMessage {
  id: string;
  sessionID?: string;
  type?: string;
  text?: string;
  agent?: string;
  model?: { id?: string; providerID?: string; variant?: string };
  content?: WirePart[];
  time?: { created?: number; completed?: number; streamed?: number };
  finish?: string;
  cost?: number;
  tokens?: Session["tokens"];
  error?: { type?: string; message?: string; data?: unknown };
  outcome?: string;
  location?: { directory?: string };
}

type WirePart =
  | { type: "text"; text?: string; state?: { status?: string } }
  | {
      type: "reasoning";
      text?: string;
      state?: { status?: string };
      time?: { created?: number; completed?: number };
    }
  | {
      type: "tool";
      id: string;
      name?: string;
      executed?: boolean;
      state?: {
        status?: string;
        input?: Record<string, unknown> | string;
        content?: Array<{ type?: string; text?: string; path?: string; mime?: string }>;
        error?: { type?: string; message?: string };
        metadata?: Record<string, unknown>;
      };
      time?: { created?: number; ran?: number; completed?: number };
    }
  | { type: string; [key: string]: unknown };

/** Convert a v2 wire part into the internal `Part` shape. */
function adaptPart(wire: WirePart, messageID: string, sessionID: string, ordinal: number): Part {
  if (wire.type === "text" || wire.type === "reasoning") {
    const w = wire as { type: "text" | "reasoning"; text?: string; time?: unknown };
    return {
      id: `${messageID}:${wire.type}:${ordinal}`,
      messageID,
      sessionID,
      ordinal,
      type: wire.type,
      text: w.text ?? "",
    };
  }
  if (wire.type === "tool") {
    const w = wire as Extract<WirePart, { type: "tool" }>;
    const state: ToolState = {
      status: (w.state?.status as ToolState["status"]) ?? "running",
      input:
        typeof w.state?.input === "string"
          ? safeParseRecord(w.state.input)
          : w.state?.input,
      output: toolOutputText(w.state?.content),
      error: w.state?.error?.message,
      metadata: w.state?.metadata,
      time: {
        start: w.time?.ran ?? w.time?.created,
        end: w.time?.completed,
      },
    };
    return {
      id: `${messageID}:tool:${w.id}`,
      callID: w.id,
      messageID,
      sessionID,
      ordinal,
      type: "tool",
      tool: w.name,
      state,
    };
  }
  // Unknown member: keep it visible rather than dropping it.
  const rest: Record<string, unknown> = { ...(wire as Record<string, unknown>) };
  delete rest["type"];
  return {
    id: `${messageID}:${String(wire.type)}:${ordinal}`,
    messageID,
    sessionID,
    ordinal,
    type: String(wire.type),
    ...rest,
  } as Part;
}

function safeParseRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : { value };
  } catch {
    return { raw: value };
  }
}

/** Flatten a v2 tool content array (`Tool.Content[]`) into displayable text. */
function toolOutputText(
  content: Array<{ type?: string; text?: string; path?: string }> | undefined
): string | undefined {
  if (!content || content.length === 0) return undefined;
  return content
    .map((item) => item.text ?? item.path ?? "")
    .filter((s) => s.length > 0)
    .join("\n") || undefined;
}

/** Convert a v2 wire message into the internal `MessageWithParts`. */
function adaptMessage(wire: WireMessage): MessageWithParts {
  const sessionID = wire.sessionID ?? "";
  const role = wire.type === "assistant" || wire.type === "user" ? wire.type : wire.type ?? "assistant";
  const info: MessageInfo = {
    id: wire.id,
    sessionID,
    role,
    time: {
      created: wire.time?.created ?? 0,
      completed: wire.time?.completed,
      streamed: wire.time?.streamed,
    },
    cost: wire.cost,
    tokens: wire.tokens,
    modelID: wire.model?.id,
    providerID: wire.model?.providerID,
    error: wire.error
      ? {
          name: wire.error.type,
          message: wire.error.message,
          data: wire.error.data,
        }
      : undefined,
  };
  const parts: Part[] = [];
  // v1 put the user's prompt in a text part; v2 keeps it in `text`.
  if (typeof wire.text === "string" && wire.text.length > 0) {
    parts.push({
      id: `${wire.id}:text:0`,
      messageID: wire.id,
      sessionID,
      ordinal: 0,
      type: "text",
      text: wire.text,
    });
  }
  if (Array.isArray(wire.content)) {
    wire.content.forEach((wirePart, ordinal) => {
      parts.push(adaptPart(wirePart, wire.id, sessionID, ordinal));
    });
  }
  return { info, parts };
}

/**
 * Translate v2 events into the internal `CoreEvent` shape
 * (`{ type, properties: data }`) and, where v2 renamed the semantics,
 * synthesize the v1-style events the store already handles:
 *
 *   session.execution.{succeeded,failed,interrupted} → session.idle +
 *     session.status {type:"idle"} / session.error
 *   session.retry.scheduled        → session.status {type:"retry", …}
 *   session.inbox.enqueued (user)  → message.updated + message.part.updated
 *   session.step.started           → message.updated (assistant stub)
 *   session.text/reasoning.delta   → message.part.delta
 *   session.text/reasoning.ended   → message.part.updated
 *   session.tool.*                 → message.part.updated (tool card)
 *   session.renamed                → session.updated
 *   message.updated / message.removed pass through with `data` as properties.
 */
export function adaptEvent(raw: unknown): CoreEvent[] {
  if (!isRecord(raw)) return [];
  const type = typeof raw["type"] === "string" ? raw["type"] : "";
  const data = isRecord(raw["data"]) ? raw["data"] : {};
  const out: CoreEvent[] = [];

  const base = (): Record<string, unknown> => ({ ...data });

  switch (type) {
    case "session.execution.started":
      // v2 has no "busy" status event; synthesize one so the UI always has a
      // live status (also covers queued prompts started by the core).
      out.push({
        type: "session.status",
        properties: { sessionID: data["sessionID"], status: { type: "busy" } },
      });
      return out;

    case "session.execution.succeeded":
      // Only the status idle frame: its handler notifies completion. A
      // preceding session.idle used to clear `busy` first, which silently
      // suppressed the completion sound/notification.
      out.push({
        type: "session.status",
        properties: { sessionID: data["sessionID"], status: { type: "idle" } },
      });
      return out;

    case "session.execution.interrupted":
      // User-aborted turn: clear busy without the "ready" chime.
      out.push({ type: "session.idle", properties: base() });
      return out;

    case "session.execution.failed": {
      // Error first: the handler marks the turn as failed and sends the
      // failure notification; the following idle frame then skips the
      // "ready" notification but still processes the queue.
      out.push({
        type: "session.error",
        properties: { sessionID: data["sessionID"], error: data["error"] },
      });
      out.push({
        type: "session.status",
        properties: { sessionID: data["sessionID"], status: { type: "idle" } },
      });
      return out;
    }

    case "session.retry.scheduled": {
      // v2 payload: { sessionID, attempt, at, error }.
      const error = isRecord(data["error"]) ? data["error"] : {};
      out.push({
        type: "session.status",
        properties: {
          sessionID: data["sessionID"],
          status: {
            type: "retry",
            attempt: data["attempt"],
            next: data["at"],
            message:
              (typeof error["message"] === "string" && error["message"]) ||
              "Provider call failed — retrying",
          },
        },
      });
      return out;
    }

    case "session.inbox.enqueued": {
      // The user's own prompt: { inboxID, sessionID, item: { type, payload,
      // delivery } }. Synthesize the v1 pair so the optimistic echo is
      // replaced by the authoritative message.
      const item = isRecord(data["item"]) ? data["item"] : {};
      const payload = isRecord(item["payload"]) ? item["payload"] : {};
      if (item["type"] === "user") {
        const sessionID = data["sessionID"];
        const messageID = data["inboxID"];
        out.push({
          type: "message.updated",
          properties: { info: { id: messageID, sessionID, role: "user" } },
        });
        out.push({
          type: "message.part.updated",
          properties: {
            part: {
              id: `${messageID}:text:0`,
              messageID,
              sessionID,
              ordinal: 0,
              type: "text",
              text: payload["text"],
            },
          },
        });
      }
      return out;
    }

    case "session.step.started": {
      // { sessionID, agent, model, assistantMessageID, started } — realize
      // the assistant message stub early so streamed parts have a home.
      out.push({
        type: "message.updated",
        properties: {
          info: {
            id: data["assistantMessageID"],
            sessionID: data["sessionID"],
            role: "assistant",
            providerID: isRecord(data["model"]) ? data["model"]["providerID"] : undefined,
            modelID: isRecord(data["model"]) ? data["model"]["id"] : undefined,
          },
        },
      });
      return out;
    }

    case "session.text.delta":
    case "session.reasoning.delta": {
      // { sessionID, assistantMessageID, ordinal, delta }.
      const field = type === "session.reasoning.delta" ? "reasoning" : "text";
      out.push({
        type: "message.part.delta",
        properties: {
          sessionID: data["sessionID"],
          messageID: data["assistantMessageID"],
          partID: partIDFor(data["assistantMessageID"], field, data["ordinal"]),
          field,
          delta: data["delta"],
        },
      });
      return out;
    }

    case "session.text.ended":
    case "session.reasoning.ended": {
      // { sessionID, assistantMessageID, ordinal, text } — authoritative
      // full text for the part.
      const field = type === "session.reasoning.ended" ? "reasoning" : "text";
      const messageID = data["assistantMessageID"];
      out.push({
        type: "message.part.updated",
        properties: {
          part: {
            id: partIDFor(messageID, field, data["ordinal"]),
            messageID,
            sessionID: data["sessionID"],
            ordinal: numberOr(data["ordinal"], 0),
            type: field === "reasoning" ? "reasoning" : "text",
            text: data["text"],
          },
        },
      });
      return out;
    }

    case "session.tool.input.started":
    case "session.tool.input.delta":
    case "session.tool.input.ended":
    case "session.tool.called":
    case "session.tool.progress":
    case "session.tool.success":
    case "session.tool.failed": {
      // { sessionID, assistantMessageID, id, name?, input?, error?, … } —
      // fold into a tool part. Status mapping:
      //   input.* → streaming (arguments being written)
      //   called  → running
      //   success → completed
      //   failed  → error
      const messageID = data["assistantMessageID"];
      const callID = data["id"];
      if (typeof messageID !== "string" || typeof callID !== "string") return out;
      let status: string;
      switch (type) {
        case "session.tool.success": status = "completed"; break;
        case "session.tool.failed": status = "error"; break;
        case "session.tool.called": status = "running"; break;
        default: status = "streaming"; break;
      }
      const error = isRecord(data["error"]) ? data["error"] : undefined;
      out.push({
        type: "message.part.updated",
        properties: {
          part: {
            id: `${messageID}:tool:${callID}`,
            callID,
            messageID,
            sessionID: data["sessionID"],
            type: "tool",
            tool: data["name"],
            state: {
              status,
              input: isRecord(data["input"]) ? data["input"] : undefined,
              error: typeof error?.["message"] === "string" ? error["message"] : undefined,
              metadata: isRecord(data["metadata"]) ? data["metadata"] : undefined,
            },
          },
        },
      });
      return out;
    }

    case "session.renamed": {
      // { sessionID, title } — matches v1 session.updated's store handling.
      out.push({
        type: "session.updated",
        properties: { info: { id: data["sessionID"], title: data["title"] } },
      });
      return out;
    }

    case "message.updated": {
      // v2 message payloads are the wire message shape; adapt in place.
      out.push({ type: "message.updated", properties: base() });
      return out;
    }

    case "message.removed": {
      out.push({ type: "message.removed", properties: base() });
      return out;
    }

    default:
      // Everything else (permissions, todo, session.created/deleted, …)
      // keeps its v2 name; the store's handlers read generic fields.
      out.push({ type, properties: base() });
      return out;
  }
}

function partIDFor(messageID: unknown, field: string, ordinal: unknown): string {
  return `${messageID}:${field}:${numberOr(ordinal, 0)}`;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

export class CoreClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(connection: CoreConnection) {
    this.baseUrl = connection.base_url.replace(/\/+$/, "");
    this.authHeader = `Basic ${btoa(`${connection.username}:${connection.password}`)}`;
  }

  // ------------------------------------------------------------- plumbing

  private async request<T>(
    path: string,
    init: RequestInit & { query?: Record<string, string | number | undefined> } = {}
  ): Promise<T> {
    const { query, ...rest } = init;
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    let status: number;
    let bytes: Uint8Array;

    if (inTauri()) {
      // Desktop app: proxy through Rust. Auth is attached there — credentials
      // are not re-sent over each IPC call, and nothing depends on the
      // webview's proxy-ridden network stack.
      const proxyResponse = await invoke<CoreHttpResponse>("core_http", {
        method: rest.method ?? "GET",
        path: url,
        body: rest.body === undefined ? null : String(rest.body),
      }).catch((cause) => {
        throw new CoreError(
          `Cannot reach the agent core at ${this.baseUrl}. Is it running?`,
          undefined,
          String(cause)
        );
      });
      status = proxyResponse.status;
      bytes = base64UrlToBytes(proxyResponse.bodyBase64);
    } else {
      // Plain browser (dev): direct fetch with basic auth.
      let response: Response;
      try {
        response = await fetch(url, {
          ...rest,
          headers: {
            Authorization: this.authHeader,
            ...(rest.body ? { "Content-Type": "application/json" } : {}),
            ...(rest.headers ?? {}),
          },
        });
      } catch (cause) {
        throw new CoreError(
          `Cannot reach the agent core at ${this.baseUrl}. Is it running?`,
          undefined,
          String(cause)
        );
      }
      status = response.status;
      bytes = new Uint8Array(await response.arrayBuffer());
    }

    if (status < 200 || status >= 300) {
      throw new CoreError(
        `Core returned HTTP ${status} for ${path}`,
        status,
        decodeText(bytes)
      );
    }

    if (status === 204 || bytes.length === 0) return undefined as T;
    return JSON.parse(decodeText(bytes)) as T;
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // --------------------------------------------------------------- global

  async health(): Promise<Health> {
    return this.request<Health>("/api/info");
  }

  async currentProject(): Promise<Project> {
    // v2: `GET /api/location` (NOT enveloped) returns the server's default
    // location: `{ directory, project: { id, directory, canonical } }`.
    const location = await this.request<Record<string, unknown>>("/api/location");
    const project =
      (isRecord(location) && isRecord(location["project"]) ? location["project"] : undefined) ??
      {};
    return {
      id: String(project["id"] ?? ""),
      worktree: String(project["canonical"] ?? (isRecord(location) ? location["directory"] : "")),
      vcs: null,
    };
  }

  /**
   * Effective core config. `PATCH /api/experimental/config` does **not**
   * persist (see docs/core-api-notes.md), so hardening lives in the config
   * file the supervisor writes before spawn — never patched in over HTTP.
   */
  async config(): Promise<Record<string, unknown>> {
    // v2: `GET /api/config` returns the *layered* config documents —
    // `[{ type: "document", path, info: {…config…} }]` (user, project, …).
    // Merge them shallowly, later layers winning, so the UI sees the
    // effective view like v1's single object.
    const body = await this.request<unknown>("/api/config");
    if (Array.isArray(body)) {
      const merged: Record<string, unknown> = {};
      for (const doc of body) {
        if (isRecord(doc) && isRecord(doc["info"])) {
          Object.assign(merged, doc["info"]);
        }
      }
      return merged;
    }
    return unwrap<Record<string, unknown>>(body);
  }

  // ------------------------------------------------------------ providers

  /**
   * Provider catalogue adapted into the internal `ProviderList` shape.
   *
   * v2: `/api/provider` lists catalogue providers (without models — those
   * moved to `/api/model`), `/api/credential` lists connected integrations.
   * We group models by `providerID` and mark connected = credentials +
   * models whose settings carry an apiKey (custom providers).
   */
  async providers(): Promise<ProviderList> {
    const [providerBody, models, creds] = await Promise.all([
      this.request<Envelope<unknown[]>>("/api/provider").catch(() => undefined),
      this.models().catch(() => [] as ProviderModelInfo[]),
      this.request<Envelope<unknown[]>>("/api/credential").catch(() => undefined),
    ]);
    const providerEntries = (providerBody?.data ?? []) as Array<Record<string, unknown>>;
    const credList = (creds?.data ?? []) as Array<Record<string, unknown>>;

    const byName = new Map<string, { name: string; models: Record<string, ProviderModelInfo> }>();
    for (const entry of providerEntries) {
      const id = String(entry["id"] ?? "");
      if (!id) continue;
      byName.set(id, { name: String(entry["name"] ?? id), models: {} });
    }
    for (const model of models) {
      const providerID = model.providerID;
      if (!providerID) continue;
      if (!byName.has(providerID)) {
        byName.set(providerID, { name: providerID, models: {} });
      }
      byName.get(providerID)!.models[model.id] = model;
    }
    const connected = new Set<string>();
    for (const cred of credList) {
      const id = String(cred["integrationID"] ?? "");
      if (id) connected.add(id);
    }
    for (const model of models) {
      if (model.settings && typeof model.settings["apiKey"] === "string" && model.settings["apiKey"]) {
        connected.add(model.providerID);
      }
    }
    return {
      all: Array.from(byName.entries()).map(([id, info]) => ({
        id,
        name: info.name,
        env: [] as string[],
        api: null,
        models: info.models as unknown as Record<string, ProviderModelInfo>,
      })) as unknown as Provider[],
      default: {},
      connected: Array.from(connected),
    };
  }

  async providerAuthMethods(): Promise<Record<string, ProviderAuthMethod[]>> {
    // v2: `/api/integration` lists every provider with its auth methods.
    const body = await this.request<Envelope<unknown[]>>("/api/integration");
    const out: Record<string, ProviderAuthMethod[]> = {};
    for (const entry of (body?.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(entry["id"] ?? "");
      if (!id) continue;
      const methods = Array.isArray(entry["methods"])
        ? (entry["methods"] as Array<Record<string, unknown>>)
        : [];
      out[id] = methods.map((m) => ({
        type: String(m["type"] ?? "key"),
        label: typeof m["label"] === "string" ? m["label"] : undefined,
        names: Array.isArray(m["names"]) ? (m["names"] as string[]) : undefined,
      }));
    }
    return out;
  }

  /** Model catalogue (v2 merged `provider.models` into `/api/model`). */
  async models(): Promise<ProviderModelInfo[]> {
    const body = await this.request<Envelope<ProviderModelInfo[]>>("/api/model");
    return body?.data ?? [];
  }

  /**
   * Store an API key for a provider. v2: integration connect-by-key —
   * applies immediately, persists in the core's credential store.
   */
  setAuth(providerId: string, key: string): Promise<unknown> {
    return this.post(`/api/integration/${encodeURIComponent(providerId)}/connect/key`, {
      key,
    });
  }

  /**
   * Begin an OAuth login for a provider. v2: POST connect/oauth with the
   * `methodID` of the oauth method (usually "oauth"); the response attempt
   * carries the browser URL to open. Poll with `oauthAttemptStatus`.
   */
  async beginOauth(providerId: string): Promise<{ url?: string; attemptID?: string }> {
    const body = await this.post<Envelope<Record<string, unknown>>>(
      `/api/integration/${encodeURIComponent(providerId)}/connect/oauth`,
      { methodID: "oauth" }
    );
    const attempt = (body?.data ?? {}) as Record<string, unknown>;
    return {
      url: typeof attempt["url"] === "string" ? attempt["url"] : undefined,
      attemptID: typeof attempt["id"] === "string" ? attempt["id"] : undefined,
    };
  }

  /** Poll an OAuth attempt: "pending" | "connected" | … */
  async oauthAttemptStatus(providerId: string, attemptID: string): Promise<string> {
    const body = await this.request<Envelope<{ status?: string }>>(
      `/api/integration/${encodeURIComponent(providerId)}/connect/oauth/${encodeURIComponent(attemptID)}`
    );
    return body?.data?.status ?? "pending";
  }

  /** Remove stored credentials for a provider (keys live in the core). */
  async deleteProviderAuth(providerId: string): Promise<boolean> {
    // v2: find the provider's credential and delete it.
    const creds = await this.request<Envelope<unknown[]>>("/api/credential");
    const list = (creds?.data ?? []) as Array<Record<string, unknown>>;
    const entry = list.find((c) => c["integrationID"] === providerId && c["active"]);
    const target = entry ?? list.find((c) => c["integrationID"] === providerId);
    if (!target) return false;
    await this.request(`/api/credential/${encodeURIComponent(String(target["id"]))}`, {
      method: "DELETE",
    });
    return true;
  }

  agents(): Promise<Agent[]> {
    // v2 wraps in `{location, data}`.
    return this.request<Envelope<Agent[]>>("/api/agent").then((b) => b?.data ?? []);
  }

  commands(): Promise<Command[]> {
    return this.request<Envelope<Command[]>>("/api/command").then((b) => b?.data ?? []);
  }

  async mcp(): Promise<Record<string, McpStatus>> {
    const body = await this.request<Envelope<unknown[]>>("/api/mcp");
    const out: Record<string, McpStatus> = {};
    for (const entry of (body?.data ?? []) as Array<Record<string, unknown>>) {
      const name = String(entry["id"] ?? entry["name"] ?? "");
      if (!name) continue;
      out[name] = {
        status: String(entry["status"] ?? entry["state"] ?? "unknown"),
        error: typeof entry["error"] === "string" ? entry["error"] : undefined,
        tools: Array.isArray(entry["tools"])
          ? (entry["tools"] as Array<Record<string, unknown>>).map((t) => String(t["name"] ?? t))
          : undefined,
      };
    }
    return out;
  }

  /** Discovered skills (project + configured sources). */
  skills(): Promise<SkillInfo[]> {
    return this.request<Envelope<SkillInfo[]>>("/api/skill").then((b) => b?.data ?? []);
  }

  /** Register or replace an MCP server on the live core. */
  addMcp(name: string, config: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/experimental/mcp/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(config),
    });
  }

  connectMcp(name: string): Promise<unknown> {
    return this.post(`/api/experimental/mcp/${encodeURIComponent(name)}/connect`);
  }

  disconnectMcp(name: string): Promise<unknown> {
    return this.post(`/api/experimental/mcp/${encodeURIComponent(name)}/disconnect`);
  }

  // ------------------------------------------------------------- sessions

  async sessions(): Promise<Session[]> {
    // v2 is cursor-paginated; the first page (newest 50) matches the v1
    // default the sidebar relied on.
    const body = await this.request<Envelope<WireSession[]>>("/api/session", {
      query: { limit: 50, order: "desc" },
    });
    return (body?.data ?? []).map(adaptSession);
  }

  async createSession(title?: string, parentID?: string): Promise<Session> {
    const body = await this.post<Envelope<WireSession>>("/api/session", {
      title,
      parentID,
    });
    return adaptSession(body?.data ?? { id: "" });
  }

  async deleteSession(id: string): Promise<boolean> {
    await this.request(`/api/session/${id}`, { method: "DELETE" });
    return true;
  }

  async renameSession(id: string, title: string): Promise<Session> {
    const body = await this.request<Envelope<WireSession>>(`/api/session/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    return adaptSession(body?.data ?? { id, title });
  }

  async messages(sessionId: string): Promise<MessageWithParts[]> {
    const body = await this.request<Envelope<WireMessage[]>>(
      `/api/session/${sessionId}/message`
    );
    // v2 returns the transcript NEWEST-first (verified live: the assistant
    // reply precedes the user prompt in the payload). The UI renders the
    // array top-to-bottom, so keep it chronological — oldest first — or the
    // whole chat reads upside-down and new messages appear at the top.
    const adapted = (body?.data ?? []).map(adaptMessage);
    if (adapted.every((m) => (m.info.time?.created ?? 0) > 0)) {
      return adapted.sort(
        (a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0)
      );
    }
    // No usable timestamps: the payload order is authoritative — invert it.
    return adapted.reverse();
  }

  /**
   * Fire a prompt without waiting for the turn to finish; results stream in
   * over `/api/event` (the v2 inbox is async by design — no `_async`
   * variant exists).
   *
   * `variant` selects the reasoning-effort level configured on the model
   * (see add_custom_provider); it rides inside the Model.Ref.
   */
  promptAsync(
    sessionId: string,
    text: string,
    options: { model?: ModelRef; agent?: string; variant?: string; files?: unknown[] } = {}
  ): Promise<unknown> {
    return this.post(`/api/session/${sessionId}/prompt`, {
      text,
      files: options.files ?? [],
      agents: options.agent ? [options.agent] : undefined,
      ...(options.model || options.variant
        ? {
            // The session's model is switched separately in v2; keep parity
            // with v1 by switching before the prompt when requested.
          }
        : {}),
    });
  }

  /** v2 switches the model/agent via dedicated endpoints. */
  switchModel(sessionId: string, model: ModelRef): Promise<unknown> {
    return this.post(`/api/session/${sessionId}/model`, {
      model: {
        id: model.modelID,
        providerID: model.providerID,
        ...(model.variant ? { variant: model.variant } : {}),
      },
    });
  }

  switchAgent(sessionId: string, agent: string): Promise<unknown> {
    return this.post(`/api/session/${sessionId}/agent`, { agent });
  }

  abort(sessionId: string): Promise<unknown> {
    return this.post(`/api/session/${sessionId}/interrupt`);
  }

  /** v2 compaction (was v1 summarize). */
  compact(sessionId: string): Promise<unknown> {
    return this.post(`/api/session/${sessionId}/compact`);
  }

  /**
   * Ask the core to analyze the project and write/update AGENTS.md for it.
   * Result streams over the event bus like any other turn.
   */
  initSession(sessionId: string): Promise<unknown> {
    // v2: run the /init slash command in the session.
    return this.post(`/api/session/${sessionId}/command`, {
      name: "init",
      text: "init",
    });
  }

  revert(sessionId: string, messageID: string): Promise<unknown> {
    return this.post(`/api/session/${sessionId}/revert/stage`, { before: messageID });
  }

  unrevert(sessionId: string): Promise<unknown> {
    return this.request(`/api/session/${sessionId}/revert`, { method: "DELETE" });
  }

  todos(sessionId: string): Promise<Todo[]> {
    return this.request<Envelope<Todo[]>>(`/api/session/${sessionId}/todo`).then(
      (b) => b?.data ?? []
    );
  }

  async runCommand(
    sessionId: string,
    command: string,
    args: string,
    options: { model?: ModelRef; agent?: string } = {}
  ): Promise<unknown> {
    if (options.agent) await this.switchAgent(sessionId, options.agent);
    if (options.model) await this.switchModel(sessionId, options.model);
    return this.post(`/api/session/${sessionId}/command`, {
      name: command,
      text: args,
    });
  }

  /** Pending permission requests (v2 global endpoint). */
  pendingPermissions(): Promise<unknown[]> {
    return this.request<Envelope<unknown[]>>("/api/permission/request").then(
      (b) => b?.data ?? []
    );
  }

  respondToPermission(
    sessionId: string,
    permissionId: string,
    response: PermissionReply
  ): Promise<unknown> {
    // v2: /api/permission/request/{requestID}/reply (session-scoped variant
    // also exists; the global one is authoritative).
    void sessionId;
    return this.post(`/api/permission/request/${encodeURIComponent(permissionId)}/reply`, {
      reply: response === "reject" ? "reject" : response,
    });
  }

  // ---------------------------------------------------------------- files

  async sessionDiff(sessionId: string, messageID?: string): Promise<FileDiff[]> {
    const body = await this.request<Envelope<FileDiff[]>>(
      `/api/session/${sessionId}/diff`,
      { query: { messageID } }
    );
    return body?.data ?? [];
  }

  fileStatus(): Promise<FileStatusEntry[]> {
    // v2: fs listing with change metadata.
    return this.request<Envelope<FileStatusEntry[]>>("/api/fs/list").then(
      (b) => b?.data ?? []
    );
  }

  readFile(path: string): Promise<{ type: string; content: string }> {
    // v2: /api/fs/read/{path...} — path rides in the URL.
    return this.request<{ type: string; content: string }>(
      `/api/fs/read/${path.split("/").map(encodeURIComponent).join("/")}`
    );
  }

  findFiles(query: string, limit = 50): Promise<string[]> {
    return this.request<Envelope<string[]>>("/api/fs/find", {
      query: { query, limit },
    }).then((b) => b?.data ?? []);
  }

  searchText(pattern: string): Promise<unknown[]> {
    return this.request<Envelope<unknown[]>>("/api/fs/find", {
      query: { pattern },
    }).then((b) => b?.data ?? []);
  }

  // --------------------------------------------------------------- events

  /**
   * Subscribe to the core's SSE stream.
   *
   * `EventSource` cannot send an Authorization header, so we read the body
   * stream and parse `data:` frames ourselves. Returns an unsubscribe fn.
   *
   * The stream heals itself: a disconnect (core restart, network blip) is
   * retried with capped exponential backoff instead of leaving the UI blind.
   * Callers learn about persistent failure through `onError`, and about
   * recovery through `onReconnect`, so lost events can be re-fetched.
   *
   * Every raw v2 frame is adapted (see `adaptEvent`) — the store receives
   * the internal event vocabulary.
   */
  subscribe(
    onEvent: (event: CoreEvent) => void,
    onError?: (error: unknown) => void,
    onReconnect?: () => void,
    /** Fires on EVERY successful connection, including the very first. */
    onConnect?: () => void
  ): () => void {
    const emit = (payload: string) => {
      try {
        for (const event of adaptEvent(JSON.parse(payload))) {
          onEvent(event);
        }
      } catch {
        // A malformed frame must not kill the stream.
      }
    };

    if (inTauri()) {
      // Desktop: the Rust pump owns the socket, the reconnect backoff and the
      // re-resolution of the connection after a core restart. We only fan the
      // channel chunks out to the callbacks.
      let streamId: number | null = null;
      let cancelled = false;
      let firstConnect = true;

      const channel = new Channel<CoreEventChunk>();
      channel.onmessage = (chunk) => {
        switch (chunk.type) {
          case "event":
            emit(chunk.payload);
            break;
          case "connected":
            if (!firstConnect) onReconnect?.();
            firstConnect = false;
            onConnect?.();
            break;
          case "dropped":
            if (!cancelled) onError?.(new Error(chunk.message));
            break;
        }
      };

      void invoke<number>("core_events_start", { onEvent: channel })
        .then((id) => {
          if (cancelled) {
            void invoke("core_events_stop", { id }).catch(() => {});
          } else {
            streamId = id;
          }
        })
        .catch((cause) => {
          if (!cancelled) onError?.(cause);
        });

      return () => {
        cancelled = true;
        if (streamId !== null) {
          void invoke("core_events_stop", { id: streamId }).catch(() => {});
        }
      };
    }

    // Plain browser: read the SSE stream directly.
    const controller = new AbortController();

    const run = async () => {
      let attempt = 0;
      let firstConnect = true;

      for (;;) {
        try {
          // Cross-realm note: some environments mix realms (jsdom's
          // AbortSignal handed to Node's undici fetch — and vice versa), and
          // fetch then rejects the signal itself with a TypeError. Fall back
          // to a signal-less request; abort takes effect at the next frame
          // boundary via the aborted check in the read loop below.
          let response: Response;
          try {
            response = await fetch(`${this.baseUrl}/api/event`, {
              headers: { Authorization: this.authHeader, Accept: "text/event-stream" },
              signal: controller.signal,
            });
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            if (!/AbortSignal/i.test(message)) throw cause;
            response = await fetch(`${this.baseUrl}/api/event`, {
              headers: { Authorization: this.authHeader, Accept: "text/event-stream" },
            });
          }
          if (!response.ok || !response.body) {
            throw new CoreError(`Event stream failed: HTTP ${response.status}`);
          }

          attempt = 0;
          if (!firstConnect) onReconnect?.();
          firstConnect = false;
          onConnect?.();

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done || controller.signal.aborted) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE frames are separated by a blank line. Keep the trailing
            // partial frame in the buffer.
            let boundary = buffer.indexOf("\n\n");
            while (boundary !== -1) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const payload = frame
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim())
                .join("");
              if (payload) emit(payload);
              boundary = buffer.indexOf("\n\n");
            }
          }
          // Server closed the stream cleanly — still a drop worth retrying.
          if (controller.signal.aborted) return;
        } catch (error) {
          if (controller.signal.aborted) return;
          onError?.(error);
        }

        // Capped exponential backoff: 250ms, 500ms, … max 8s.
        attempt += 1;
        const delay = Math.min(8000, 250 * 2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (controller.signal.aborted) return;
      }
    };

    void run();
    return () => controller.abort();
  }
}
