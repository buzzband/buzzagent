import { useCallback, useRef } from "react";
import { PermissionInbox } from "../chat/PermissionInbox";
import { WindowList } from "./WindowList";
import { Area } from "./Area";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";

/**
 * Drag handle between two areas.
 *
 * Pure pointer-event resize: on pointerdown we capture the start coordinate and
 * the current size of the area being dragged; every pointermove updates the
 * store, every layout change re-renders with the new pixel size. No layout
 * library, no context that breaks, no ghost panels — hidden areas are simply
 * not rendered, so the remaining ones expand honestly.
 */
function ResizeHandle({
  orientation,
  area,
}: {
  orientation: "horizontal" | "vertical";
  area: "left" | "right" | "top" | "bottom";
}) {
  const startRef = useRef(0);
  const baseSizeRef = useRef(0);
  const setAreaSize = useApp((s) => s.setAreaSize);
  const persistAreaSizes = useApp((s) => s.persistAreaSizes);
  const getSize = useApp((s) => s.areaSizes[area]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startRef.current = orientation === "horizontal" ? e.clientX : e.clientY;
      baseSizeRef.current = getSize;

      // Freeze text selection and cross-panel hover effects while dragging so
      // the layout visually "sticks" under the cursor instead of drifting.
      document.body.style.userSelect = "none";
      document.body.style.cursor = orientation === "horizontal" ? "col-resize" : "row-resize";

      const move = (ev: PointerEvent) => {
        const pos = orientation === "horizontal" ? ev.clientX : ev.clientY;
        // Dragging the handle toward the screen edge always grows the area:
        // left/top edges grow when dragging away from them, right/bottom edges
        // grow when dragging toward them. `edge` encodes that sign once.
        const edge = area === "left" || area === "top" ? 1 : -1;
        setAreaSize(area, baseSizeRef.current + edge * (pos - startRef.current));
      };
      const up = () => {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        persistAreaSizes();
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [orientation, area, getSize, setAreaSize, persistAreaSizes]
  );

  return (
    <div
      onPointerDown={onPointerDown}
      className={`z-10 shrink-0 touch-none select-none bg-[var(--border-default)] transition-colors hover:bg-[var(--accent)] active:bg-[var(--accent)] ${
        orientation === "horizontal"
          ? "w-[3px] cursor-col-resize"
          : "h-[3px] cursor-row-resize"
      }`}
      role="separator"
      aria-orientation={orientation}
      aria-label={`Resize ${area} area`}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8;
        // Arrow keys mirror the mouse: "toward the area" shrinks it.
        const toward =
          area === "left"
            ? e.key === "ArrowLeft"
            : area === "right"
              ? e.key === "ArrowRight"
              : area === "top"
                ? e.key === "ArrowUp"
                : e.key === "ArrowDown";
        const away =
          area === "left"
            ? e.key === "ArrowRight"
            : area === "right"
              ? e.key === "ArrowLeft"
              : area === "top"
                ? e.key === "ArrowDown"
                : e.key === "ArrowUp";
        if (!toward && !away) return;
        e.preventDefault();
        setAreaSize(area, getSize + (away ? step : -step));
      }}
    />
  );
}

/**
 * The dockable workbench.
 *
 * Pure flexbox grid, no layout library. The sidebars span the full height of
 * the workbench; only the middle column hosts the stacked top/center/bottom
 * areas:
 *
 * ```
 * ┌──────────┬───────────────────────────────┬──────────┐
 * │          │ top (middle column only)      │          │
 * │          ├───────────────────────────────┤          │
 * │ left     │ center (flex-1)               │ right    │
 * │ (full    │                               │ (full    │
 * │  height) ├───────────────────────────────┤  height) │
 * │          │ bottom (middle column only)   │          │
 * └──────────┴───────────────────────────────┴──────────┘
 * ```
 *
 * Hidden areas are not rendered at all — their flex space is reclaimed by the
 * remaining areas, so hiding a sidebar widens the middle column honestly.
 */
export function Workbench() {
  const { layout, areaSizes } = useApp(
    useShallow((s) => ({ layout: s.layout, areaSizes: s.areaSizes }))
  );
  const showTop = layout.areaVisible.top;
  const showLeft = layout.areaVisible.left;
  const showRight = layout.areaVisible.right;
  const showBottom = layout.areaVisible.bottom;

  return (
    <div className="relative flex h-full w-full min-h-0 min-w-0 flex-col bg-[var(--bg-base)]">
      <WindowList />

      <div className="flex min-h-0 w-full min-w-0 flex-1">
        {/* Left sidebar — full workbench height */}
        {showLeft && (
          <>
            <div style={{ width: areaSizes.left }} className="h-full min-h-0 min-w-0 shrink-0">
              <Area area="left" />
            </div>
            <ResizeHandle orientation="horizontal" area="left" />
          </>
        )}

        {/* Middle column: top / center / bottom */}
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          {showTop && (
            <>
              <div style={{ height: areaSizes.top }} className="min-h-0 shrink-0">
                <Area area="top" />
              </div>
              <ResizeHandle orientation="vertical" area="top" />
            </>
          )}

          <div className="min-h-0 min-w-0 flex-1">
            <Area area="center" />
          </div>

          {showBottom && (
            <>
              <ResizeHandle orientation="vertical" area="bottom" />
              <div style={{ height: areaSizes.bottom }} className="min-h-0 shrink-0">
                <Area area="bottom" />
              </div>
            </>
          )}
        </div>

        {/* Right sidebar — full workbench height */}
        {showRight && (
          <>
            <ResizeHandle orientation="horizontal" area="right" />
            <div style={{ width: areaSizes.right }} className="h-full min-h-0 min-w-0 shrink-0">
              <Area area="right" />
            </div>
          </>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-2xl">
          <PermissionInbox />
        </div>
      </div>
    </div>
  );
}
