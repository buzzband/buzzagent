/**
 * UI zoom for the whole app.
 *
 * WebKitGTK on Linux does not give the page Ctrl+wheel zoom or working
 * Ctrl+Plus/Minus out of the box, so the app owns the feature: the store keeps
 * the user's level (persisted to localStorage), App.tsx applies it on boot and
 * wires the keyboard/pointer shortcuts.
 *
 * The level is an index into `ZOOM_LEVELS` (defaults 0.25×…5.0×); 1.0× is
 * `DEFAULT_ZOOM_INDEX` and also what Ctrl+0 snaps back to.
 */

export const ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5,
  3.0, 4.0, 5.0,
] as const;

export const DEFAULT_ZOOM_INDEX = ZOOM_LEVELS.indexOf(1.0);

const STORAGE_KEY = "buzzagent.zoom";

export function clampZoomIndex(index: number): number {
  return Math.max(0, Math.min(ZOOM_LEVELS.length - 1, Math.round(index)));
}

/** Read the persisted level; invalid/missing data falls back to 100%. */
export function loadZoomIndex(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_ZOOM_INDEX;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_ZOOM_INDEX;
    return clampZoomIndex(parsed);
  } catch {
    return DEFAULT_ZOOM_INDEX;
  }
}

export function saveZoomIndex(index: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampZoomIndex(index)));
  } catch {
    // Private mode / storage disabled: zoom simply does not persist.
  }
}

/** Apply a WebKit zoom factor. Returns false when the API is unavailable. */
export async function applyZoom(factor: number): Promise<boolean> {
  try {
    // In Tauri v2 zoom is a webview-level API (the window itself has none).
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(factor);
    return true;
  } catch {
    return false;
  }
}

/** One step in/out from the current index, clamped to the table bounds. */
export function stepZoomIndex(current: number, direction: 1 | -1): number {
  return clampZoomIndex(current + direction);
}

/**
 * Resolve a keyboard/wheel event into a zoom action.
 *
 * Recognises Ctrl+= / Ctrl++ (zoom in), Ctrl+- (out), Ctrl+0 (reset) and
 * Ctrl+wheel. Returns `null` when the event is not a zoom gesture, so the
 * caller can leave it to the page.
 */
export function zoomActionFromEvent(event: {
  ctrlKey: boolean;
  metaKey?: boolean;
  key?: string;
  deltaY?: number;
}): "in" | "out" | "reset" | null {
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier) return null;

  if (typeof event.deltaY === "number" && event.deltaY !== 0) {
    return event.deltaY < 0 ? "in" : "out";
  }
  if (event.key === undefined) return null;

  switch (event.key) {
    case "+":
    case "=":
      return "in";
    case "-":
    case "_":
      return "out";
    case "0":
      return "reset";
    default:
      return null;
  }
}
