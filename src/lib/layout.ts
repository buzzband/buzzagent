/**
 * Dockable window layout model.
 *
 * The workbench is a set of "windows" (chat, terminal, browser, explorer, …)
 * that can be dropped into five areas — left, right, top, bottom and the central
 * editor. Each area is a tabbed group. The whole arrangement is persisted so the
 * user's panel setup survives restarts.
 */

import {
  FileText,
  Files,
  GitCompare,
  GitFork,
  Globe,
  MessageSquare,
  Music,
  FolderOpen,
  Plug,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type AreaId = "left" | "right" | "top" | "bottom" | "center";
export type WindowId =
  | "chat"
  | "terminal"
  | "browser"
  | "files"
  | "projects"
  | "changes"
  | "worktrees"
  | "skills"
  | "mcp"
  | "music"
  | "editor";

export interface WindowMeta {
  id: WindowId;
  title: string;
  icon: LucideIcon;
}

export const WINDOWS: Record<WindowId, WindowMeta> = {
  chat: { id: "chat", title: "Chat", icon: MessageSquare },
  terminal: { id: "terminal", title: "Terminal", icon: Terminal },
  browser: { id: "browser", title: "Browser", icon: Globe },
  files: { id: "files", title: "Explorer", icon: Files },
  projects: { id: "projects", title: "Projects", icon: FolderOpen },
  changes: { id: "changes", title: "Changes", icon: GitCompare },
  worktrees: { id: "worktrees", title: "Worktrees", icon: GitFork },
  skills: { id: "skills", title: "Skills", icon: Wrench },
  mcp: { id: "mcp", title: "MCP", icon: Plug },
  music: { id: "music", title: "Music", icon: Music },
  editor: { id: "editor", title: "Editor", icon: FileText },
};

export const WINDOW_ORDER: WindowId[] = [
  "projects",
  "chat",
  "editor",
  "terminal",
  "browser",
  "files",
  "changes",
  "worktrees",
  "skills",
  "mcp",
  "music",
];

export const AREAS: AreaId[] = ["left", "right", "top", "bottom", "center"];

export const AREA_TITLE: Record<AreaId, string> = {
  left: "Left Sidebar",
  right: "Right Sidebar",
  top: "Top Panel",
  bottom: "Bottom Panel",
  center: "Editor",
};

export interface LayoutState {
  /** Where each window is docked (null = available, shown only in the top list). */
  windows: Record<WindowId, AreaId | null>;
  /** Visibility of each area. Center is always visible. */
  areaVisible: Record<AreaId, boolean>;
  /** Active (front) tab per area. */
  active: Record<AreaId, WindowId | null>;
}

export const DEFAULT_LAYOUT: LayoutState = {
  windows: {
    chat: "center",
    terminal: null,
    browser: null,
    files: "left",
    projects: "left",
    changes: "right",
    worktrees: null,
    skills: null,
    mcp: null,
    music: null,
    // Editor opens on demand: clicking a file in Explorer docks it here.
    editor: null,
  },
  areaVisible: {
    // A first-run screen with a single empty chat reads as "broken": the
    // default shows the project/session sidebar and the changes panel so the
    // app's shape is obvious before anything is configured.
    left: true,
    right: true,
    top: false,
    bottom: false,
    center: true,
  },
  active: {
    left: "projects",
    right: "changes",
    top: null,
    bottom: null,
    center: "chat",
  },
};

export const LAYOUT_KEY = "buzzagent.layout.v2";
/** Layouts stored before a release get migrated once, not silently kept. */
const LAYOUT_SEEN_KEY = "buzzagent.layout.seen.v4";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Coerce arbitrary parsed JSON into a valid LayoutState, falling back to defaults. */
function normalize(parsed: unknown): LayoutState {
  const layout = clone(DEFAULT_LAYOUT);
  if (!parsed || typeof parsed !== "object") return layout;
  const data = parsed as Record<string, Record<string, unknown>>;

  if (typeof data.windows === "object" && data.windows) {
    for (const id of WINDOW_ORDER) {
      const area = data.windows[id];
      if (area === null || (typeof area === "string" && AREAS.includes(area as AreaId))) {
        layout.windows[id] = area as AreaId | null;
      }
    }
  }
  if (typeof data.areaVisible === "object" && data.areaVisible) {
    for (const area of AREAS) {
      if (typeof data.areaVisible[area] === "boolean") {
        layout.areaVisible[area] = data.areaVisible[area] as boolean;
      }
    }
  }
  if (typeof data.active === "object" && data.active) {
    for (const area of AREAS) {
      const win = data.active[area];
      if (win === null || (typeof win === "string" && win in WINDOWS)) {
        layout.active[area] = (win as WindowId | null) ?? null;
      }
    }
  }

  // The center must always be visible and host at least the chat window.
  layout.areaVisible.center = true;
  if (!layout.windows.chat || layout.windows.chat === null) {
    layout.windows.chat = "center";
    layout.active.center = "chat";
  } else {
    const centerWins = WINDOW_ORDER.filter((w) => layout.windows[w] === "center");
    if (
      centerWins.length &&
      (!layout.active.center || layout.windows[layout.active.center] !== "center")
    ) {
      layout.active.center = centerWins[0];
    }
  }
  return layout;
}

export function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    // Users of an earlier build keep their arrangement, except when they have
    // never seen the new defaults: an all-panels-hidden start confused
    // newcomers (nothing on screen but an empty chat), so v3 re-seeds once.
    if (!raw || !localStorage.getItem(LAYOUT_SEEN_KEY)) {
      const fresh = clone(DEFAULT_LAYOUT);
      saveLayout(fresh);
      try {
        localStorage.setItem(LAYOUT_SEEN_KEY, "1");
      } catch {
        // Best-effort marker only.
      }
      return fresh;
    }
    return normalize(JSON.parse(raw));
  } catch {
    return clone(DEFAULT_LAYOUT);
  }
}

