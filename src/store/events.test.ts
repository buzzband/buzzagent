/**
 * Event-projection tests.
 *
 * Payloads here are copied from a live `opencode serve` capture, not invented.
 * They exist because the UI once hung on "working" forever: the core signalled
 * completion via `session.status` and streamed tokens via `message.part.delta`,
 * and the store handled neither.
 */

import { useApp } from "./app";
import type { CoreEvent } from "../core/types";

/** Reach the private event handler the SSE subscription feeds. */
function emit(event: CoreEvent) {
  const store = useApp as unknown as {
    getState: () => { __handleEvent?: (e: CoreEvent) => void };
  };
  const handler = store.getState().__handleEvent;
  if (!handler) throw new Error("__handleEvent not exposed on the store");
  handler(event);
}

const SESSION = "ses_test";

beforeEach(() => {
  useApp.setState({
    sessionId: SESSION,
    messages: [],
    permissions: [],
    busy: false,
    queue: [],
  });
});

describe("session.status", () => {
  it("clears busy when the core reports idle", () => {
    useApp.setState({ busy: true });

    emit({
      type: "session.status",
      properties: { sessionID: SESSION, status: { type: "idle" } },
    });

    expect(useApp.getState().busy).toBe(false);
  });

  it("sets busy when the core reports busy", () => {
    emit({
      type: "session.status",
      properties: { sessionID: SESSION, status: { type: "busy" } },
    });

    expect(useApp.getState().busy).toBe(true);
  });

  it("ignores status for a different session", () => {
    useApp.setState({ busy: true });

    emit({
      type: "session.status",
      properties: { sessionID: "ses_other", status: { type: "idle" } },
    });

    // Another session finishing must not unblock this one's composer.
    expect(useApp.getState().busy).toBe(true);
  });
});

describe("message.part.delta", () => {
  it("appends streamed tokens into a single part", () => {
    for (const delta of ["Mock ", "reply ", "here."]) {
      emit({
        type: "message.part.delta",
        properties: {
          sessionID: SESSION,
          messageID: "msg_1",
          partID: "prt_1",
          field: "text",
          delta,
        },
      });
    }

    const messages = useApp.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].text).toBe("Mock reply here.");
  });

  it("routes reasoning deltas to a reasoning part", () => {
    emit({
      type: "message.part.delta",
      properties: {
        sessionID: SESSION,
        messageID: "msg_2",
        partID: "prt_2",
        field: "reasoning",
        delta: "thinking…",
      },
    });

    expect(useApp.getState().messages[0].parts[0].type).toBe("reasoning");
  });

  it("ignores deltas from other sessions", () => {
    emit({
      type: "message.part.delta",
      properties: {
        sessionID: "ses_other",
        messageID: "msg_3",
        partID: "prt_3",
        field: "text",
        delta: "leak",
      },
    });

    expect(useApp.getState().messages).toHaveLength(0);
  });
});

describe("permission events", () => {
  it("surfaces a v2 request using action and resources", () => {
    emit({
      type: "permission.v2.asked",
      properties: {
        id: "per_1",
        sessionID: SESSION,
        action: "bash",
        resources: ["rm -rf build"],
        source: { type: "tool", messageID: "msg_9", callID: "call_9" },
      },
    });

    const [request] = useApp.getState().permissions;
    expect(request.id).toBe("per_1");
    // v2 has no `tool` field; the action must still produce a usable title.
    expect(request.title).toBe("bash");
    expect(request.callID).toBe("call_9");
    expect(request.metadata?.resources).toBe("rm -rf build");
  });

  it("still accepts the legacy asked shape", () => {
    emit({
      type: "permission.asked",
      properties: {
        id: "per_2",
        sessionID: SESSION,
        permission: "edit",
        patterns: ["src/**"],
      },
    });

    expect(useApp.getState().permissions[0].title).toBe("edit");
  });

  it("removes a request on v2 reply keyed by requestID", () => {
    useApp.setState({
      permissions: [{ id: "per_3", sessionID: SESSION, title: "bash" }],
    });

    emit({
      type: "permission.v2.replied",
      properties: { sessionID: SESSION, requestID: "per_3", reply: "once" },
    });

    expect(useApp.getState().permissions).toHaveLength(0);
  });

  it("does not duplicate the same request", () => {
    const payload = {
      type: "permission.asked",
      properties: { id: "per_4", sessionID: SESSION, permission: "bash" },
    };
    emit(payload);
    emit(payload);

    expect(useApp.getState().permissions).toHaveLength(1);
  });
});

