import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reasoning chip must be INSTANT: flip optimistically and persist without
 * restarting the core. The old implementation routed through
 * saveCustomProvider, whose step 3 is a full `core_restart` — every click
 * tore down the SSE stream, killed any running turn and left the chip
 * unresponsive for the whole restart (~a minute on slow disks).
 */

/* eslint-disable @typescript-eslint/no-unused-vars -- mock signature must match invoke's */
const invokeMock = vi.fn((_command: string, _args?: unknown): Promise<unknown> => Promise.resolve({}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

import { useApp } from "./app";

function readyStore() {
  useApp.setState({
    model: { providerID: "site", modelID: "big" },
    customProviders: {
      site: {
        name: "Site",
        options: { baseURL: "https://x.example", apiKey: "k" },
        models: { big: { name: "Big", reasoning: false } },
      },
    },
    sessionId: "ses1",
    lastError: null,
  } as never);
  invokeMock.mockReset();
  invokeMock.mockImplementation(async () => ({}));
}

describe("toggleModelReasoning (instant chip)", () => {
  beforeEach(readyStore);

  it("flips the flag optimistically before any await", async () => {
    // Hold the persistence in flight: the chip must already have flipped.
    let release!: () => void;
    invokeMock.mockImplementation(() => new Promise<void>((r) => (release = r)));

    const done = useApp.getState().toggleModelReasoning();

    const models = (useApp.getState().customProviders.site as { models: Record<string, { reasoning?: boolean }> }).models;
    expect(models.big.reasoning).toBe(true);

    release();
    await done;
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("core_save_custom_provider");
    const args = invokeMock.mock.calls[0][1] as { models: { id: string; reasoning: boolean }[] };
    expect(args.models.find((m) => m.id === "big")?.reasoning).toBe(true);
  });

  it("persists WITHOUT restarting the core", async () => {
    await useApp.getState().toggleModelReasoning();
    const commands = invokeMock.mock.calls.map((c) => c[0]);
    expect(commands).toContain("core_save_custom_provider");
    expect(commands).not.toContain("core_restart");
  });

  it("keeps the chosen level when the capability flag is flipped", async () => {
    useApp.setState({
      customProviders: {
        site: {
          name: "Site",
          options: { baseURL: "https://x.example", apiKey: "k" },
          models: { big: { name: "Big", reasoning: false, level: "high" } },
        },
      },
    } as never);
    await useApp.getState().toggleModelReasoning();

    const args = invokeMock.mock.calls[0][1] as {
      models: { id: string; reasoning: boolean; level: string | null }[];
    };
    expect(args.models.find((m) => m.id === "big")).toMatchObject({
      reasoning: true,
      level: "high",
    });
  });

  it("rolls the optimistic flip back and reports when persistence fails", async () => {
    invokeMock.mockRejectedValue(new Error("disk full"));
    await useApp.getState().toggleModelReasoning();

    const models = (useApp.getState().customProviders.site as { models: Record<string, { reasoning?: boolean }> }).models;
    expect(models.big.reasoning).toBe(false);
    expect(useApp.getState().lastError).not.toBeNull();
  });

  it("opens provider settings when the model is not a custom provider", async () => {
    useApp.setState({ model: { providerID: "openai", modelID: "gpt-4o" } } as never);
    await useApp.getState().toggleModelReasoning();
    expect(useApp.getState().settingsOpen).toBe(true);
    expect(useApp.getState().settingsInitialTab).toBe("providers");
  });

  it("insertIntoComposer sets the one-shot draft", () => {
    useApp.getState().insertIntoComposer("fixed prompt");
    expect(useApp.getState().composerDraft).toBe("fixed prompt");
  });
});

describe("setModelReasoningLevel (0.1.16)", () => {
  beforeEach(readyStore);

  /** The payload the UI persists for the active model. */
  const savedEntry = () => {
    const args = invokeMock.mock.calls[0][1] as {
      models: { id: string; reasoning: boolean; level: string | null }[];
    };
    return args.models.find((m) => m.id === "big");
  };

  it("persists the level optimistically, without a core restart", async () => {
    let release!: () => void;
    invokeMock.mockImplementation(() => new Promise<void>((r) => (release = r)));

    const done = useApp.getState().setModelReasoningLevel("high");

    const models = (useApp.getState().customProviders.site as {
      models: Record<string, { reasoning?: boolean; level?: string }>;
    }).models;
    expect(models.big).toMatchObject({ reasoning: true, level: "high" });

    release();
    await done;
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0][0]).toBe("core_save_custom_provider");
    expect(savedEntry()).toMatchObject({ reasoning: true, level: "high" });
    const commands = invokeMock.mock.calls.map((c) => c[0]);
    expect(commands).not.toContain("core_restart");
  });

  it("rolls the level back and reports when persistence fails", async () => {
    invokeMock.mockRejectedValue(new Error("disk full"));
    await useApp.getState().setModelReasoningLevel("low");

    const models = (useApp.getState().customProviders.site as {
      models: Record<string, { reasoning?: boolean; level?: string }>;
    }).models;
    expect(models.big.level).toBeUndefined();
    expect(useApp.getState().lastError).not.toBeNull();
  });

  it("choosing a level turns reasoning on; 'off' clears flag and level", async () => {
    await useApp.getState().setModelReasoningLevel("medium");
    expect(savedEntry()).toMatchObject({ reasoning: true, level: "medium" });

    invokeMock.mockClear();
    await useApp.getState().setModelReasoningLevel("off");
    expect(savedEntry()).toMatchObject({ reasoning: false, level: null });
  });

  it("the level survives when persistence is triggered twice", async () => {
    await useApp.getState().setModelReasoningLevel("xhigh");
    invokeMock.mockClear();
    await useApp.getState().toggleModelReasoning(); // flip off keeps level
    expect(savedEntry()).toMatchObject({ reasoning: false, level: "xhigh" });
  });
});
