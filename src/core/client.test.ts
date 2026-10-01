import { CoreClient, CoreError } from "./client";
import type { CoreConnection } from "./types";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  // Minimal stand-in: the client only ever assigns `.onmessage`.
  Channel: class {
    onmessage: ((chunk: unknown) => void) | null = null;
  },
}));

const connection: CoreConnection = {
  base_url: "http://127.0.0.1:4096/",
  username: "opencode",
  password: "secret",
  directory: "/tmp/project",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build an SSE response from raw wire text, to test frame parsing. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("CoreClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalises the base URL and sends basic auth", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ healthy: true, version: "1.18.30" }));
    const client = new CoreClient(connection);

    const health = await client.health();

    expect(health.version).toBe("1.18.30");
    const [url, init] = fetchMock.mock.calls[0];
    // Trailing slash trimmed, so paths do not double up.
    expect(url).toBe("http://127.0.0.1:4096/global/health");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa("opencode:secret")}`
    );
  });

  it("serialises query params and skips undefined", async () => {
    // A Response body can only be read once, so hand out a fresh one per call.
    fetchMock.mockImplementation(async () => jsonResponse([]));
    const client = new CoreClient(connection);

    await client.sessionDiff("ses_1", undefined);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:4096/session/ses_1/diff"
    );

    await client.sessionDiff("ses_1", "msg_9");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://127.0.0.1:4096/session/ses_1/diff?messageID=msg_9"
    );
  });

  it("throws a descriptive CoreError on HTTP failure", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    const client = new CoreClient(connection);

    await expect(client.health()).rejects.toMatchObject({
      name: "CoreError",
      status: 401,
    });
  });

  it("explains an unreachable core instead of leaking a fetch error", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    const client = new CoreClient(connection);

    await expect(client.health()).rejects.toThrow(/Cannot reach the agent core/);
  });

  it("treats 204 as an empty result", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const client = new CoreClient(connection);

    await expect(
      client.promptAsync("ses_1", [{ type: "text", text: "hi" }])
    ).resolves.toBeUndefined();
  });

  it("sends prompt payloads with model and parts", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const client = new CoreClient(connection);

    await client.promptAsync("ses_2", [{ type: "text", text: "hello" }], {
      model: { providerID: "openai", modelID: "gpt-4o" },
      agent: "build",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toEqual({ providerID: "openai", modelID: "gpt-4o" });
    expect(body.parts[0].text).toBe("hello");
    expect(body.agent).toBe("build");
  });

  it("sends the reasoning variant as a TOP-LEVEL prompt field", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const client = new CoreClient(connection);

    await client.promptAsync("ses_3", [{ type: "text", text: "think hard" }], {
      model: { providerID: "site", modelID: "big" },
      variant: "high",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.variant).toBe("high");
    // Must not be nested under model — the core reads variant at body level.
    expect(body.model).toEqual({ providerID: "site", modelID: "big" });
  });

  it("parses SSE frames split across chunk boundaries", async () => {
    // The first event is deliberately cut mid-JSON to prove buffering works.
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"id":"e1","type":"server.conn',
        'ected","properties":{}}\n\n',
        'data: {"id":"e2","type":"message.part.updated","properties":{"x":1}}\n\n',
      ])
    );

    const events: string[] = [];
    const client = new CoreClient(connection);
    client.subscribe((event) => events.push(event.type));
    await vi.waitFor(() => expect(events.length).toBe(2));
    expect(events).toEqual(["server.connected", "message.part.updated"]);
  });

  it("ignores malformed frames without killing the stream", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        "data: {not json}\n\n",
        'data: {"id":"e3","type":"session.updated"}\n\n',
      ])
    );

    const events: string[] = [];
    const client = new CoreClient(connection);
    client.subscribe((event) => events.push(event.type));

    await vi.waitFor(() => expect(events).toEqual(["session.updated"]));
  });

  it("reports stream failures through onError", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const client = new CoreClient(connection);

    let error: unknown;
    client.subscribe(
      () => undefined,
      (e) => {
        error = e;
      }
    );

    await vi.waitFor(() => expect(error).toBeInstanceOf(CoreError));
  });

  it("does not report an error after unsubscribing", async () => {
    let cancelled = false;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          cancelled = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const client = new CoreClient(connection);
    const onError = vi.fn();
    const unsubscribe = client.subscribe(() => undefined, onError);
    unsubscribe();

    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(onError).not.toHaveBeenCalled();
  });

  it("proxies requests through core_http inside Tauri (no direct fetch)", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({
      status: 200,
      bodyBase64: btoa(JSON.stringify({ healthy: true, version: "1.18.30" })),
      contentType: "application/json",
    });

    const client = new CoreClient(connection);
    const health = await client.health();

    expect(health.version).toBe("1.18.30");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("core_http", {
      method: "GET",
      path: "http://127.0.0.1:4096/global/health",
      body: null,
    });

    vi.unstubAllGlobals();
  });

  it("maps core_http failures to a descriptive CoreError", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockRejectedValue("core is gone");

    const client = new CoreClient(connection);
    await expect(client.health()).rejects.toThrow(/Cannot reach the agent core/);

    vi.unstubAllGlobals();
  });

  it("raises HTTP errors from proxied responses", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    vi.mocked(invoke).mockResolvedValue({
      status: 401,
      bodyBase64: btoa("nope"),
      contentType: "text/plain",
    });

    const client = new CoreClient(connection);
    await expect(client.health()).rejects.toMatchObject({
      name: "CoreError",
      status: 401,
    });

    vi.unstubAllGlobals();
  });

  it("streams events through the Rust pump and stops it on unsubscribe", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    let deliver: ((chunk: unknown) => void) | null = null;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "core_events_start") {
        deliver = (args as { onEvent: { onmessage: (c: unknown) => void } })
          .onEvent.onmessage;
        return 42;
      }
      if (cmd === "core_events_stop" && streamStop) streamStop(args);
      return undefined;
    });
    const streamStop = vi.fn();

    const events: string[] = [];
    const reconnects = vi.fn();
    const client = new CoreClient(connection);
    const unsubscribe = client.subscribe(
      (event) => events.push(event.type),
      undefined,
      reconnects
    );

    await vi.waitFor(() => expect(deliver).not.toBeNull());
    deliver!({ type: "connected" });
    deliver!({ type: "event", payload: '{"type":"message.part.updated"}' });
    deliver!({ type: "event", payload: "{not json}" }); // must be swallowed
    deliver!({ type: "connected" });

    await vi.waitFor(() => expect(events).toEqual(["message.part.updated"]));
    expect(reconnects).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("core_events_stop", { id: 42 })
    );

    vi.unstubAllGlobals();
  });
});
