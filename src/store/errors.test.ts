/**
 * Error-surfacing tests: provider failures, dropped connections and core
 * errors must all land in `lastError` classified, instead of being swallowed.
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

const SESSION = "ses_err";

beforeEach(() => {
  useApp.setState({
    sessionId: SESSION,
    messages: [],
    permissions: [],
    busy: true,
    queue: [],
    lastError: null,
    errorDetailOpen: false,
  });
});

describe("error projection", () => {
  it("captures provider auth errors from session.error and clears busy", () => {
    emit({
      type: "session.error",
      properties: {
        sessionID: SESSION,
        error: {
          name: "ProviderAuthError",
          message: "Invalid API key provided for provider anthropic.",
          data: { providerID: "anthropic", statusCode: 401 },
        },
      },
    });

    const state = useApp.getState();
    expect(state.busy).toBe(false);
    expect(state.lastError).not.toBeNull();
    expect(state.lastError?.kind).toBe("auth");
    expect(state.lastError?.status).toBe(401);
    expect(state.lastError?.providerID).toBe("anthropic");
    expect(state.lastError?.message).toContain("Invalid API key");
  });

  it("captures quota exhaustion as a balance error", () => {
    emit({
      type: "session.error",
      properties: {
        sessionID: SESSION,
        error: {
          name: "Error",
          message:
            "You exceeded your current quota, please check your plan and billing details.",
        },
      },
    });

    expect(useApp.getState().lastError?.kind).toBe("balance");
  });

  it("captures assistant message errors (info.error shape)", () => {
    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_err_1",
          sessionID: SESSION,
          role: "assistant",
          modelID: "gpt-4o",
          providerID: "openai",
          error: { name: "APIError", message: "Rate limit reached for requests." },
        },
      },
    });

    const e = useApp.getState().lastError;
    expect(e?.kind).toBe("rate-limit");
    expect(e?.providerID).toBe("openai");
    expect(e?.modelID).toBe("gpt-4o");
  });

  it("clearError resets the banner", () => {
    emit({
      type: "session.error",
      properties: { sessionID: SESSION, error: { message: "boom" } },
    });
    expect(useApp.getState().lastError).not.toBeNull();

    useApp.getState().clearError();
    expect(useApp.getState().lastError).toBeNull();
  });

  it("toggles the detail section", () => {
    expect(useApp.getState().errorDetailOpen).toBe(false);
    useApp.getState().toggleErrorDetail();
    expect(useApp.getState().errorDetailOpen).toBe(true);
    useApp.getState().toggleErrorDetail();
    expect(useApp.getState().errorDetailOpen).toBe(false);
  });

  it("does not capture errors from other sessions into the current view", () => {
    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_other",
          sessionID: "ses_other",
          role: "assistant",
          error: { name: "APIError", message: "unrelated session failure" },
        },
      },
    });

    expect(useApp.getState().lastError).toBeNull();
  });

  it("captures a failed tool call reported by the core", () => {
    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_tool_1",
          messageID: "msg_t1",
          sessionID: SESSION,
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: {
            status: "error",
            error: "Command failed with exit code 1: cat missing.txt",
          },
        },
      },
    });

    const e = useApp.getState().lastError;
    expect(e).not.toBeNull();
    expect(e?.message).toContain("exit code 1");
    expect(e?.sessionID).toBe(SESSION);
  });

  it("surfaces errors from unknown event types (catch-all)", () => {
    emit({
      type: "provider.some.future.error",
      properties: {
        sessionID: SESSION,
        error: { name: "FutureError", message: "unknown failure shape" },
      },
    });

    const e = useApp.getState().lastError;
    expect(e).not.toBeNull();
    expect(e?.message).toBe("unknown failure shape");
  });

  it("does not spam lastError from tool stderr that is not an error status", () => {
    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_tool_2",
          messageID: "msg_t2",
          sessionID: SESSION,
          type: "tool",
          tool: "read",
          state: { status: "completed", output: "file contents" },
        },
      },
    });

    expect(useApp.getState().lastError).toBeNull();
  });
});
