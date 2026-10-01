import { pickUserProvider } from "./app";
import type { ProviderList } from "../core/types";

function providerList(partial: Partial<ProviderList>): ProviderList {
  return {
    all: [],
    default: {},
    connected: [],
    ...partial,
  };
}

describe("pickUserProvider", () => {
  it("never picks OpenCode Zen implicitly", () => {
    // Zen is 'connected' out of the box with free models; auto-selecting it
    // would silently send a first prompt to a hosted gateway.
    const list = providerList({
      all: [{ id: "opencode", name: "OpenCode Zen", models: { "big-pickle": {} } }],
      default: { opencode: "big-pickle" },
      connected: ["opencode"],
    });

    expect(pickUserProvider(list)).toBeNull();
  });

  it("prefers a user-configured provider and its default model", () => {
    const list = providerList({
      all: [
        { id: "opencode", name: "OpenCode Zen", models: { "big-pickle": {} } },
        { id: "openai", name: "OpenAI", models: { "gpt-4o": {}, "o3-mini": {} } },
      ],
      default: { opencode: "big-pickle", openai: "gpt-4o" },
      connected: ["opencode", "openai"],
    });

    expect(pickUserProvider(list)).toEqual({
      providerID: "openai",
      modelID: "gpt-4o",
    });
  });

  it("falls back to the first model when a provider has no default", () => {
    const list = providerList({
      all: [{ id: "ollama", name: "Ollama", models: { "qwen3-coder": {} } }],
      connected: ["ollama"],
    });

    expect(pickUserProvider(list)).toEqual({
      providerID: "ollama",
      modelID: "qwen3-coder",
    });
  });

  it("returns null when nothing is configured", () => {
    expect(pickUserProvider(providerList({}))).toBeNull();
  });

  it("ignores a connected provider that reports no models", () => {
    const list = providerList({
      all: [{ id: "broken", name: "Broken", models: {} }],
      connected: ["broken"],
    });

    expect(pickUserProvider(list)).toBeNull();
  });
});
