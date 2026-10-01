import {
  DEFAULT_ZOOM_INDEX,
  ZOOM_LEVELS,
  clampZoomIndex,
  loadZoomIndex,
  saveZoomIndex,
  stepZoomIndex,
  zoomActionFromEvent,
} from "./zoom";

describe("zoom", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 100% and clamps to table bounds", () => {
    expect(DEFAULT_ZOOM_INDEX).toBe(ZOOM_LEVELS.indexOf(1.0));
    expect(clampZoomIndex(-5)).toBe(0);
    expect(clampZoomIndex(999)).toBe(ZOOM_LEVELS.length - 1);
    expect(clampZoomIndex(2.6)).toBe(3);
  });

  it("persists and restores the index, discarding garbage", () => {
    expect(loadZoomIndex()).toBe(DEFAULT_ZOOM_INDEX);
    saveZoomIndex(10);
    expect(loadZoomIndex()).toBe(10);
    localStorage.setItem("buzzagent.zoom", "not-a-number");
    expect(loadZoomIndex()).toBe(DEFAULT_ZOOM_INDEX);
    localStorage.setItem("buzzagent.zoom", "9999");
    expect(loadZoomIndex()).toBe(ZOOM_LEVELS.length - 1);
  });

  it("steps in/out without leaving the table", () => {
    expect(stepZoomIndex(0, -1)).toBe(0);
    expect(stepZoomIndex(0, 1)).toBe(1);
    expect(stepZoomIndex(ZOOM_LEVELS.length - 1, 1)).toBe(ZOOM_LEVELS.length - 1);
    expect(stepZoomIndex(DEFAULT_ZOOM_INDEX, -1)).toBe(DEFAULT_ZOOM_INDEX - 1);
  });

  it("maps Ctrl/⌘ plus, minus, zero and wheel to actions", () => {
    expect(zoomActionFromEvent({ ctrlKey: true, key: "+" })).toBe("in");
    expect(zoomActionFromEvent({ ctrlKey: true, key: "=" })).toBe("in");
    expect(zoomActionFromEvent({ ctrlKey: true, key: "-" })).toBe("out");
    expect(zoomActionFromEvent({ ctrlKey: true, key: "_" })).toBe("out");
    expect(zoomActionFromEvent({ ctrlKey: true, key: "0" })).toBe("reset");
    expect(zoomActionFromEvent({ ctrlKey: false, metaKey: true, key: "=" })).toBe("in");
    expect(zoomActionFromEvent({ ctrlKey: true, deltaY: -120 })).toBe("in");
    expect(zoomActionFromEvent({ ctrlKey: true, deltaY: 120 })).toBe("out");
  });

  it("ignores plain keys and non-zoom chords", () => {
    expect(zoomActionFromEvent({ ctrlKey: false, key: "+" })).toBeNull();
    expect(zoomActionFromEvent({ ctrlKey: true, key: "a" })).toBeNull();
    expect(zoomActionFromEvent({ ctrlKey: true, key: "Escape" })).toBeNull();
    expect(zoomActionFromEvent({ ctrlKey: true })).toBeNull();
  });
});
