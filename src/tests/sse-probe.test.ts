/**
 * Regression tests for the cross-realm AbortSignal bug.
 *
 * jsdom hands out its own AbortSignal; Node's undici fetch (used by vitest's
 * global fetch) rejects it with `TypeError: Expected signal … to be an
 * instance of AbortSignal`. The client's browser SSE branch passed the
 * signal blindly, so every frame read failed and the stream retried
 * forever — the integration suite hung on "no events ever arrive".
 *
 *   BUZZ_TEST_CORE_URL=http://127.0.0.1:4615 BUZZ_TEST_CORE_PASSWORD=x \
 *   npx vitest run src/tests/sse-probe.test.ts
 */

const url = process.env.BUZZ_TEST_CORE_URL;
const password = process.env.BUZZ_TEST_CORE_PASSWORD;

describe.skipIf(!url)("sse probe", () => {
  it("receives frames from /event", { timeout: 20_000 }, async () => {
    const auth = "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
    console.log("fetch starting…");
    const r = await fetch(`${url}/event`, {
      headers: { Authorization: auth, Accept: "text/event-stream" },
    });
    console.log("status", r.status, "body?", r.body ? "stream" : "null");
    expect(r.ok).toBe(true);

    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let frames = 0;
    const reading = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = dec.decode(value);
        frames += text.split("data:").length - 1;
        if (frames > 0) console.log("frames so far:", frames);
      }
    })();

    // Create a session mid-stream so the core emits session.created.
    await new Promise((res) => setTimeout(res, 1200));
    const cr = await fetch(`${url}/session`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "vitest sse probe" }),
    });
    console.log("create status", cr.status);

    await new Promise((res) => setTimeout(res, 4000));
    console.log("final frames:", frames);
    expect(frames).toBeGreaterThan(0);
    await reader.cancel().catch(() => undefined);
    await reading.catch(() => undefined);
  });

  it("CoreClient.subscribe delivers events", { timeout: 25_000 }, async () => {
    const { CoreClient } = await import("../core/client");
    const client = new CoreClient({
      base_url: url!,
      username: "opencode",
      password: password!,
      directory: "",
    });
    const seen: string[] = [];
    const stop = client.subscribe((event) => {
      seen.push(event.type);
      console.log("event:", event.type);
    });
    const session = await client.createSession("vitest client probe");
    await new Promise((res) => setTimeout(res, 5000));
    stop();
    await client.deleteSession(session.id).catch(() => undefined);
    console.log("seen:", seen.join(","));
    expect(seen).toContain("server.connected");
  });
});
