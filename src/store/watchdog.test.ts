import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useApp } from "./app";

describe("turn watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    useApp.setState({ busy: false, sessionId: null, client: null, messages: [] });
  });

  it("recovers a turn whose SSE events never arrive", async () => {
    const messages = [
      {
        info: { id: "msg_a", sessionID: "ses_w", role: "assistant" as const },
        parts: [{ id: "p1", type: "text" as const, text: "done answer" }],
      },
    ];
    const client = {
      messages: vi.fn().mockResolvedValue(messages),
    };
    useApp.setState({
      busy: true,
      sessionId: "ses_w",
      client: client as never,
      messages: [],
      turnStatus: { type: "busy", since: Date.now() - 60_000 },
      queue: [],
    });

    // The store marks SSE alive on send; simulate that long-past moment.
    // Trigger the internal watchdog by running timers: it ticks every 5s.
    // We cannot reach the module-private timer, so drive it via an event-less
    // wait: instead call __handleEvent to mark alive is the OPPOSITE path...
    // The public seam: busy+stale is handled internally; emulate by advancing
    // time after send-like state. Since lastSseEventAt is module-private and
    // set by events, we instead verify the recovery logic via two events:
    // 1) an event arrives (marks alive), 2) then silence + busy -> recovery.
    useApp.getState().__handleEvent({
      type: "session.status",
      properties: { sessionID: "ses_w", status: { type: "busy" } },
    } as never);

    // No further events; advance past the stale window (20s) plus ticks.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(client.messages).toHaveBeenCalledWith("ses_w");
    expect(useApp.getState().busy).toBe(false);
    expect(useApp.getState().messages).toEqual(messages);
  });
});
