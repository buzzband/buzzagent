/**
 * Slash-command routing: a message starting with a project command
 * (from GET /command) must execute via POST /session/:id/command rather than
 * reaching the model as plain text. Unknown "/tokens" stay plain text.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useApp } from "./app";

const SESSION = "ses_cmd";

function makeClient() {
  return {
    runCommand: vi.fn().mockResolvedValue({
      info: { id: "msg_cmd", sessionID: SESSION, role: "assistant" },
      parts: [],
    }),
    promptAsync: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  useApp.setState({
    sessionId: SESSION,
    client: makeClient() as never,
    model: { providerID: "anthropic", modelID: "claude-test" },
    commands: [
      { name: "review", description: "Review the code" },
      { name: "test", description: "Run tests" },
    ],
    busy: false,
    messages: [],
  });
});

describe("slash-command routing in send()", () => {
  it("executes a known command via the core, not the model", async () => {
    const client = useApp.getState().client as unknown as ReturnType<typeof makeClient>;
    await useApp.getState().send("/review fix the parser");

    expect(client.runCommand).toHaveBeenCalledTimes(1);
    expect(client.runCommand).toHaveBeenCalledWith(
      SESSION,
      "review",
      "fix the parser",
      expect.objectContaining({ model: { providerID: "anthropic", modelID: "claude-test" } })
    );
    expect(client.promptAsync).not.toHaveBeenCalled();
  });

  it("executes a command with no arguments", async () => {
    const client = useApp.getState().client as unknown as ReturnType<typeof makeClient>;
    await useApp.getState().send("/test");

    expect(client.runCommand).toHaveBeenCalledWith(SESSION, "test", "", expect.anything());
    expect(client.promptAsync).not.toHaveBeenCalled();
  });

  it("matches command names case-insensitively", async () => {
    const client = useApp.getState().client as unknown as ReturnType<typeof makeClient>;
    await useApp.getState().send("/REVIEW the diff");

    expect(client.runCommand).toHaveBeenCalledWith(SESSION, "review", "the diff", expect.anything());
  });

  it("passes unknown /tokens through as a normal prompt", async () => {
    const client = useApp.getState().client as unknown as ReturnType<typeof makeClient>;
    await useApp.getState().send("/unknowncmd do things");

    expect(client.runCommand).not.toHaveBeenCalled();
    expect(client.promptAsync).toHaveBeenCalledTimes(1);
  });

  it("passes plain messages through as a normal prompt", async () => {
    const client = useApp.getState().client as unknown as ReturnType<typeof makeClient>;
    await useApp.getState().send("plain message with /review inside");

    expect(client.runCommand).not.toHaveBeenCalled();
    expect(client.promptAsync).toHaveBeenCalledTimes(1);
  });
});
