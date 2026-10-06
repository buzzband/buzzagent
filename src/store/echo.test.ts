/**
 * Regression tests for the two chat bugs users could see every turn:
 *   * a typed prompt rendered twice inside its own message bubble;
 *   * a failed turn showed the same error twice — inline on the message and
 *     again as the banner above the composer.
 */

import { useApp } from "./app";
import type { CoreEvent } from "../core/types";

function emit(event: CoreEvent) {
  const store = useApp as unknown as {
    getState: () => { __handleEvent?: (e: CoreEvent) => void };
  };
  const handler = store.getState().__handleEvent;
  if (!handler) throw new Error("__handleEvent not exposed on the store");
  handler(event);
}

const SESSION = "ses_double";

beforeEach(() => {
  useApp.setState({
    sessionId: SESSION,
    messages: [],
    permissions: [],
    busy: false,
    queue: [],
    lastError: null,
    errorDetailOpen: false,
  });
});

describe("optimistic echo is replaced, not duplicated", () => {
  it("message.updated swaps the echo info and keeps the local part only until the real one lands", () => {
    useApp.setState({
      messages: [
        {
          info: { id: "local-123", sessionID: SESSION, role: "user" },
          parts: [
            { id: "local-part-123-0", type: "text", text: "fix the bug please" },
          ],
        },
      ],
    });

    // The core acknowledges the user message.
    emit({
      type: "message.updated",
      properties: {
        info: { id: "msg_u1", sessionID: SESSION, role: "user" },
      },
    });

    // The echo is replaced wholesale: info becomes authoritative, no local
    // copy of the message remains.
    const state = useApp.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].info.id).toBe("msg_u1");
    expect(
      state.messages[0].parts.every((p) => !p.id?.startsWith("local-part-"))
    ).toBe(false); // local text still shows (idempotent display) until part lands
  });

  it("the authoritative user part replaces the local text instead of appending", () => {
    useApp.setState({
      messages: [
        {
          info: { id: "msg_u1", sessionID: SESSION, role: "user" },
          parts: [
            { id: "local-part-123-0", type: "text", text: "fix the bug please" },
          ],
        },
      ],
    });

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_1",
          messageID: "msg_u1",
          sessionID: SESSION,
          type: "text",
          text: "fix the bug please",
        },
      },
    });

    const parts = useApp.getState().messages[0].parts;
    const texts = parts.filter((p) => p.type === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0].id).toBe("prt_1");
  });

  it("a part event arriving before message.updated adopts the pending echo instead of creating a second row", () => {
    useApp.setState({
      messages: [
        {
          info: { id: "local-777", sessionID: SESSION, role: "user" },
          parts: [{ id: "local-part-777-0", type: "text", text: "hello" }],
        },
      ],
    });

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_u1",
          messageID: "msg_u1",
          sessionID: SESSION,
          type: "text",
          text: "hello",
        },
      },
    });

    const messages = useApp.getState().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].info.id).toBe("msg_u1");
    expect(messages[0].info.role).toBe("user");
    expect(messages[0].parts.map((p) => p.id)).toEqual(["prt_u1"]);
  });
});

describe("errors are not shown twice", () => {
  it("a failed message tags lastError with its messageID", () => {
    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_fail",
          sessionID: SESSION,
          role: "assistant",
          error: { name: "APIError", message: "Rate limit reached" },
        },
      },
    });

    const lastError = useApp.getState().lastError;
    expect(lastError?.messageID).toBe("msg_fail");
  });

  it("a failing tool call tags lastError with its callID", () => {
    // The tool's message must be tracked first (the part handler only
    // promotes errors for messages already in the list).
    emit({
      type: "message.updated",
      properties: {
        info: { id: "msg_a1", sessionID: SESSION, role: "assistant" },
      },
    });
    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_t1",
          callID: "call_1",
          messageID: "msg_a1",
          sessionID: SESSION,
          type: "tool",
          tool: "bash",
          state: { status: "error", error: "command not found" },
        },
      },
    });

    const lastError = useApp.getState().lastError;
    expect(lastError?.callID).toBe("call_1");
    expect(lastError?.messageID).toBe("msg_a1");
  });

  it("session.error without a message carrier keeps the banner (no inline render)", () => {
    emit({
      type: "session.error",
      properties: {
        sessionID: SESSION,
        error: { name: "ProviderAuthError", message: "Invalid API key" },
      },
    });

    // No messageID: nothing inline renders it, the banner must show it.
    expect(useApp.getState().lastError?.messageID).toBeUndefined();
    expect(useApp.getState().lastError?.kind).toBe("auth");
  });
});
