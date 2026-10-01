import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The store imports Tauri APIs at module load; mock them before the import
 * like the other store tests do.
 */
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }));

import { useApp } from "./app";

describe("send() builtin routing", () => {
  beforeEach(() => {
    useApp.setState({
      commands: [],
      sessionId: "s1",
      client: {
        summarize: vi.fn(async () => true),
        revert: vi.fn(async () => ({})),
        unrevert: vi.fn(async () => ({})),
        initSession: vi.fn(async () => true),
        messages: vi.fn(async () => []),
      } as never,
      messages: [],
      model: { providerID: "p", modelID: "m" },
      lastError: null,
    });
  });

  it("runs /compact through the core without sending a chat message", async () => {
    const client = useApp.getState().client!;
    await useApp.getState().send("/compact");
    expect(client.summarize).toHaveBeenCalledWith("s1", { providerID: "p", modelID: "m" });
  });

  it("project commands shadow built-ins with the same name", async () => {
    const runSlash = vi.fn(async () => undefined);
    useApp.setState({
      commands: [{ name: "compact", description: "project variant" }],
    } as never);
    const spy = vi
      .spyOn(useApp.getState(), "runSlashCommand")
      .mockImplementation(runSlash as never);
    try {
      await useApp.getState().send("/compact do it");
      expect(runSlash).toHaveBeenCalled();
      expect(useApp.getState().client!.summarize).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("unknown slash tokens pass through as plain text", async () => {
    const promptAsync = vi.fn(async () => ({}));
    useApp.setState({
      client: { promptAsync } as never,
    });
    await useApp.getState().send("/notacommand hello");
    expect(promptAsync).toHaveBeenCalled();
  });
});
