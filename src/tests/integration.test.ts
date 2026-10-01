/**
 * Integration test: the real client against a real `opencode serve`.
 *
 * Unit tests mock `fetch`, which proves the client's logic but not that our
 * understanding of the core's API is correct. This test talks to an actual
 * core, so a protocol change breaks it loudly.
 *
 * It is skipped unless a core is provided, keeping `npm test` hermetic:
 *
 *   BUZZ_TEST_CORE_URL=http://127.0.0.1:4611 \
 *   BUZZ_TEST_CORE_PASSWORD=p3 \
 *   BUZZ_TEST_MODEL=mock/mock-coder \
 *   npm run test:integration
 */

import { CoreClient } from "../core/client";
import type { CoreConnection, ModelRef } from "../core/types";

const url = process.env.BUZZ_TEST_CORE_URL;
const password = process.env.BUZZ_TEST_CORE_PASSWORD;
const modelSpec = process.env.BUZZ_TEST_MODEL;

const enabled = Boolean(url && password);

function parseModel(spec: string | undefined): ModelRef | null {
  if (!spec) return null;
  const slash = spec.indexOf("/");
  if (slash === -1) return null;
  return { providerID: spec.slice(0, slash), modelID: spec.slice(slash + 1) };
}

describe.skipIf(!enabled)("core integration", () => {
  const connection: CoreConnection = {
    base_url: url ?? "",
    username: process.env.BUZZ_TEST_CORE_USERNAME ?? "opencode",
    password: password ?? "",
    directory: "",
  };
  const client = new CoreClient(connection);
  const model = parseModel(modelSpec);

  it("reports health", async () => {
    const health = await client.health();
    expect(health.healthy).toBe(true);
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects a wrong password", async () => {
    const bad = new CoreClient({ ...connection, password: "definitely-wrong" });
    await expect(bad.health()).rejects.toMatchObject({ status: 401 });
  });

  it("returns the current project", async () => {
    const project = await client.currentProject();
    expect(project.worktree).toBeTruthy();
  });

  // First call may refresh the model catalogue on a cold core: allow for it.
  it("lists providers and reports Zen as connected by default", { timeout: 20_000 }, async () => {
    const providers = await client.providers();
    expect(providers.all.length).toBeGreaterThan(0);
    // Documented behaviour we defend against in pickUserProvider.
    expect(providers.connected).toContain("opencode");
  });

  it("has share disabled by the forced config", { timeout: 20_000 }, async () => {
    const config = await client.config();
    expect(config.share).toBe("disabled");
  });

  it("creates, lists and deletes a session", async () => {
    const session = await client.createSession("integration probe");
    expect(session.id).toMatch(/^ses_/);

    const sessions = await client.sessions();
    expect(sessions.some((s) => s.id === session.id)).toBe(true);

    expect(await client.deleteSession(session.id)).toBe(true);
  });

  it("streams events over SSE", { timeout: 20_000 }, async () => {
    const seen: string[] = [];
    const stop = client.subscribe((event) => seen.push(event.type));

    // The SSE connection is established asynchronously; a session created
    // before the stream is up would be missed — the core does not replay
    // events to late subscribers. Wait for the first frame, then create.
    await vi.waitFor(() => expect(seen).toContain("server.connected"), {
      timeout: 10_000,
    });

    const session = await client.createSession("event probe");
    await vi.waitFor(() => expect(seen).toContain("session.created"), {
      timeout: 10_000,
    });
    expect(seen[0]).toBe("server.connected");

    stop();
    await client.deleteSession(session.id);
  });

  it.skipIf(!model)("runs a full turn and reports parts", async () => {
    const session = await client.createSession("turn probe");
    try {
      const result = await client.prompt(
        session.id,
        [{ type: "text", text: "hello there" }],
        { model: model! }
      );

      expect(result.info.role).toBe("assistant");
      expect(result.info.error ?? null).toBeNull();

      const types = result.parts.map((p) => p.type);
      expect(types).toContain("step-start");
      expect(types).toContain("text");
    } finally {
      await client.deleteSession(session.id);
    }
  }, 120_000);

  /**
   * Regression guard for the "working forever" bug.
   *
   * Feeds the *live* event stream through the real store projection, so it
   * fails if the core stops sending a signal we rely on, or if we stop
   * handling one. Unit tests use recorded payloads; this uses the real thing.
   */
  it.skipIf(!model)("clears busy and streams text through the store", async () => {
    const { useApp } = await import("../store/app");
    const session = await client.createSession("store probe");

    useApp.setState({ sessionId: session.id, messages: [], busy: true, queue: [] });
    const stop = client.subscribe((event) => useApp.getState().__handleEvent(event));

    try {
      await client.promptAsync(session.id, [{ type: "text", text: "hello" }], {
        model: model!,
      });

      // The turn must end by itself: this is exactly what hung before.
      await vi.waitFor(() => expect(useApp.getState().busy).toBe(false), {
        timeout: 60_000,
        interval: 200,
      });

      const text = useApp
        .getState()
        .messages.flatMap((m) => m.parts)
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("");
      expect(text.length).toBeGreaterThan(0);
    } finally {
      stop();
      useApp.setState({ sessionId: null, messages: [], busy: false });
      await client.deleteSession(session.id);
    }
  }, 120_000);

  it.skipIf(!model)("surfaces a tool call with its state", async () => {
    const session = await client.createSession("tool probe");
    try {
      // The mock provider answers a prompt containing "write" with a write
      // tool call, which is what we want to observe.
      await client.prompt(
        session.id,
        [{ type: "text", text: "please write a file" }],
        { model: model! }
      );

      // In OpenCode, a multi-step turn splits across messages:
      // message 1 (assistant): step-start, tool, step-finish
      // message 2 (assistant): step-start, text, step-finish
      // So inspect all messages in the session.
      const messages = await client.messages(session.id);
      const allParts = messages.flatMap((m) => m.parts);
      const tool = allParts.find((p) => p.type === "tool");

      expect(tool).toBeDefined();
      expect(tool?.state?.status).toBe("completed");
      expect(tool?.tool).toBe("write");
    } finally {
      await client.deleteSession(session.id);
    }
  }, 120_000);
});
