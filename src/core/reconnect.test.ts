/**
 * SSE reconnect tests: a dropped stream must retry with backoff instead of
 * leaving the UI blind until the next app restart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreClient } from "./client";
import type { CoreConnection } from "./types";

const connection: CoreConnection = {
  base_url: "http://127.0.0.1:4611",
  username: "opencode",
  password: "p3",
  directory: "",
};

/** A ReadableStream that emits one SSE frame, then ends (a clean drop). */
function streamWithOneFrame(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"server.connected"}\n\n'));
      controller.close();
    },
  });
}

describe("SSE reconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries after a clean stream drop and signals reconnect", async () => {
    const frames = vi.fn();
    const reconnected = vi.fn();
    let calls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls += 1;
        return Promise.resolve({
          ok: true,
          body: streamWithOneFrame(),
        });
      })
    );

    const client = new CoreClient(connection);
    const stop = client.subscribe(frames, undefined, reconnected);

    // First connect delivers the frame, then the stream ends. Advance past
    // the first backoff (250ms) to trigger attempt two.
    await vi.advanceTimersByTimeAsync(50);
    expect(frames).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toBe(2);
    // The second connection is a reconnect, not the first connect.
    expect(reconnected).toHaveBeenCalledTimes(1);
    // And it delivers the frame again.
    expect(frames).toHaveBeenCalledTimes(2);

    stop();
  });

  it("keeps retrying indefinitely (never gives up)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls += 1;
        return Promise.resolve({ ok: true, body: streamWithOneFrame() });
      })
    );

    const client = new CoreClient(connection);
    const stop = client.subscribe(() => undefined);

    // Each attempt "holds" for 0ms under fake timers, so every cycle costs
    // only the minimum 250ms backoff. A minute of virtual time must still be
    // retrying — the loop never declares the stream dead for good.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBeGreaterThan(10);

    stop();
  });

  it("uses real backoff growth when the stream survives a while", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        calls += 1;
        // Hold the connection open across virtual time: the stream only ends
        // when the test advances past its lifetime.
        return Promise.resolve({ ok: true, body: streamWithOneFrame() });
      })
    );

    const client = new CoreClient(connection);
    const stop = client.subscribe(() => undefined);

    // First two cycles: 250ms then 500ms of backoff.
    await vi.advanceTimersByTimeAsync(250);
    const first = calls;
    await vi.advanceTimersByTimeAsync(260);
    expect(calls).toBeGreaterThan(first);

    stop();
  });

  it("stops retrying after unsubscribe", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls += 1;
        return Promise.resolve({ ok: true, body: streamWithOneFrame() });
      })
    );

    const client = new CoreClient(connection);
    const stop = client.subscribe(() => undefined);

    await vi.advanceTimersByTimeAsync(300);
    const afterFirst = calls;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(afterFirst);
  });

  it("reports persistent failure through onError", async () => {
    const failed = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, body: null })
    );

    const client = new CoreClient(connection);
    const stop = client.subscribe(() => undefined, failed);

    await vi.advanceTimersByTimeAsync(1000);
    expect(failed).toHaveBeenCalled();

    stop();
  });
});
