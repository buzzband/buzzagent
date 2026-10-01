import { useState } from "react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp, type AreaId, type WindowId } from "../../store/app";
import { WINDOWS, WINDOW_ORDER } from "../../lib/layout";
import { t } from "../../lib/i18n";
import { WindowContent, WINDOW_DND_TYPE, windowFromDrop } from "./WindowContent";

const AREA_CLASS: Record<AreaId, string> = {
  left: "flex h-full w-full flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]",
  right: "flex h-full w-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-surface)]",
  top: "flex h-full w-full flex-col border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]",
  bottom: "flex h-full w-full flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]",
  center: "flex h-full w-full flex-col bg-[var(--bg-base)]",
};

/** One dockable area: tab strip + active window content + drop target */
export function Area({ area }: { area: AreaId }) {
  const { layout, setActiveWindow, closeWindow, moveWindow, openWindow } = useApp(
    useShallow((s) => ({
      layout: s.layout,
      setActiveWindow: s.setActiveWindow,
      closeWindow: s.closeWindow,
      moveWindow: s.moveWindow,
      openWindow: s.openWindow,
    }))
  );
  const [dragOver, setDragOver] = useState(false);

  // If area is toggled off, we render nothing — parent flex handles sizing.
  const visible = area === "center" ? true : layout.areaVisible[area];
  if (!visible && area !== "center") return null;

  const tabs = WINDOW_ORDER.filter((w) => layout.windows[w] === area);
  // Fall back to the first tab of this area if the remembered active one is
  // stale (closed or moved elsewhere).
  const active =
    layout.active[area] && layout.windows[layout.active[area] as WindowId] === area
      ? layout.active[area]
      : (tabs[0] ?? null);

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData(WINDOW_DND_TYPE, id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = windowFromDrop(e);
    if (id) moveWindow(id, area);
  };

  return (
    <div
      className={`${AREA_CLASS[area]} ${dragOver ? "ring-2 ring-inset ring-[var(--accent)]" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {/* Tab strip */}
      {tabs.length > 0 && (
        <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {tabs.map((window) => {
            const meta = WINDOWS[window];
            const Icon = meta.icon;
            const isActive = window === active;
            return (
              <div
                key={window}
                draggable
                onDragStart={(e) => onDragStart(e, window)}
                className={`group/tab flex max-w-44 shrink-0 items-center gap-1.5 border-r border-[var(--border-subtle)] px-2.5 text-2xs transition-colors ${
                  isActive
                    ? "bg-[var(--bg-base)] text-[var(--fg-primary)]"
                    : "text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-secondary)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveWindow(window)}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <Icon size={12} className="shrink-0" />
                  <span className="truncate">{meta.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeWindow(window)}
                  title="Close window"
                  aria-label={`Close ${meta.title}`}
                  className="flex size-4 shrink-0 items-center justify-center rounded-xs text-[var(--fg-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-active)] hover:text-[var(--fg-primary)] focus-visible:opacity-100 group-hover/tab:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="relative min-h-0 flex-1">
        {active && layout.windows[active] === area ? (
          <WindowContent window={active} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center text-xs text-[var(--fg-muted)]">
            <span>
              {tabs.length === 0
                ? t(useApp.getState().language, "area.emptyDrop")
                : t(useApp.getState().language, "area.emptySelect")}
            </span>
            <button
              type="button"
              onClick={() => {
                const first = WINDOW_ORDER.find(
                  (w) => !layout.windows[w] || layout.windows[w] === null
                );
                if (first) openWindow(first);
              }}
              className="rounded-md border border-dashed border-[var(--border-default)] px-2.5 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {t(useApp.getState().language, "area.openWindow")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
