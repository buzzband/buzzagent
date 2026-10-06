import { afterEach, describe, expect, it } from "vitest";
import {
  AREA_SIZE_MIN,
  AREA_SIZES_KEY,
  DEFAULT_AREA_SIZES,
  clampAreaSize,
  loadAreaSizes,
} from "./layout";

const VP = { width: 1920, height: 1080 };
const VISIBLE = { left: true, right: true, top: true, bottom: true };

describe("clampAreaSize", () => {
  afterEach(() => {
    localStorage.removeItem(AREA_SIZES_KEY);
  });

  it("allows a sidebar far beyond the old 720px cap", () => {
    // The reported bug: dragging stopped around 40% of the window because
    // AREA_SIZE_MAX was a fixed 720 px. A 1200 px sidebar must be allowed.
    expect(clampAreaSize("left", 1200, DEFAULT_AREA_SIZES, VP, VISIBLE)).toBe(1200);
  });

  it("stops only where the sibling and the middle column hit their minimums", () => {
    // Right sidebar keeps its current 320 px; the center keeps MIN_CENTER.
    expect(clampAreaSize("left", 5000, DEFAULT_AREA_SIZES, VP, VISIBLE)).toBe(
      1920 - DEFAULT_AREA_SIZES.right - 160 - 10
    );
  });

  it("reserves the sibling's current size, not just its minimum", () => {
    const sizes = { ...DEFAULT_AREA_SIZES, right: 600 };
    expect(clampAreaSize("left", 5000, sizes, VP, VISIBLE)).toBe(1920 - 600 - 160 - 10);
  });

  it("lets an area use the space of a hidden sibling", () => {
    expect(clampAreaSize("left", 1700, DEFAULT_AREA_SIZES, VP, { ...VISIBLE, right: false })).toBe(
      1700
    );
  });

  it("never goes below the minimum", () => {
    expect(clampAreaSize("left", 1, DEFAULT_AREA_SIZES, VP, VISIBLE)).toBe(AREA_SIZE_MIN);
  });

  it("clamps vertical areas against the window height", () => {
    expect(clampAreaSize("top", 2000, DEFAULT_AREA_SIZES, VP, VISIBLE)).toBe(
      1080 - DEFAULT_AREA_SIZES.bottom - 160 - 10
    );
  });
});

describe("loadAreaSizes", () => {
  afterEach(() => {
    localStorage.removeItem(AREA_SIZES_KEY);
  });

  it("re-clamps persisted sizes to the current window", () => {
    localStorage.setItem(
      AREA_SIZES_KEY,
      JSON.stringify({ left: 5000, right: 320, top: 200, bottom: 220 })
    );
    const sizes = loadAreaSizes();
    expect(sizes.left).toBeLessThan(5000);
    expect(sizes.left).toBeGreaterThanOrEqual(AREA_SIZE_MIN);
  });

  it("keeps an ordinary persisted arrangement untouched", () => {
    localStorage.setItem(
      AREA_SIZES_KEY,
      JSON.stringify({ left: 280, right: 320, top: 200, bottom: 220 })
    );
    expect(loadAreaSizes()).toEqual(DEFAULT_AREA_SIZES);
  });
});
