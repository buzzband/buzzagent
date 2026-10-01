import { describe, expect, it } from "vitest";
import {
  BUILTINS,
  isAssistantMessage,
  isUserMessage,
  resolveBuiltin,
  transcriptToMarkdown,
} from "./builtinCommands";

const msg = (role: string, id: string, text: string) => ({
  info: { id, role, time: { created: 0 } },
  parts: [{ type: "text", text }],
});

const textOf = (m: unknown) =>
  ((m as { parts?: { type: string; text?: string }[] }).parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n");

describe("resolveBuiltin", () => {
  it("resolves every registered command by name", () => {
    for (const c of BUILTINS) {
      expect(resolveBuiltin(c.name)?.name).toBe(c.name);
    }
  });

  it("resolves aliases case-insensitively", () => {
    expect(resolveBuiltin("Summarize")?.name).toBe("compact");
    expect(resolveBuiltin("COMMANDS")?.name).toBe("help");
  });

  it("returns undefined for unknown or project tokens", () => {
    expect(resolveBuiltin("nope")).toBeUndefined();
    expect(resolveBuiltin("")).toBeUndefined();
  });
});

describe("transcriptToMarkdown", () => {
  it("renders role headings and text bodies", () => {
    const md = transcriptToMarkdown(
      [msg("user", "u1", "hello"), msg("assistant", "a1", "hi there")],
      textOf
    );
    expect(md).toContain("## User");
    expect(md).toContain("hello");
    expect(md).toContain("## Assistant");
    expect(md).toContain("hi there");
  });

  it("produces empty output for an empty session", () => {
    expect(transcriptToMarkdown([], textOf)).toBe("");
  });
});

describe("message role helpers", () => {
  it("classifies user and assistant messages", () => {
    expect(isUserMessage(msg("user", "u1", "x"))).toBe(true);
    expect(isUserMessage(msg("assistant", "a1", "y"))).toBe(false);
    expect(isAssistantMessage(msg("assistant", "a1", "y"))).toBe(true);
    expect(isAssistantMessage({ info: {} })).toBe(false);
  });
});

describe("/copy", () => {
  it("copies the last assistant reply", async () => {
    const copied: string[] = [];
    const { run } = resolveBuiltin("copy")!;
    await run(
      {
        sessionId: "s1",
        language: "en",
        messageText: textOf,
        messages: [msg("user", "u1", "q"), msg("assistant", "a1", "first"), msg("assistant", "a2", "second")],
        model: null,
        api: {} as never,
        fs: { copyToClipboard: async (t: string) => void copied.push(t) } as never,
        notify: () => {},
        fail: () => {},
      },
      ""
    );
    expect(copied).toEqual(["second"]);
  });

  it("notifies when there is nothing to copy", async () => {
    const notes: string[] = [];
    const { run } = resolveBuiltin("copy")!;
    await run(
      {
        sessionId: "s1",
        language: "en",
        messageText: textOf,
        messages: [],
        model: null,
        api: {} as never,
        fs: { copyToClipboard: async () => {} } as never,
        notify: (m) => notes.push(m),
        fail: () => {},
      },
      ""
    );
    expect(notes).toEqual(["Nothing to copy yet"]);
  });
});

describe("/undo", () => {
  it("reverts the last user message by id", async () => {
    const reverted: string[] = [];
    const { run } = resolveBuiltin("undo")!;
    await run(
      {
        sessionId: "s1",
        language: "en",
        messageText: textOf,
        messages: [msg("user", "u1", "q1"), msg("assistant", "a1", "r1"), msg("user", "u2", "q2")],
        model: null,
        api: { revert: async (_s: string, id: string) => void reverted.push(id) } as never,
        fs: {} as never,
        notify: () => {},
        fail: () => {},
      },
      ""
    );
    expect(reverted).toEqual(["u2"]);
  });

  it("fails loudly without a session", async () => {
    const { run } = resolveBuiltin("undo")!;
    await expect(
      run(
        {
          sessionId: null,
          language: "en",
          messageText: textOf,
          messages: [],
          model: null,
          api: {} as never,
          fs: {} as never,
          notify: () => {},
          fail: () => {},
        },
        ""
      )
    ).rejects.toThrow("No active session");
  });
});

describe("/compact", () => {
  it("calls summarize with the active model", async () => {
    const calls: unknown[] = [];
    const { run } = resolveBuiltin("compact")!;
    await run(
      {
        sessionId: "s1",
        language: "en",
        messageText: textOf,
        messages: [],
        model: { providerID: "p", modelID: "m" },
        api: {
          summarize: async (_s: string, model: unknown) => void calls.push(model),
        } as never,
        fs: {} as never,
        notify: () => {},
        fail: () => {},
      },
      ""
    );
    expect(calls).toEqual([{ providerID: "p", modelID: "m" }]);
  });
});
