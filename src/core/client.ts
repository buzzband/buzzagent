/**
 * HTTP + SSE client for the local OpenCode core.
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
  MessageWithParts,
  ModelRef,
  Part,
  PermissionReply,
  Project,
  ProviderAuthMethod,
  ProviderList,
  Session,
  SkillInfo,
  Todo,
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
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
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

  health(): Promise<Health> {
    return this.request<Health>("/global/health");
  }

  currentProject(): Promise<Project> {
    return this.request<Project>("/project/current");
  }

  /**
   * Effective core config. Note that `PATCH /config` does **not** persist
   * (see docs/core-api-notes.md), so hardening lives in the config file the
   * supervisor writes before spawn — never patched in over HTTP.
   */
  config(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/config");
  }

  // ------------------------------------------------------------ providers

  providers(): Promise<ProviderList> {
    return this.request<ProviderList>("/provider");
  }

  providerAuthMethods(): Promise<Record<string, ProviderAuthMethod[]>> {
    return this.request<Record<string, ProviderAuthMethod[]>>("/provider/auth");
  }

  /**
   * Store credentials for a provider. Applies immediately — no restart —
   * and the core persists them itself, so keys never touch our stores.
   */
  setAuth(providerId: string, body: Record<string, unknown>): Promise<boolean> {
    return this.request<boolean>(`/auth/${encodeURIComponent(providerId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  oauthAuthorize(providerId: string): Promise<Record<string, unknown>> {
    return this.post(`/provider/${encodeURIComponent(providerId)}/oauth/authorize`);
  }

  oauthCallback(providerId: string, body: Record<string, unknown>): Promise<boolean> {
    return this.post(`/provider/${encodeURIComponent(providerId)}/oauth/callback`, body);
  }

  agents(): Promise<Agent[]> {
    return this.request<Agent[]>("/agent");
  }

  commands(): Promise<Command[]> {
    return this.request<Command[]>("/command");
  }

  mcp(): Promise<Record<string, McpStatus>> {
    return this.request<Record<string, McpStatus>>("/mcp");
  }

  /** Discovered skills (project + configured sources). Verified shape:
   *  `{ name, description, location, content }`. */
  skills(): Promise<SkillInfo[]> {
    return this.request<SkillInfo[]>("/skill");
  }

  /** Register or replace an MCP server on the live core. */
  addMcp(
    name: string,
    config: Record<string, unknown>
  ): Promise<unknown> {
    return this.post("/mcp", { name, config });
  }

  connectMcp(name: string): Promise<unknown> {
    return this.post(`/mcp/${encodeURIComponent(name)}/connect`);
  }

  disconnectMcp(name: string): Promise<unknown> {
    return this.post(`/mcp/${encodeURIComponent(name)}/disconnect`);
  }

  /** Remove stored credentials for a provider (keys live in the core, not us). */
  deleteProviderAuth(providerId: string): Promise<boolean> {
    return this.request<boolean>(`/auth/${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    });
  }

  // ------------------------------------------------------------- sessions

  sessions(): Promise<Session[]> {
    return this.request<Session[]>("/session");
  }

  createSession(title?: string, parentID?: string): Promise<Session> {
    return this.post<Session>("/session", { title, parentID });
  }

  deleteSession(id: string): Promise<boolean> {
    return this.request<boolean>(`/session/${id}`, { method: "DELETE" });
  }

  renameSession(id: string, title: string): Promise<Session> {
    return this.request<Session>(`/session/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  messages(sessionId: string): Promise<MessageWithParts[]> {
    return this.request<MessageWithParts[]>(`/session/${sessionId}/message`);
  }

  /**
   * Fire a prompt without waiting for the turn to finish; results stream in
   * over `/event`. Preferred over the blocking form so the UI stays live.
   *
   * `variant` selects the reasoning-effort level configured on the model
   * (see add_custom_provider). It must be TOP-LEVEL in the body — the core's
   * prompt schema reads model/agent/parts/variant at the same level; nesting
   * it under `model` would be ignored.
   */
  promptAsync(
    sessionId: string,
    parts: Part[],
    options: { model?: ModelRef; agent?: string; variant?: string } = {}
  ): Promise<void> {
    return this.post<void>(`/session/${sessionId}/prompt_async`, {
      parts,
      model: options.model,
      agent: options.agent,
      variant: options.variant,
    });
  }

  /** Blocking variant; kept for tests and non-interactive flows. */
  prompt(
    sessionId: string,
    parts: Part[],
    options: { model?: ModelRef; agent?: string; variant?: string } = {}
  ): Promise<MessageWithParts> {
    return this.post<MessageWithParts>(`/session/${sessionId}/message`, {
      parts,
      model: options.model,
      agent: options.agent,
      variant: options.variant,
    });
  }

  abort(sessionId: string): Promise<boolean> {
    return this.post<boolean>(`/session/${sessionId}/abort`);
  }

  summarize(sessionId: string, model: ModelRef): Promise<boolean> {
    return this.post<boolean>(`/session/${sessionId}/summarize`, {
      providerID: model.providerID,
      modelID: model.modelID,
    });
  }

  /**
   * Ask the core to analyze the project and write/update AGENTS.md for it.
   * Result streams over the event bus like any other turn.
   */
  initSession(sessionId: string): Promise<boolean> {
    return this.post<boolean>(`/session/${sessionId}/init`);
  }

  revert(sessionId: string, messageID: string, partID?: string): Promise<unknown> {
    return this.post(`/session/${sessionId}/revert`, { messageID, partID });
  }

  unrevert(sessionId: string): Promise<unknown> {
    return this.post(`/session/${sessionId}/unrevert`);
  }

  todos(sessionId: string): Promise<Todo[]> {
    return this.request<Todo[]>(`/session/${sessionId}/todo`);
  }

  runCommand(
    sessionId: string,
    command: string,
    args: string,
    options: { model?: ModelRef; agent?: string } = {}
  ): Promise<MessageWithParts> {
    return this.post<MessageWithParts>(`/session/${sessionId}/command`, {
      command,
      arguments: args,
      model: options.model,
      agent: options.agent,
    });
  }

  /**
   * Answer a permission request.
   *
   * The pinned core exposes two surfaces: the legacy
   * `/session/:id/permissions/:permissionID` and the newer
   * `/permission/:requestID/reply`. Which one applies depends on whether the
   * request arrived as `permission.asked` or `permission.v2.asked`, so try the
   * session-scoped route first and fall back rather than leaving the agent
   * blocked on an unanswered prompt.
   */
  /**
   * Pending permission requests, both event generations.
   *
   * A prompt that arrives while the SSE stream is down would otherwise hang
   * the agent forever: the run is paused waiting for an answer to something
   * the UI never saw. Call this on every (re)connect and merge the results.
   */
  pendingPermissions(): Promise<unknown[]> {
    return this.request<unknown[]>("/permission");
  }

  async respondToPermission(
    sessionId: string,
    permissionId: string,
    response: PermissionReply
  ): Promise<boolean> {
    try {
      return await this.post<boolean>(
        `/session/${sessionId}/permissions/${permissionId}`,
        { response }
      );
    } catch (error) {
      if (!(error instanceof CoreError) || (error.status !== 404 && error.status !== 400)) {
        throw error;
      }
      return this.post<boolean>(`/permission/${permissionId}/reply`, {
        reply: response,
      });
    }
  }

  // ---------------------------------------------------------------- files

  sessionDiff(sessionId: string, messageID?: string): Promise<FileDiff[]> {
    return this.request<FileDiff[]>(`/session/${sessionId}/diff`, {
      query: { messageID },
    });
  }

  fileStatus(): Promise<FileStatusEntry[]> {
    return this.request<FileStatusEntry[]>("/file/status");
  }

  readFile(path: string): Promise<{ type: string; content: string }> {
    return this.request<{ type: string; content: string }>("/file/content", {
      query: { path },
    });
  }

  findFiles(query: string, limit = 50): Promise<string[]> {
    return this.request<string[]>("/find/file", { query: { query, limit } });
  }

  searchText(pattern: string): Promise<unknown[]> {
    return this.request<unknown[]>("/find", { query: { pattern } });
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
   */
  subscribe(
    onEvent: (event: CoreEvent) => void,
    onError?: (error: unknown) => void,
    onReconnect?: () => void,
    /** Fires on EVERY successful connection, including the very first. */
    onConnect?: () => void
  ): () => void {
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
            try {
              onEvent(JSON.parse(chunk.payload) as CoreEvent);
            } catch {
              // A malformed frame must not kill the stream.
            }
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
            response = await fetch(`${this.baseUrl}/event`, {
              headers: { Authorization: this.authHeader, Accept: "text/event-stream" },
              signal: controller.signal,
            });
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            if (!/AbortSignal/i.test(message)) throw cause;
            response = await fetch(`${this.baseUrl}/event`, {
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
              if (payload) {
                try {
                  onEvent(JSON.parse(payload) as CoreEvent);
                } catch {
                  // A malformed frame must not kill the stream.
                }
              }
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
