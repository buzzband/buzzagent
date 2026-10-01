import { describe, expect, it } from "vitest";
import { contextPercent, fmtCompact, sessionUsage } from "./sessionUsage";

const m = (tokens?: unknown, cost?: number) => ({
  info: { tokens: tokens as never, cost },
});

describe("sessionUsage", () => {
  it("sums tokens and cost across messages", () => {
    const totals = sessionUsage([
      m({ input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } }, 0.01),
      m({ input: 50, output: 10, reasoning: 0, cache: { read: 5, write: 0 } }, 0.005),
    ]);
    expect(totals.input).toBe(150);
    expect(totals.output).toBe(30);
    expect(totals.reasoning).toBe(5);
    expect(totals.cacheRead).toBe(35);
    expect(totals.cacheWrite).toBe(10);
    expect(totals.cost).toBeCloseTo(0.015, 6);
  });

  it("tolerates missing tokens and cost", () => {
    const totals = sessionUsage([m(undefined), {}, m(undefined, 0.25)]);
    expect(totals.input).toBe(0);
    expect(totals.cost).toBeCloseTo(0.25, 6);
  });

  it("returns zeros for an empty session", () => {
    expect(sessionUsage([]).cost).toBe(0);
    expect(sessionUsage([]).input).toBe(0);
  });
});

describe("fmtCompact", () => {
  it("formats thousands and millions", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(1200)).toBe("1.2k");
    expect(fmtCompact(3_400_000)).toBe("3.4M");
  });
});

describe("contextPercent", () => {
  const usage = { input: 400, output: 0, reasoning: 0, cacheRead: 100, cacheWrite: 0, cost: 0 };

  it("computes input + cache-read against the limit", () => {
    expect(contextPercent(usage, 1000)).toBe(50);
  });

  it("caps at 100", () => {
    expect(contextPercent(usage, 200)).toBe(100);
  });

  it("returns null without a known limit", () => {
    expect(contextPercent(usage, null)).toBeNull();
    expect(contextPercent(usage, 0)).toBeNull();
  });
});
