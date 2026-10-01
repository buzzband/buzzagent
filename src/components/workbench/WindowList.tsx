import {
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  RotateCcw,
  Settings,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp, type AreaId } from "../../store/app";
import { AREA_TITLE, WINDOWS, WINDOW_ORDER } from "../../lib/layout";
import { t } from "../../lib/i18n";
import { WINDOW_DND_TYPE } from "./WindowContent";

const AREA_TOGGLES: { area: AreaId; icon: typeof PanelLeft; title: string }[] = [
  { area: "left", icon: PanelLeft, title: AREA_TITLE.left },
  { area: "right", icon: PanelRight, title: AREA_TITLE.right },
  { area: "top", icon: PanelTop, title: AREA_TITLE.top },
  { area: "bottom", icon: PanelBottom, title: AREA_TITLE.bottom },
];

/**
 * Top bar. The left half lists every available window — drag a chip into any area
 * (or click it to open) — and the right holds the four area toggle buttons. This
 * is the single place from which any window can be invoked or dragged anywhere.
 */
export function WindowList() {
  const { layout, openWindow, toggleArea, resetLayout, language, setSettingsOpen } = useApp(
    useShallow((s) => ({
      layout: s.layout,
      openWindow: s.openWindow,
      toggleArea: s.toggleArea,
      resetLayout: s.resetLayout,
      language: s.language,
      setSettingsOpen: s.setSettingsOpen,
    }))
  );

  return (
    <div className="flex h-9 w-full shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2">
      <span className="shrink-0 text-2xs font-semibold tracking-wide text-[var(--fg-secondary)]">
        BuzzAgent
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {WINDOW_ORDER.map((window) => {
          const meta = WINDOWS[window];
          const Icon = meta.icon;
          const docked = layout.windows[window] !== null;
          return (
            <button
              key={window}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(WINDOW_DND_TYPE, window);
                e.dataTransfer.setData("text/plain", window);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => openWindow(window)}
              title={
                docked
                  ? t(language, "topbar.showTab")
                  : t(language, "topbar.openTab")
              }
              className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-2xs transition-colors ${
                docked
                  ? "border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--fg-secondary)] hover:border-[var(--accent)] hover:text-[var(--fg-primary)]"
                  : "border-dashed border-[var(--border-default)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              }`}
            >
              <Icon size={12} className="shrink-0" />
              <span>{meta.title}</span>
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-[var(--border-subtle)] pl-2">
        {AREA_TOGGLES.map(({ area, icon: Icon, title }) => {
          const on = layout.areaVisible[area];
          return (
            <button
              key={area}
              type="button"
              onClick={() => toggleArea(area)}
              title={`${on ? t(language, "topbar.hide") : t(language, "topbar.show")} ${title.toLowerCase()}`}
              aria-pressed={on}
              className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                on
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
              }`}
            >
              <Icon size={14} />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => resetLayout()}
          title="Reset layout to defaults"
          className="flex size-7 items-center justify-center rounded-md text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
        >
          <RotateCcw size={13} />
        </button>
        {/* Always-visible program settings: one glanceable entry point for the
            user-level knobs (theme, language, telemetry, voice, providers). */}
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title={t(language, "settings.title")}
          aria-label={t(language, "settings.title")}
          className="ml-1 flex h-7 items-center gap-1.5 rounded-md bg-[var(--bg-raised)] px-2.5 text-2xs font-medium text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-active)] hover:text-[var(--fg-primary)]"
        >
          <Settings size={14} />
          <span className="hidden sm:inline">{t(language, "settings.title")}</span>
        </button>
      </div>
    </div>
  );
}
