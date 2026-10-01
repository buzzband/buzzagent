/**
 * Classification of webview-level connection failures.
 *
 * WebKit reports a fetch that never reached the server as "TypeError: Load
 * failed" (Chromium: "Failed to fetch"). These must be classified as network
 * errors — the startup SSE retry heals them, and the UI dismisses network
 * errors on the next successful connect. Misclassifying them as provider
 * errors used to leave a false "Provider error" card on screen.
 */

import { describe, expect, it } from "vitest";
import { normalizeError } from "./errors";

describe("webview connection wording", () => {
  it("classifies WebKit 'Load failed' as a network error", () => {
    const error = normalizeError(new TypeError("Load failed"));
    expect(error.kind).toBe("network");
    expect(error.source).toBe("network");
  });

  it("classifies Chromium 'Failed to fetch' as a network error", () => {
    const error = normalizeError(new TypeError("Failed to fetch"));
    expect(error.kind).toBe("network");
    expect(error.source).toBe("network");
  });
});
