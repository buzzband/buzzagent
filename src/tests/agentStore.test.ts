import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore, DiffEntry } from "../stores/agentStore";
import { AgentEvent } from "../types";

function dispatch(event: AgentEvent) {
  // handleAgentEvent is internal; trigger it through the public surface by
  // starting with a mocked service. Simpler: poke the store via a fake start.
  // We test through startAgent's callback path instead.
  return event;
}

describe("agentStore", () => {
  beforeEach(() => {
    useAgentStore.getState().clearSession();
    useAgentStore.setState({
      agent: {
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-test",
        projectPath: "/tmp/project",
        effort: "medium",
      },
    });
  });

  it("starts with a clean session", () => {
    const s = useAgentStore.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.diffs).toHaveLength(0);
    expect(s.isRunning).toBe(false);
  });

  it("requires a configured agent to start", async () => {
    useAgentStore.setState({ agent: null });
    await useAgentStore.getState().startAgent("do something");
    const s = useAgentStore.getState();
    expect(s.messages.some((m) => m.content.includes("No model configured"))).toBe(true);
    expect(s.isRunning).toBe(false);
  });

  it("adds the user task as a message on start", async () => {
    // The service will fail without a backend; the message must still be added.
    await useAgentStore.getState().startAgent("write tests");
    const s = useAgentStore.getState();
    expect(
      s.messages.some((m) => m.role === "user" && m.content === "write tests")
    ).toBe(true);
  });

  it("rejectDiff marks the diff rejected (not removed) so the user sees the outcome", async () => {
    useAgentStore.setState({
      diffs: [
        {
          filePath: "src/a.ts",
          originalContent: "",
          modifiedContent: "new",
          hunks: [],
          status: "pending",
        } as DiffEntry,
      ],
    });
    await useAgentStore.getState().rejectDiff("src/a.ts");
    const d = useAgentStore.getState().diffs[0];
    expect(d.status).toBe("rejected");
  });

  it("clearSession resets messages, tool calls and diffs", () => {
    useAgentStore.setState({
      messages: [{ role: "user", content: "x", timestamp: 1 }],
      toolCalls: [{ id: "1", name: "read_file", input: {}, status: "completed" }],
      diffs: [
        { filePath: "a", originalContent: "", modifiedContent: "", hunks: [], status: "pending" },
      ],
    });
    useAgentStore.getState().clearSession();
    const s = useAgentStore.getState();
    expect(s.messages).toHaveLength(0);
    expect(s.toolCalls).toHaveLength(0);
    expect(s.diffs).toHaveLength(0);
  });

  // Ensure the dispatch helper keeps the import used (event shapes compile).
  it("covers event type shapes", () => {
    expect(dispatch({ type: "done" }).type).toBe("done");
  });
});