export function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Persistence is best-effort; an unavailable store must not break the UI.
  }
}

// -------------------------------------------------------------- area sizes

/**
 * Pixel sizes of the four resizable areas (center takes what is left).
 * Kept as plain numbers so dragging is a simple set(), with no layout-library
 * gymnastics — hiding an area means the parent flexbox simply stops
 * rendering it and everything else re-expands.
 */
export interface AreaSizes {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const DEFAULT_AREA_SIZES: AreaSizes = {
  left: 280,
  right: 320,
  top: 200,
  bottom: 220,
};

/** Smallest useful sidebar/panel size (px): tab strip + a sliver of content. */
export const AREA_SIZE_MIN = 64;
/**
 * The middle column (chat/editor) never collapses below this, so a drag is
 * free — "as much as the user wants" — but the app stays recoverable: the
 * handles never vanish and the center always keeps a usable sliver.
 */
export const MIN_CENTER = 160;
/** Handle widths + rounding slack reserved between areas sharing an axis. */
const HANDLE_RESERVE = 10;

/** Whether each resizable area is currently shown (center is always shown). */
export interface AreaVisibility {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export const AREA_SIZES_KEY = "buzzagent.area_sizes.v1";

/**
 * Clamp one area's size against its axis. The ceiling is *derived from the
 * viewport*, not fixed: the area may grow as far as the sibling area on that
 * axis currently occupies plus the smallest usable middle column. Dragging
 * can therefore never squeeze the center out of existence, but nothing else
 * limits how wide a sidebar may become (the old 720 px cap is gone).
 */
export function clampAreaSize(
  area: keyof AreaSizes,
  value: number,
  sizes: AreaSizes,
  viewport: { width: number; height: number },
  visible?: Partial<AreaVisibility>
): number {
  const n = Number.isFinite(value) ? Math.round(value) : AREA_SIZE_MIN;
  const horizontal = area === "left" || area === "right";
  const total = horizontal ? viewport.width : viewport.height;
  const other: keyof AreaSizes = horizontal
    ? area === "left"
      ? "right"
      : "left"
    : area === "top"
      ? "bottom"
      : "top";
  const otherVisible = visible ? visible[other] !== false : true;
  const reserved =
    MIN_CENTER +
    (otherVisible ? Math.max(AREA_SIZE_MIN, Math.round(sizes[other])) : 0) +
    HANDLE_RESERVE;
  const max = Math.max(AREA_SIZE_MIN + MIN_CENTER, total - reserved);
  return Math.min(max, Math.max(AREA_SIZE_MIN, n));
}

function rawSize(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function currentViewport(): { width: number; height: number } {
  return {
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? window.innerHeight : 800,
  };
}

export function loadAreaSizes(): AreaSizes {
  try {
    const raw = localStorage.getItem(AREA_SIZES_KEY);
    if (!raw) return { ...DEFAULT_AREA_SIZES };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const vp = currentViewport();
    const sizes: AreaSizes = {
      left: rawSize(parsed.left, DEFAULT_AREA_SIZES.left),
      right: rawSize(parsed.right, DEFAULT_AREA_SIZES.right),
      top: rawSize(parsed.top, DEFAULT_AREA_SIZES.top),
      bottom: rawSize(parsed.bottom, DEFAULT_AREA_SIZES.bottom),
    };
    // Re-clamp persisted sizes against the *current* window: an arrangement
    // saved on a larger screen must not overflow a smaller one. Left/right
    // first (they share the width axis), then top/bottom (height axis); each
    // clamp sees the previously clamped sibling.
    sizes.left = clampAreaSize("left", sizes.left, sizes, vp);
    sizes.right = clampAreaSize("right", sizes.right, sizes, vp);
    sizes.top = clampAreaSize("top", sizes.top, sizes, vp);
    sizes.bottom = clampAreaSize("bottom", sizes.bottom, sizes, vp);
    return sizes;
  } catch {
    return { ...DEFAULT_AREA_SIZES };
  }
}

export function saveAreaSizes(sizes: AreaSizes): void {
  try {
    localStorage.setItem(AREA_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Best-effort only.
  }
}