describe("session.error", () => {
  it("clears busy and surfaces the failure", () => {
    useApp.setState({ busy: true, model: { providerID: "opencode", modelID: "grok-code" } });

    emit({
      type: "session.error",
      properties: {
        sessionID: SESSION,
        error: { name: "UnknownError", message: "Unexpected server error." },
      },
    });

    expect(useApp.getState().busy).toBe(false);
    expect(useApp.getState().lastError?.message).toContain("Unexpected server error");
    // An unrelated failure must NOT clear the model selection.
    expect(useApp.getState().model).toEqual({
      providerID: "opencode",
      modelID: "grok-code",
    });
  });

  it("drops the dead model on ModelNotFoundError so a valid one is picked", () => {
    useApp.setState({ busy: true, model: { providerID: "opencode", modelID: "grok-code" } });

    emit({
      type: "session.error",
      properties: {
        sessionID: SESSION,
        error: {
          name: "ProviderModelNotFoundError",
          message: "Model not found: opencode/grok-code. Did you mean: gpt-5.1-codex?",
        },
      },
    });

    expect(useApp.getState().busy).toBe(false);
    expect(useApp.getState().model).toBeNull();
  });
});

describe("session.error payload shapes", () => {
  it("extracts the message from the core's error.data wrapper", () => {
    useApp.setState({ busy: true });

    emit({
      type: "session.error",
      properties: {
        sessionID: SESSION,
        // Verified live: the core wraps the provider failure in `data`.
        error: {
          name: "UnknownError",
          data: { message: "AI_APICallError: Forbidden" },
        },
      },
    });

    const err = useApp.getState().lastError;
    expect(err?.message).toContain("Forbidden");
    expect(useApp.getState().busy).toBe(false);
  });
});

describe("session.status retry", () => {
  it("stores the retry reason so the UI can show WHY nothing streams", () => {
    useApp.setState({ busy: true, turnStatus: null });

    // Verified live: the core schedules a retry when the provider hangs.
    emit({
      type: "session.status",
      properties: {
        sessionID: SESSION,
        status: {
          type: "retry",
          attempt: 2,
          message: "Provider response headers timed out after 300000ms",
          next: 1790687722561,
        },
      },
    });

    const state = useApp.getState();
    expect(state.busy).toBe(true);
    expect(state.turnStatus?.type).toBe("retry");
    expect(state.turnStatus?.attempt).toBe(2);
    expect(state.turnStatus?.message).toContain("timed out");
  });

  it("clears turnStatus on idle", () => {
    useApp.setState({
      busy: true,
      turnStatus: { type: "busy", since: 1 },
    });

    emit({
      type: "session.status",
      properties: { sessionID: SESSION, status: { type: "idle" } },
    });

    const state = useApp.getState();
    expect(state.busy).toBe(false);
    expect(state.turnStatus).toBeNull();
  });

  it("turnStatus covers plain busy with a start time", () => {
    useApp.setState({ busy: false, turnStatus: null });

    emit({
      type: "session.status",
      properties: { sessionID: SESSION, status: { type: "busy" } },
    });

    const state = useApp.getState();
    expect(state.busy).toBe(true);
    expect(state.turnStatus?.type).toBe("busy");
    expect(state.turnStatus?.since).toBeGreaterThan(0);
  });
});
