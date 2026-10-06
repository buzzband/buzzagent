/**
 * Application store.
 *
 * Holds UI state and a *projection* of core state built from the SSE stream.
 * It is not a second source of truth: sessions, messages, permissions and
 * config live in the core, and everything here is either derived from an event
 * or purely visual (which panel is open, which theme is active).
 *
 * The rule that keeps this honest: never write a field here that the UI could
 * instead read back from the core.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { CoreClient } from "../core/client";
import {
  DEFAULT_ZOOM_INDEX,
  ZOOM_LEVELS,
  applyZoom,
  loadZoomIndex,
  saveZoomIndex,
  stepZoomIndex,
} from "../lib/zoom";
import {
  clampAreaSize,
  DEFAULT_AREA_SIZES,
  DEFAULT_LAYOUT,
  loadAreaSizes,
  loadLayout,
  saveAreaSizes,
  saveLayout,
  type AreaId,
  type AreaSizes,
  type LayoutState,
  type WindowId,
} from "../lib/layout";
export type { AreaId, WindowId, LayoutState, AreaSizes } from "../lib/layout";
import { isLanguage, t, type Language } from "../lib/i18n";
import { normalizeError, type ClassifiedError } from "../lib/errors";

/**
 * Reasoning-effort levels offered by the composer's reasoning chip.
 * "off" hides the level (plain model default); the rest map 1:1 to the
 * per-variant `reasoningEffort` config BuzzAgent writes for custom providers
 * and to the core's own variant keys for catalogue models.
 */
export const REASONING_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number] | "off";
import type {
  CoreEvent,
  CoreStatus,
  MessageInfo,
  MessageWithParts,
  ModelRef,
  Part,
  Command,
  PermissionRequest,
  PermissionReply,
  Provider,
  ProviderList,
  QueuedMessage,
  Session,
  SkillInfo,
  Todo,
} from "../core/types";

export type Theme =
  | "slate"
  | "sand"
  | "obsidian"
  | "nordic"
  | "dusk"
  | "system";

export interface ThemeOption {
  id: Theme;
  label: string;
  description: string;
  isDark: boolean;
}

export interface NotifyPrefs {
  enabled: boolean;
  sound: boolean;
  desktop: boolean;
  ntfyUrl: string;
  ntfyTopic: string;
  /** Sound preset id ("bell" | "chime" | "ding" | "beep"). */
  soundId: string;
}

export interface VoicePrefs {
  endpoint: string;
  model: string;
}

export interface ProjectPrefs {
  /** Skills shown in the presets layer for this project. */
  skills: string[];
  /** MCP server overrides for this project (mirrors project opencode.json). */
  mcp: Record<string, boolean>;
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "slate", label: "Midnight Slate", description: "Soft dark, easy on the eyes", isDark: true },
  { id: "sand", label: "Soft Sand", description: "Warm paper non-glare light", isDark: false },
  { id: "obsidian", label: "Warm Obsidian", description: "Deep cocoa graphite", isDark: true },
  { id: "nordic", label: "Nordic Frost", description: "Cool glacier blue", isDark: true },
  { id: "dusk", label: "Tokyo Cyber Dusk", description: "Electric violet night", isDark: true },
  { id: "system", label: "System Default", description: "Follows OS dark/light mode", isDark: true },
];

/** Where the app is in its startup sequence. */
export type Phase = "boot" | "onboarding" | "ready";

interface AppState {
  // ---- lifecycle
  phase: Phase;
  core: CoreStatus | null;
  client: CoreClient | null;
  pinnedVersion: string | null;
  startupError: string | null;

  // ---- project
  projectDir: string | null;
  recentProjects: RecentProject[];
  /** Projects the user removed from the sidebar list. */
  hiddenProjects: string[];

  // ---- providers & models
  providers: ProviderList | null;
  model: ModelRef | null;
  /** Custom providers as configured in the core config (editable source of truth). */
  customProviders: Record<string, Record<string, unknown>>;
  skills: SkillInfo[];
  /** Live MCP status from `GET /mcp`. */
  mcp: Record<string, unknown>;
  /** MCP servers as configured (the editable source of truth). */
  mcpServers: Record<string, Record<string, unknown>>;

  // ---- sessions
  sessions: Session[];
  sessionId: string | null;
  messages: MessageWithParts[];
  busy: boolean;
  /**
   * Live turn status as the core reports it. `busy`/`retry` carry the message
   * the core gave (retry includes the provider failure text) so the UI can
   * show WHAT is happening instead of a silent spinner. Null when idle.
   */
  turnStatus: { type: string; message?: string; attempt?: number; since: number } | null;
  todos: Todo[];
  queue: QueuedMessage[];

  // ---- permissions
  permissions: PermissionRequest[];
  /** False between an SSE drop and the next successful reconnect. */
  sseLive: boolean;

  // ---- errors
  /** Latest failure worth surfacing (provider, network, core). Null when clear. */
  lastError: ClassifiedError | null;
  /** Show/hide the raw detail section of the current error card. */
  errorDetailOpen: boolean;

  // ---- built-in slash commands
  /** Transient success/info notice from a builtin command (export, copy, …). */
  lastNotice: { text: string; at: number } | null;
  /** Built-in command list modal (/help). */
  helpModalOpen: boolean;
  setHelpModalOpen: (open: boolean) => void;

  // ---- ui
  /** Dockable window layout: where each window lives and which areas are shown. */
  layout: LayoutState;
  /** Pixel sizes of the resizable areas (left/right/top/bottom). */
  areaSizes: AreaSizes;
  theme: Theme;
  /** "system" = native window decorations; "custom" = hidden titlebar + drag-region header. */
  frameMode: "system" | "custom";
  /** Whole-app UI zoom as an index into ZOOM_LEVELS (100% by default). */
  zoomIndex: number;
  paletteOpen: boolean;
  settingsOpen: boolean;
  /** Skill slash-command pending insertion into the composer draft. */
  skillToInsert: string | null;
  /** One-shot text to drop into the composer (message "edit" etc.). */
  composerDraft: string | null;
  language: Language;
  notify: NotifyPrefs;
  voice: VoicePrefs;
  /** Which agents the composer's mode chips offer (from GET /agent + config). */
  agents: { name: string; description?: string }[];
  /** Project slash commands from GET /command, offered in the composer. */
  commands: { name: string; description?: string }[];
  settingsInitialTab: string | null;
  /** Session to open automatically after a project switch finishes. */
  pendingSessionId: string | null;
  /** MCP enabled-flags from the current project's own opencode.json. */
  projectMcp: Record<string, boolean>;
  /** File opened in the Editor window (path relative to the project root). */
  editorFile: { path: string; content: string; status: "loading" | "ready" | "error"; error?: string } | null;
  /** Bumped after any fs change so panels (Explorer, Changes) can refresh. */
  fsVersion: number;

  // ---- actions
  boot: () => Promise<void>;
  chooseProject: (dir: string) => Promise<void>;
  removeRecentProject: (path: string) => void;
  clearRecentProjects: () => void;
  removeProject: (dir: string) => void;
  refreshProviders: (force?: boolean) => Promise<void>;
  setModel: (model: ModelRef) => void;
  saveApiKey: (providerId: string, key: string) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  /** Auth methods per built-in provider (api key / oauth / device flow). */
  providerAuthMethods: () => Promise<Record<string, { type: string; label?: string }[]>>;
  /** Run an OAuth login for a provider; resolves when the callback lands. */
  oauthLogin: (providerId: string) => Promise<boolean>;
  loadSkills: () => Promise<void>;
  loadMcp: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadCommands: () => Promise<void>;
  setMcpEnabled: (name: string, enabled: boolean) => Promise<void>;
  removeMcp: (name: string) => Promise<void>;
  addMcpServer: (
    name: string,
    config: Record<string, unknown>
  ) => Promise<void>;
  saveCustomProvider: (params: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    models: {
      id: string;
      name?: string;
      reasoning?: boolean;
      level?: string | null;
    }[];
  }) => Promise<void>;

  newSession: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  send: (text: string, options?: { model?: ModelRef; agent?: string; variant?: string }) => Promise<void>;
  /** Execute a project slash command via the core (POST /session/:id/command). */
  runSlashCommand: (
    command: Command,
    args: string,
    options?: { model?: ModelRef; agent?: string }
  ) => Promise<void>;
  /** Execute a built-in GUI command (init/compact/export/copy/undo/redo/help). */
  runBuiltin: (token: string, args: string) => Promise<void>;
  addToQueue: (item: { text: string; model?: ModelRef; agent?: string }) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  abort: () => Promise<void>;

  answerPermission: (id: string, reply: PermissionReply) => Promise<void>;
  /** Record a failure of any origin so the UI can show it in full. */
  reportError: (
    error: unknown,
    context?: {
      sessionID?: string;
      providerID?: string;
      modelID?: string;
      messageID?: string;
      callID?: string;
    }
  ) => void;
  clearError: () => void;
  toggleErrorDetail: () => void;

  // ---- dockable layout
  /** Move a window into an area and make it the active tab there. */
  moveWindow: (window: WindowId, area: AreaId) => void;
  /** Show/hide an area (center cannot be hidden). */
  toggleArea: (area: AreaId) => void;
  /** Make a window the active tab of the area it lives in. */
  setActiveWindow: (window: WindowId) => void;
  /** Dock a window (if free) and reveal + activate it. */
  openWindow: (window: WindowId) => void;
  /** Undock a window back to the available list. */
  closeWindow: (window: WindowId) => void;
  /** Restore the default layout. */
  resetLayout: () => void;
  /** Set the pixel size of a resizable area (drag handle). */
  setAreaSize: (area: Exclude<AreaId, "center">, size: number) => void;
  /** Flush current area sizes to storage (called on drag end). */
  persistAreaSizes: () => void;
  setTheme: (theme: Theme) => void;
  setFrameMode: (mode: "system" | "custom") => void;
  /** Change the UI zoom: "in"/"out" step by one level, "reset" returns to 100%. */
  changeZoom: (action: "in" | "out" | "reset") => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSkillToInsert: (name: string | null) => void;
  /** Open a file in the Editor window: docks the window and loads content. */
  openInEditor: (path: string) => Promise<void>;
  /** Track the Editor draft as the user types. */
  setEditorContent: (content: string) => void;
  /** Repoint the open Editor file at a new path (rename), keeping the draft. */
  setEditorPath: (path: string) => void;
  /** Save the Editor draft back to disk via the core's file API. */
  saveEditor: () => Promise<void>;
  /** Close the Editor window and drop its state. */
  closeEditor: () => void;
  /** Show a file (its folder in the tree) after create/rename/delete. */
  bumpFsVersion: () => void;
  setLanguage: (language: Language) => void;
  setNotify: (prefs: Partial<NotifyPrefs>) => void;
  setVoice: (prefs: Partial<VoicePrefs>) => void;
  setSkillShown: (projectDir: string, skill: string, shown: boolean) => void;
  skillShown: (projectDir: string | null, skill: string) => boolean;
  setSettingsTab: (tab: string) => void;
  /** Open settings directly on `tab` (gear buttons that deep-link a pane). */
  openSettingsAt: (tab: string) => void;
  toggleModelReasoning: () => Promise<void>;
  /** Set the reasoning effort level for the active model; "off" = default. */
  setModelReasoningLevel: (level: ReasoningLevel) => Promise<void>;
  /** Shared engine: apply a reasoning patch (flag and/or level) to the active model's provider config. */
  setModelReasoningState: (patch: { reasoning?: boolean; level?: string | null }) => Promise<void>;
  /** Put text into the composer input (message "edit", skill insert, …). */
  insertIntoComposer: (text: string) => void;
  openProjectSession: (directory: string, sessionId: string) => Promise<void>;
  setProjectMcpEnabled: (name: string, enabled: boolean) => Promise<void>;
  loadProjectMcp: () => Promise<void>;

  /** Test seam: apply one SSE event through the real projection. */
  __handleEvent: (event: CoreEvent) => void;
}

const THEME_KEY = "buzzagent.theme";

function loadTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY) as Theme | null;
  if (
    stored === "slate" ||
    stored === "sand" ||
    stored === "obsidian" ||
    stored === "nordic" ||
    stored === "dusk" ||
    stored === "system"
  ) {
    return stored;
  }
  // Migrate legacy dark/light to slate/sand
  const raw = stored as unknown as string;
  if (raw === "dark") return "slate";
  if (raw === "light") return "sand";
  return "system";
}

function loadLanguage(): Language {
  const stored = localStorage.getItem("buzzagent.language");
  return isLanguage(stored) ? stored : "en";
}

function loadFrameMode(): "system" | "custom" {
  return localStorage.getItem("buzzagent.frame_mode") === "custom" ? "custom" : "system";
}
/**
 * Read a JSON-persisted value, keeping the shape of the fallback.
 *
 * Arrays must be validated as arrays: spreading a stored array into the
 * object-shaped fallback silently turned it into `{0:…,1:…}`, and consumers
 * then crashed on `.includes` — the "white screen on project open" bug
 * (hidden_projects written as an array, loaded back as an object).
 * Objects are merged over the fallback as before; anything else (or a type
 * mismatch with the fallback) falls back wholesale.
 */
function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(fallback)) {
      return (Array.isArray(parsed) ? parsed : fallback) as T;
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

const RECENT_PROJECTS_KEY = "buzzagent.recent_projects";
const MAX_RECENT_PROJECTS = 10;

function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_PROJECTS) : [];
  } catch {
    return [];
  }
}

function saveRecentProjects(list: RecentProject[]) {
  try {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify(list.slice(0, MAX_RECENT_PROJECTS))
    );
  } catch {
    // LocalStorage error ignored
  }
}

function recordRecentProject(dir: string, set: Setter, get: Getter) {
  const current = get().recentProjects;
  const name = dir.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || dir;
  const filtered = current.filter((p) => p.path !== dir);
  const updated: RecentProject[] = [
    { path: dir, name, lastOpened: Date.now() },
    ...filtered,
  ].slice(0, MAX_RECENT_PROJECTS);
  saveRecentProjects(updated);
  set({ recentProjects: updated });
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove(
    "theme-slate",
    "theme-sand",
    "theme-obsidian",
    "theme-nordic",
    "theme-dusk",
    "theme-dark",
    "theme-light"
  );

  let active = theme;
  if (theme === "system") {
    const isLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    active = isLight ? "sand" : "slate";
  }

  root.classList.add(`theme-${active}`);
  if (active === "sand") {
    root.classList.add("theme-light");
    root.style.colorScheme = "light";
  } else {
    root.classList.add("theme-dark");
    root.style.colorScheme = "dark";
  }
}

/** Sort newest-first; the core does not guarantee an order. */
function byRecency(a: Session, b: Session) {
  return (b.time?.updated ?? 0) - (a.time?.updated ?? 0);
}

export const useApp = create<AppState>((set, get) => ({
  phase: "boot",
  core: null,
  client: null,
  pinnedVersion: null,
  startupError: null,

  projectDir: null,
  recentProjects: loadRecentProjects(),
  hiddenProjects: loadJson<string[]>("buzzagent.hidden_projects", []),

  providers: null,
  model: null,

  sessions: [],
  sessionId: null,
  messages: [],
  busy: false,
  turnStatus: null,
  todos: [],
  queue: [],

  permissions: [],
  sseLive: true,

  lastError: null,
  errorDetailOpen: false,
  lastNotice: null,
  helpModalOpen: false,
  setHelpModalOpen: (helpModalOpen) => set({ helpModalOpen }),

  customProviders: {},
  skills: [],
  mcp: {},
  mcpServers: {},

  layout: loadLayout(),
  areaSizes: loadAreaSizes(),
  theme: loadTheme(),
  frameMode: loadFrameMode(),
  zoomIndex: loadZoomIndex(),
  paletteOpen: false,
  settingsOpen: false,
  skillToInsert: null,
  composerDraft: null,
  language: loadLanguage(),
  notify: loadJson("buzzagent.notify", {
    enabled: true,
    sound: true,
    desktop: true,
    ntfyUrl: "",
    ntfyTopic: "",
    soundId: "bell",
  }),
  voice: loadJson("buzzagent.voice", { endpoint: "", model: "" }),
  agents: [],
  commands: [],
  settingsInitialTab: null,
  pendingSessionId: null,
  projectMcp: {},
  editorFile: null,
  fsVersion: 0,

  // ------------------------------------------------------------- lifecycle

  boot: async () => {
    applyTheme(get().theme);
    try {
      const pinnedVersion = await invoke<string>("core_pinned_version");
      const status = await invoke<CoreStatus>("core_status");
      set({ pinnedVersion, core: status });

      // A core may already be running (hot reload, or the user attached one).
      if (status.state === "running" && status.connection) {
        const client = new CoreClient(status.connection);
        set({ client, projectDir: status.connection.directory || null });
        await afterConnect(set, get);
        return;
      }
      set({ phase: "onboarding" });
    } catch (error) {
      // Running in a plain browser (no Tauri): onboarding explains it.
      set({ phase: "onboarding", startupError: describe(error) });
    }
  },

  chooseProject: async (dir) => {
    set({ phase: "boot", startupError: null });
    try {
      const connection = await invoke<CoreStatus["connection"]>("core_start", {
        projectDir: dir,
      });
      if (!connection) throw new Error("Core did not report a connection");

      const status = await invoke<CoreStatus>("core_status");
      set({
        core: status,
        client: new CoreClient(connection),
        projectDir: dir,
      });
      recordRecentProject(dir, set, get);
      await get().loadProjectMcp();
      await afterConnect(set, get);
    } catch (error) {
      set({ phase: "onboarding", startupError: describe(error) });
    }
  },

  removeRecentProject: (path) => {
    const updated = get().recentProjects.filter((p) => p.path !== path);
    saveRecentProjects(updated);
    set({ recentProjects: updated });
  },

  clearRecentProjects: () => {
    saveRecentProjects([]);
    set({ recentProjects: [] });
  },

  /** "Delete project" = hide it from the sidebar; sessions stay in the core. */
  removeProject: (dir) => {
    const recent = get().recentProjects.filter((p) => p.path !== dir);
    saveRecentProjects(recent);
    const hidden = get().hiddenProjects.filter((d) => d !== dir).concat(dir);
    localStorage.setItem("buzzagent.hidden_projects", JSON.stringify(hidden));
    set({ recentProjects: recent, hiddenProjects: hidden });
  },

  // ------------------------------------------------------------- providers

  refreshProviders: async (force = false) => {
    const client = get().client;
    if (!client) return;

    // GET /provider downloads the whole models.dev catalogue (~2 s). It only
    // changes when the core changes, so cache it and re-merge customs from
    // disk on every other call — that file is written synchronously by us.
    let providers = get().providers;
    if (!providers || force) {
      providers = await client.providers();
    }
    const settings = await invoke<Record<string, unknown>>("core_read_settings");
    const config = { provider: settings.provider } as Record<string, unknown>;

    const customProviders = (config.provider ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    set({ customProviders });

    // Merge any custom providers configured in core config (e.g. Ollama, LM Studio, vLLM, DeepSeek)
    const custom = (config.provider ?? {}) as Record<string, Record<string, unknown>>;
    if (custom && typeof custom === "object") {
      for (const [id, def] of Object.entries(custom)) {
        if (!def || typeof def !== "object") continue;
        const models: Record<string, { id: string; name?: string }> = {};
        const modelsObj = def.models as Record<string, Record<string, unknown>> | undefined;
        if (modelsObj && typeof modelsObj === "object") {
          for (const [mId, mDef] of Object.entries(modelsObj)) {
            models[mId] = {
              id: mId,
              name: typeof mDef?.name === "string" ? mDef.name : mId,
            };
          }
        }
        const existingIdx = providers.all.findIndex((p) => p.id === id);
        const pObj: Provider = {
          id,
          name: typeof def.name === "string" ? def.name : id,
          models,
        };
        if (existingIdx >= 0) {
          providers.all[existingIdx] = pObj;
        } else {
          providers.all.push(pObj);
        }
        if (!providers.connected.includes(id)) {
          providers.connected.push(id);
        }
      }
    }

    set({ providers });

    // Never fall back to an implicit default: Zen is "connected" out of the
    // box, so an automatic pick could silently bill a hosted gateway.
    const current = get().model;
    if (current) return;
    const explicit = pickUserProvider(providers);
    if (explicit) set({ model: explicit });
  },

  setModel: (model) => set({ model }),

  saveApiKey: async (providerId, key) => {
    const client = get().client;
    if (!client) throw new Error("Core is not running");
    await client.setAuth(providerId, { type: "api", key });
    // `connected` changes on the core: the cached catalogue is now stale.
    await get().refreshProviders(true);
  },

  saveCustomProvider: async ({ id, name, baseUrl, apiKey, models }) => {
    // 1. Persist to the config file we own.
    await invoke("core_save_custom_provider", {
      id,
      name,
      baseUrl,
      apiKey: apiKey || null,
      models,
    });

    // 2. Optimistic: reflect the provider in the UI immediately. The core only
    // reads config at startup, so GET /config would not show it yet.
    const provider: Provider = {
      id,
      name,
      models: Object.fromEntries(
        models.map((m) => [m.id, { id: m.id, name: m.name ?? m.id }])
      ),
    };
    set((state) => {
      if (!state.providers) return {};
      const all = state.providers.all.filter((p) => p.id !== id);
      all.push(provider);
      const connected = state.providers.connected.filter((p) => p !== id);
      connected.push(id);
      return {
        customProviders: {
          ...state.customProviders,
          [id]: {
            name,
            options: { baseURL: baseUrl, apiKey: apiKey ?? "" },
            models: Object.fromEntries(
              models.map((m) => [
                m.id,
                {
                  name: m.name ?? m.id,
                  ...(m.reasoning ? { reasoning: true } : {}),
                  ...(m.level && m.level !== "off" ? { level: m.level } : {}),
                },
              ])
            ),
          },
        },
        providers: { ...state.providers, all, connected },
      };
    });

    // 3. Restart the core so it loads the new provider (config is read once
    // at startup), then reconnect the SSE stream through the fresh client.
    const projectDir = get().projectDir;
    if (projectDir) {
      const connection = await invoke<CoreStatus["connection"]>("core_restart", {
        projectDir,
      });
      if (connection) {
        set({ client: new CoreClient(connection) });
        unsubscribe?.();
        unsubscribe = null;
        await afterConnect(set, get);
      }
    }

    // 4. Select the first model of the provider.
    if (models.length > 0) {
      set({ model: { providerID: id, modelID: models[0].id } });
    }
  },

  providerAuthMethods: async () => {
    const client = get().client;
    if (!client) return {};
    return client.providerAuthMethods().catch(() => ({}));
  },

  /**
   * OAuth login: ask the core to authorize, open the system browser, then
   * wait for the core to report the provider connected.
   *
   * The callback route belongs to the core (the browser redirects straight
   * into it), so the UI must not call it itself — doing so mid-login reports
   * a false failure. Success is polled: the provider shows up in the
   * connected list once the core persists the token.
   */
  oauthLogin: async (providerId) => {
    const client = get().client;
    if (!client) return false;
    let url: string | undefined;
    try {
      const result = (await client.oauthAuthorize(providerId)) as { url?: string };
      url = typeof result?.url === "string" ? result.url : undefined;
    } catch (error) {
      get().reportError(error);
      return false;
    }
    if (url) {
      // No opener plugin is bundled; the plain browser handoff is enough —
      // the desktop webview delegates window.open to the system browser.
      window.open(url, "_blank", "noopener");
    }
    // Poll until the login lands (browser redirect + token exchange takes a
    // few seconds; give slow humans a minute), then report honestly.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await get().refreshProviders(true).catch(() => undefined);
      if (get().providers?.connected.includes(providerId)) return true;
    }
    return false;
  },

  deleteProvider: async (id) => {
    const client = get().client;
    if (!client) return;
    // 1. Remove from the on-disk core config. The core deep-merges patches,
    // so deletion is an explicit null, not an absent key.
    await invoke("core_write_settings", {
      patch: { provider: { [id]: null } },
    });

    // 2. Remove stored credentials too (built-ins keep only their auth here).
    await client.deleteProviderAuth(id).catch(() => undefined);

    // 3. Drop the model if it belonged to the removed provider.
    if (get().model?.providerID === id) set({ model: null });

    // 4. Restart so the running core drops it too.
    const projectDir = get().projectDir;
    if (projectDir) {
      const connection = await invoke<CoreStatus["connection"]>("core_restart", {
        projectDir,
      });
      if (connection) {
        set({ client: new CoreClient(connection) });
        unsubscribe?.();
        unsubscribe = null;
        await afterConnect(set, get);
        return;
      }
    }
    await get().refreshProviders();
  },

  loadSkills: async () => {
    const client = get().client;
    if (!client) return;
    set({ skills: await client.skills().catch(() => []) });
  },

  loadAgents: async () => {
    const client = get().client;
    if (!client) return;
    const agents = await client.agents().catch(() => []);
    set({
      // Internal machinery agents (compaction/title/summary) are hidden from
      // the UI per the core; only user-facing primaries become chips.
      agents: agents
        .filter((a) => a.mode !== "subagent" && a.name !== "compaction" && a.name !== "title" && a.name !== "summary")
        .map((a) => ({ name: a.name, description: a.description })),
    });
  },

  loadCommands: async () => {
    const client = get().client;
    if (!client) return;
    const commands = await client.commands().catch(() => []);
    set({
      commands: commands.map((c) => ({ name: c.name, description: c.description })),
    });
  },

  loadMcp: async () => {
    const client = get().client;
    if (!client) return;
    const [status, settings] = await Promise.all([
      client.mcp().catch(() => ({})),
      invoke<Record<string, unknown>>("core_read_settings"),
    ]);
    set({
      mcp: status,
      mcpServers: (settings.mcp as Record<string, Record<string, unknown>>) ?? {},
    });
  },

  setMcpEnabled: async (name, enabled) => {
    const client = get().client;
    if (!client) return;
    const settings = await invoke<Record<string, unknown>>("core_read_settings");
    const servers = { ...((settings.mcp as Record<string, Record<string, unknown>>) ?? {}) };
    const server = { ...(servers[name] ?? {}) };
    server.enabled = enabled;
    servers[name] = server;
    await invoke("core_write_settings", { patch: { mcp: servers } });
    // Apply to the live core immediately.
    if (enabled) await client.addMcp(name, server).catch(() => undefined);
    else await client.disconnectMcp(name).catch(() => undefined);
    await get().loadMcp();
  },

  removeMcp: async (name) => {
    const client = get().client;
    if (!client) return;
    await invoke("core_write_settings", {
      patch: { mcp: { [name]: null } },
    });
    await client.disconnectMcp(name).catch(() => undefined);
    await get().loadMcp();
  },

  addMcpServer: async (name, config) => {
    const client = get().client;
    if (!client) return;
    const settings = await invoke<Record<string, unknown>>("core_read_settings");
    const servers = { ...((settings.mcp as Record<string, Record<string, unknown>>) ?? {}) };
    servers[name] = config;
    await invoke("core_write_settings", { patch: { mcp: servers } });
    await client.addMcp(name, config);
    await get().loadMcp();
  },

  // -------------------------------------------------------------- sessions

  newSession: async () => {
    const client = get().client;
    if (!client) return;
    const session = await client.createSession("New session");
    set((state) => ({
      sessions: [session, ...state.sessions].sort(byRecency),
      sessionId: session.id,
      messages: [],
      todos: [],
    }));
  },

  openSession: async (id) => {
    const client = get().client;
    if (!client) return;
    set({ sessionId: id, messages: [], todos: [] });
    const [messages, todos] = await Promise.all([
      client.messages(id),
      client.todos(id).catch(() => [] as Todo[]),
    ]);
    // Guard against a slower response for a session the user already left.
    if (get().sessionId !== id) return;
    set({ messages, todos });
  },

  deleteSession: async (id) => {
    const client = get().client;
    if (!client) return;
    await client.deleteSession(id);
    const remaining = get().sessions.filter((s) => s.id !== id);
    set({ sessions: remaining });
    if (get().sessionId === id) {
      const next = remaining[0];
      if (next) await get().openSession(next.id);
      else set({ sessionId: null, messages: [] });
    }
  },

  renameSession: async (id, title) => {
    const client = get().client;
    if (!client || !title.trim()) return;
    const updated = await client.renameSession(id, title.trim());
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? updated : s)),
    }));
  },

  send: async (text, options) => {
    const activeModel = options?.model ?? get().model;
    const { client } = get();
    if (!client || !text.trim()) return;
    if (!activeModel) throw new Error("Choose a model first");

    // A message that starts with a known project command (GET /command) is
    // executed by the core itself, not sent to the model. Built-in GUI
    // commands (init/compact/export/…) resolve next; unknown slash tokens
    // still pass through as plain text.
    if (text.startsWith("/")) {
      const token = text.slice(1).split(/\s+/)[0];
      const command = get().commands.find(
        (c) => c.name.toLowerCase() === token.toLowerCase()
      );
      if (command) {
        await get().runSlashCommand(command, text.slice(1 + token.length).trim(), options);
        return;
      }
      // Built-in GUI commands handled by the shell itself, not the core.
      const { resolveBuiltin } = await import("../lib/builtinCommands");
      const builtin = resolveBuiltin(token);
      if (builtin) {
        await get().runBuiltin(token, text.slice(1 + token.length).trim());
        return;
      }
    }

    let sessionId = get().sessionId;
    if (!sessionId) {
      await get().newSession();
      sessionId = get().sessionId;
      if (!sessionId) return;
    }

    // `!cmd` — shell passthrough (as in Claude Code / opencode TUI). The core
    // has no "run without model" endpoint, so this ships the request to the
    // agent, which runs it through its own permission-gated bash tool.
    const visibleText = text.startsWith("!")
      ? [
          "Run this shell command and show me the output:",
          "```bash",
          text.slice(1).trim(),
          "```",
        ].join("\n")
      : text;

    const parts: Part[] = [{ type: "text", text: visibleText }];

    // Reasoning level of the active model (composer chip). Custom providers
    // get per-variant `reasoningEffort` config written by the Rust side; the
    // core merges the selected variant's options into the request. No level →
    // no `variant` field at all, i.e. provider default behaviour.
    const levelModel = options?.model ?? get().model;
    const level = levelModel
      ? (
          get().customProviders[levelModel.providerID] as
            | { models?: Record<string, { level?: string }> }
            | undefined
        )?.models?.[levelModel.modelID]?.level
      : undefined;
    const variant = level && level !== "off" ? level : undefined;

    // Optimistic echo so the composer feels instant; the core will replace it
    // with the authoritative message on the next event. Parts get a synthetic
    // `local-part-` id so the real part events (which carry their own ids) can
    // replace them instead of appending a second copy — see the part handler.
    set((state) => ({
      busy: true,
      messages: [
        ...state.messages,
        {
          info: {
            id: `local-${Date.now()}`,
            sessionID: sessionId as string,
            role: "user",
            time: { created: Date.now() },
          },
          parts: parts.map((part, i) => ({ ...part, id: `local-part-${Date.now()}-${i}` })),
        },
      ],
    }));
    markSseAlive();
    startWatchdog(set, get);

    try {
      await client.promptAsync(sessionId, parts, {
        model: activeModel,
        agent: options?.agent,
        variant,
      });
    } catch (error) {
      set({ busy: false });
      // The prompt never reached the core (or was refused): surface the real
      // reason — connection drop, auth, bad model — instead of a bare toast.
      get().reportError(error, {
        sessionID: sessionId,
        providerID: activeModel?.providerID,
        modelID: activeModel?.modelID,
      });
      throw error;
    }
  },

  runBuiltin: async (token, args) => {
    const { resolveBuiltin } = await import("../lib/builtinCommands");
    const command = resolveBuiltin(token);
    if (!command) return;

    const s = get();
    const messageText = (part: unknown) => {
      const m = part as { parts?: { type: string; text?: string }[] };
      return (m.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n");
    };
    const ctx = {
      sessionId: s.sessionId,
      language: s.language,
      messageText,
      messages: s.messages,
      model: s.model,
      api: {
        summarize: (id: string, model: ModelRef) =>
          s.client ? s.client.summarize(id, model) : Promise.reject(new Error("Core is not running")),
        revert: (id: string, messageID: string) =>
          s.client ? s.client.revert(id, messageID) : Promise.reject(new Error("Core is not running")),
        unrevert: (id: string) =>
          s.client ? s.client.unrevert(id) : Promise.reject(new Error("Core is not running")),
        initSession: (id: string) =>
          s.client ? s.client.initSession(id) : Promise.reject(new Error("Core is not running")),
      },
      fs: {
        pickMarkdownPath: async () => {
          try {
            const { save } = await import("@tauri-apps/plugin-dialog");
            return await save({
              title: "Export conversation",
              defaultPath: "conversation.md",
              filters: [{ name: "Markdown", extensions: ["md"] }],
            });
          } catch {
            return null;
          }
        },
        writeProjectFile: async (path: string, content: string) => {
          await invoke("fs_write_file", { projectDir: s.projectDir ?? ".", path, content });
        },
        copyToClipboard: async (text: string) => {
          await navigator.clipboard.writeText(text);
        },
        bumpFsVersion: () => s.bumpFsVersion(),
      },
      notify: (msg: string) => {
        if (msg === "__open_help__") {
          set({ helpModalOpen: true });
          return;
       }
        set({ lastNotice: { text: msg, at: Date.now() } });
      },
      fail: (error: unknown) => s.reportError(error),
    };
    try {
      await command.run(ctx as never, args);
      // undo/redo rewrite session history — reload the current messages.
      if (token === "undo" || token === "redo") {
        const id = get().sessionId;
        if (id && get().client) {
          const messages = await get().client!.messages(id);
          set({ messages });
        }
      }
    } catch (error) {
      s.reportError(error);
    }
  },

  runSlashCommand: async (command, args, options) => {
    const { client, sessionId } = get();
    if (!client) return;
    let id = sessionId;
    if (!id) {
      await get().newSession();
      id = get().sessionId;
      if (!id) return;
    }
    try {
      await client.runCommand(id, command.name, args, {
        model: options?.model ?? get().model ?? undefined,
        agent: options?.agent ?? command.agent,
      });
      // The core streams back the resulting messages via SSE; nothing to echo
      // locally. Surface the command's own template/agent in the status if
      // needed later — for now success is just "the agent started working".
    } catch (error) {
      get().reportError(error, {
        sessionID: id,
        providerID: command.model?.split("/")[0],
        modelID: command.model?.split("/")[1],
      });
      throw error;
    }
  },

  addToQueue: ({ text, model: itemModel, agent }) => {
    const targetModel = itemModel ?? get().model;
    if (!text.trim() || !targetModel) return;
    const item: QueuedMessage = {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text: text.trim(),
      model: targetModel,
      agent,
      createdAt: Date.now(),
    };
    set((state) => ({ queue: [...state.queue, item] }));
  },

  removeFromQueue: (id) => {
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }));
  },

  clearQueue: () => {
    set({ queue: [] });
  },

  abort: async () => {
    const { client, sessionId } = get();
    if (!client || !sessionId) return;
    await client.abort(sessionId);
    set({ busy: false, turnStatus: null });
    stopWatchdog();
  },

  // ----------------------------------------------------------- permissions

  answerPermission: async (id, reply) => {
    const { client, permissions } = get();
    const request = permissions.find((p) => p.id === id);
    if (!client || !request) return;
    // Drop it locally first: leaving a resolved prompt on screen feels broken.
    set({ permissions: permissions.filter((p) => p.id !== id) });
    try {
      await client.respondToPermission(request.sessionID, id, reply);
    } catch (error) {
      set({ permissions: [...get().permissions, request] });
      throw error;
    }
  },

  // ----------------------------------------------------------------- errors

  reportError: (error, context) => {
    set({ lastError: normalizeError(error, context), errorDetailOpen: false });
  },

  clearError: () => set({ lastError: null, errorDetailOpen: false }),

  toggleErrorDetail: () =>
    set((state) => ({ errorDetailOpen: !state.errorDetailOpen })),

  // -------------------------------------------------------------------- ui

  // --------------------------------------------------------- dockable layout

  moveWindow: (window, area) =>
    set((state) => {
      const windows = { ...state.layout.windows, [window]: area };
      const active = { ...state.layout.active, [area]: window };
      const areaVisible =
        area === "center"
          ? state.layout.areaVisible
          : { ...state.layout.areaVisible, [area]: true };
      const layout: LayoutState = { windows, active, areaVisible };
      saveLayout(layout);
      return { layout };
    }),

  toggleArea: (area) => {
    if (area === "center") return;
    set((state) => {
      const areaVisible = {
        ...state.layout.areaVisible,
        [area]: !state.layout.areaVisible[area],
      };
      const layout: LayoutState = { ...state.layout, areaVisible };
      saveLayout(layout);
      return { layout };
    });
  },

  setActiveWindow: (window) => {
    const area = get().layout.windows[window];
    if (!area) return;
    set((state) => {
      const layout: LayoutState = {
        ...state.layout,
        active: { ...state.layout.active, [area]: window },
      };
      saveLayout(layout);
      return { layout };
    });
  },

  openWindow: (window) =>
    set((state) => {
      const current = state.layout.windows[window];
      const area = current ?? "center";
      const windows = current ? state.layout.windows : { ...state.layout.windows, [window]: area };
      const areaVisible =
        area === "center"
          ? state.layout.areaVisible
          : { ...state.layout.areaVisible, [area]: true };
      const active = { ...state.layout.active, [area]: window };
      const layout: LayoutState = { windows, active, areaVisible };
      saveLayout(layout);
      return { layout };
    }),

  closeWindow: (window) =>
    set((state) => {
      const windows = { ...state.layout.windows, [window]: null };
      const layout: LayoutState = { ...state.layout, windows };
      saveLayout(layout);
      return { layout };
    }),

  resetLayout: () => {
    const layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)) as LayoutState;
    const areaSizes = { ...DEFAULT_AREA_SIZES };
    saveLayout(layout);
    saveAreaSizes(areaSizes);
    set({ layout, areaSizes });
  },

  setAreaSize: (area, size) => {
    // Viewport-aware clamp: a sidebar may grow as far as the user wants; the
    // only stop is where the sibling area on that axis plus the middle column
    // reach their minimums (see clampAreaSize — the old fixed 720 px cap is
    // what made dragging stop around 40% of the window).
    const visible = get().layout.areaVisible;
    const clamped = clampAreaSize(
      area,
      size,
      get().areaSizes,
      { width: window.innerWidth, height: window.innerHeight },
      visible
    );
    // In-memory only: dragging fires this on every pointermove, so the write
    // to localStorage happens when the drag ends (see persistAreaSizes).
    set((state) => ({ areaSizes: { ...state.areaSizes, [area]: clamped } }));
  },
  /** Flush the current area sizes to storage (called on drag end). */
  persistAreaSizes: () => saveAreaSizes(get().areaSizes),

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },

  setFrameMode: (mode) => {
    localStorage.setItem("buzzagent.frame_mode", mode);
    set({ frameMode: mode });
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        await win.setDecorations(mode === "system");
        await win.setResizable(true);
      } catch {
        // Plain browser: no window to decorate.
      }
    })();
  },

  /** Step the whole-app UI zoom and persist it. WebKitGTK exposes no
   * built-in Ctrl+plus/minus/wheel zoom, so the app owns the feature. */
  changeZoom: (action) => {
    const current = get().zoomIndex;
    const next = action === "reset" ? DEFAULT_ZOOM_INDEX : stepZoomIndex(current, action === "in" ? 1 : -1);
    if (next === current) return;
    saveZoomIndex(next);
    set({ zoomIndex: next });
    void applyZoom(ZOOM_LEVELS[next]);
  },

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => {
    // Deep links (openSettingsAt) own the tab while the panel opens; the
    // remembered tab is forgotten on CLOSE, so a generic reopen starts fresh
    // without clobbering a tab that was just requested.
    if (!settingsOpen) set({ settingsInitialTab: null });
    set({ settingsOpen });
  },
  openSettingsAt: (tab) => set({ settingsInitialTab: tab, settingsOpen: true }),
  setSkillToInsert: (skillToInsert) => set({ skillToInsert }),

  openInEditor: async (path) => {
    // Same file already open and loaded: just reveal it — reloading would
    // silently discard unsaved edits.
    const already = get().editorFile;
    if (already?.path === path && already.status === "ready") return;
    set({
      editorFile: { path, content: "", status: "loading" },
    });
    // Dock the Editor window and make it the active tab of its area.
    set((state) => {
      const windows = { ...state.layout.windows, editor: "center" as const };
      const active = { ...state.layout.active, center: "editor" as const };
      const layout = { ...state.layout, windows, active };
      saveLayout(layout);
      return { layout };
    });
    const client = get().client;
    if (!client) {
      set({ editorFile: { path, content: "", status: "error", error: "Core is not running" } });
      return;
    }
    try {
      const file = await client.readFile(path);
      // The user may have closed the window while we fetched — keep it then.
      const current = get().editorFile;
      if (current?.path !== path) return;
      set({ editorFile: { path, content: file.content ?? "", status: "ready" } });
    } catch (e) {
      const current = get().editorFile;
      if (current?.path !== path) return;
      set({
        editorFile: {
          path,
          content: "",
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  },

  setEditorContent: (content) =>
    set((state) =>
      state.editorFile ? { editorFile: { ...state.editorFile, content } } : {}
    ),

  setEditorPath: (path) =>
    set((state) =>
      state.editorFile ? { editorFile: { ...state.editorFile, path } } : {}
    ),

  saveEditor: async () => {
    const { editorFile, projectDir, reportError, bumpFsVersion } = get();
    if (!editorFile || !projectDir) return;
    try {
      // The core exposes no file-write endpoint, so — same as fs_tree — the
      // desktop backend writes directly.
      await invoke("fs_write_file", {
        projectDir,
        path: editorFile.path,
        content: editorFile.content,
      });
      bumpFsVersion();
    } catch (e) {
      reportError(e);
    }
  },

  closeEditor: () => {
    // Drop the file but keep the window docked — closing the tab is enough.
    set({ editorFile: null });
  },

  bumpFsVersion: () => set((state) => ({ fsVersion: state.fsVersion + 1 })),
  setLanguage: (language) => {
    localStorage.setItem("buzzagent.language", language);
    set({ language });
  },
  setNotify: (prefs) => {
    const next = { ...get().notify, ...prefs };
    localStorage.setItem("buzzagent.notify", JSON.stringify(next));
    set({ notify: next });
  },
  setVoice: (prefs) => {
    const next = { ...get().voice, ...prefs };
    localStorage.setItem("buzzagent.voice", JSON.stringify(next));
    set({ voice: next });
  },
  setSkillShown: (projectDir, skill, shown) => {
    const all = loadJson<Record<string, ProjectPrefs>>("buzzagent.projectPrefs", {});
    const prefs = all[projectDir] ?? { skills: [], mcp: {} };
    const skills = new Set(prefs.skills);
    if (shown) skills.add(skill);
    else skills.delete(skill);
    all[projectDir] = { ...prefs, skills: [...skills] };
    localStorage.setItem("buzzagent.projectPrefs", JSON.stringify(all));
  },
  skillShown: (projectDir, skill) => {
    if (!projectDir) return true;
    const all = loadJson<Record<string, ProjectPrefs>>("buzzagent.projectPrefs", {});
    const prefs = all[projectDir];
    if (!prefs) return true; // default: everything shown
    return prefs.skills.includes(skill);
  },
  setSettingsTab: (tab) => set({ settingsInitialTab: tab }),

  /**
   * Apply a reasoning patch (capability flag and/or effort level) to the
   * active model's entry in its custom-provider config.
   *
   * Why this must not call saveCustomProvider: that action RESTARTS THE CORE
   * (config was believed to be read only at startup) — every reasoning click
   * tore down the SSE stream, killed any running turn, reset the selected
   * model and left the chip dead for ~a minute. The Rust side already PATCHes
   * the live core's /config, so an in-place update is enough: apply the patch
   * optimistically, persist in the background, report failures as a toast.
   */
  setModelReasoningState: async (patch) => {
    const { model, customProviders, reportError } = get();
    if (!model) return;
    const def = customProviders[model.providerID] as
      | { name?: unknown; options?: { baseURL?: unknown; apiKey?: unknown }; models?: Record<string, { name?: string; reasoning?: boolean; level?: string }> }
      | undefined;
    if (!def) {
      set({ settingsInitialTab: "providers", settingsOpen: true });
      return;
    }
    const models = { ...(def.models ?? {}) };
    const entry = models[model.modelID];
    if (!entry) return;
    const next = { ...entry, ...patch };

    // 1. Optimistic UI update — the chip responds the same tick.
    set((state) => ({
      customProviders: {
        ...state.customProviders,
        [model.providerID]: {
          ...def,
          models: { ...models, [model.modelID]: next },
        },
      },
    }));

    // 2. Persist + live PATCH via the file command; NO core restart.
    try {
      await invoke("core_save_custom_provider", {
        id: model.providerID,
        name: typeof def.name === "string" ? def.name : model.providerID,
        baseUrl: typeof def.options?.baseURL === "string" ? def.options.baseURL : "",
        apiKey:
          typeof def.options?.apiKey === "string" && def.options.apiKey
            ? def.options.apiKey
            : null,
        models: Object.entries(models).map(([id, mm]) => ({
          id,
          name: mm.name,
          reasoning: id === model.modelID ? next.reasoning === true : mm.reasoning === true,
          level: id === model.modelID ? (next.level ?? null) : (mm.level ?? null),
        })),
      });
    } catch (error) {
      // Roll the chip back and surface why — never a silent failure.
      set((state) => ({
        customProviders: {
          ...state.customProviders,
          [model.providerID]: {
            ...def,
            models: { ...models, [model.modelID]: entry },
          },
        },
      }));
      reportError(
        error instanceof Error ? error : new Error(String(error)),
        { sessionID: get().sessionId ?? undefined }
      );
    }
  },

  toggleModelReasoning: async () => {
    const { model, customProviders } = get();
    if (!model) return;
    const entry = (
      customProviders[model.providerID] as
        | { models?: Record<string, { reasoning?: boolean; level?: string }> }
        | undefined
    )?.models?.[model.modelID];
    if (!entry) {
      if (!customProviders[model.providerID]) {
        set({ settingsInitialTab: "providers", settingsOpen: true });
      }
      return;
    }
    // Turning reasoning ON must produce a *live* level immediately: no
    // saved level means the model was never asked to think, so start at the
    // top of the stack ("max"). The dropdown further down lets the user
    // downshift; an undefended "// enable? set level max" break is what the
    // user requested when they clicked the chip.
    const next = !entry.reasoning;
    await get().setModelReasoningState({
      reasoning: next,
      ...(next && !entry.level ? { level: "max" } : {}),
    });
  },

  /**
   * Pick a reasoning-effort level from the composer chip. Selecting any level
   * implies reasoning is ON (otherwise the click would appear to do nothing);
   * "off" clears the level AND the flag, returning the model to
   * provider-default behaviour.
   */
  setModelReasoningLevel: async (level) => {
    const { model, customProviders } = get();
    if (!model) return;
    const def = customProviders[model.providerID] as
      | { models?: Record<string, { reasoning?: boolean; level?: string }> }
      | undefined;
    if (!def) {
      set({ settingsInitialTab: "providers", settingsOpen: true });
      return;
    }
    const entry = def.models?.[model.modelID];
    if (!entry) return;
    const reasoning = level !== "off" ? true : false;
    await get().setModelReasoningState({
      reasoning,
      level: level === "off" ? null : level,
    });
  },

  /** Edit affordance: drop text into the composer for further editing. */
  insertIntoComposer: (text) => {
    set({ composerDraft: text });
  },
  openProjectSession: async (directory, sessionId) => {
    if (directory === get().projectDir) {
      await get().openSession(sessionId);
      return;
    }
    // A different project owns this session: switch cores to it first.
    set({ pendingSessionId: sessionId });
    await get().chooseProject(directory);
  },
  loadProjectMcp: async () => {
    const dir = get().projectDir;
    if (!dir) {
      set({ projectMcp: {} });
      return;
    }
    try {
      const config = await invoke<Record<string, unknown>>("core_read_project_config", {
        projectDir: dir,
      });
      const servers = (config.mcp ?? {}) as Record<string, { enabled?: boolean }>;
      const flags: Record<string, boolean> = {};
      for (const [name, def] of Object.entries(servers)) {
        flags[name] = def.enabled !== false;
      }
      set({ projectMcp: flags });
    } catch {
      set({ projectMcp: {} });
    }
  },
  setProjectMcpEnabled: async (name, enabled) => {
    const dir = get().projectDir;
    const base = get().mcpServers[name];
    if (!dir || !base) return;
    await invoke("core_write_project_config", {
      projectDir: dir,
      patch: { mcp: { [name]: { ...base, enabled } } },
    });
    set((state) => ({ projectMcp: { ...state.projectMcp, [name]: enabled } }));
  },

  /**
   * Test seam for the SSE projection.
   *
   * Exposed so event handling is covered through the same code path the live
   * stream uses, instead of duplicating the reducer in tests.
   */
  __handleEvent: (event: CoreEvent) => handleEvent(event, set, get),
}));

// --------------------------------------------------------------- internals

type Setter = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type Getter = () => AppState;

/** Loosely-typed SSE payload; fields are validated at the point of use. */
type EventProps = Record<string, unknown>;

/** Shared tail of both connect paths: load state, subscribe, go live. */
async function afterConnect(set: Setter, get: Getter) {
  const client = get().client;
  if (!client) return;

  await get().refreshProviders();

  const sessions = (await client.sessions().catch(() => [])).sort(byRecency);
  set({ sessions, phase: "ready" });

  void get().loadSkills();
  void get().loadMcp();
  void get().loadAgents();
  void get().loadCommands();
  void get().loadProjectMcp();

  const pending = get().pendingSessionId;
  set({ pendingSessionId: null });
  const target =
    pending && sessions.some((session) => session.id === pending)
      ? pending
      : sessions[0]?.id;
  if (target) await get().openSession(target);

  subscribe(set, get);
}

let unsubscribe: (() => void) | null = null;

/**
 * Turn watchdog state.
 *
 * A turn whose SSE events never arrive (channel killed, proxy hiccup, core
 * restarted mid-turn) used to mean a blinking caret forever: the optimistic
 * echo set `busy`, and nothing would ever clear it or show the finished
 * messages. The watchdog notices "busy but no events for a while", re-pulls
 * the authoritative state over HTTP and logs both facts to debug.log.
 */
const WATCHDOG_TICK_MS = 5_000;
const WATCHDOG_STALE_MS = 20_000;
let lastSseEventAt = 0;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function markSseAlive(): void {
  lastSseEventAt = Date.now();
}

/** Watchdog activity goes to debug.log: a "caret blinked forever" report
 * then tells us whether the UI saw events and whether recovery worked. */
function logTurnWatchdog(message: string): void {
  try {
    const inTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!inTauri) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("ui_log", { level: "warn", message: `watchdog: ${message}` })
      )
      .catch(() => undefined);
  } catch {
    // Best effort only.
  }
}

function startWatchdog(set: Setter, get: Getter): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    const s = get();
    if (!s.busy || !s.client || !s.sessionId) return;
    const sinceEvent = Date.now() - (lastSseEventAt || s.turnStatus?.since || 0);
    if (sinceEvent < WATCHDOG_STALE_MS) return;

    // The stream looks dead while a turn is running: recover over HTTP.
    // The core has no per-session status endpoint, so "still busy" is decided
    // from the last assistant message: a turn that ended has a final message
    // with no trailing running tool part.
    void (async () => {
      try {
        logTurnWatchdog(`no SSE events for ${Math.round(sinceEvent / 1000)}s while busy — recovering`);
        markSseAlive(); // do not loop on a stalled channel; one recovery per window
        const messages = await s.client!.messages(s.sessionId!);
        const last = [...messages].reverse().find((m) => m.info.role !== "user");
        const runningTool = last?.parts.some(
          (p) => p.type === "tool" && (p.state?.status === "running" || p.state?.status === "pending")
        );
        const stillBusy = Boolean(runningTool) || messages.length === 0;
        set({
          messages,
          ...(stillBusy
            ? { turnStatus: { type: "busy", since: Date.now() } }
            : { busy: false, turnStatus: null }),
        });
        logTurnWatchdog(
          stillBusy
            ? "core still busy (unfinished tool part) — messages refreshed"
            : "turn finished — busy cleared, messages refreshed"
        );
        if (!stillBusy) void processQueue(set, get);
      } catch {
        // Core unreachable: the connection error path will surface it.
      }
    })();
  }, WATCHDOG_TICK_MS);
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

/**
 * Pull pending permission requests from the core and merge them in.
 *
 * Used on every (re)connect: a prompt that arrived while the stream was down
 * must resurface, or the agent stays paused forever waiting on an answer the
 * UI never saw. Deduplication is by request id, same as live events.
 */
async function syncPendingPermissions(set: Setter, get: Getter) {
  const client = get().client;
  if (!client) return;
  try {
    const pending = (await client.pendingPermissions()) as unknown[];
    if (!Array.isArray(pending) || pending.length === 0) return;
    const requests = pending
      .map((raw) => normalisePermission(isRecord(raw) ? raw : {}))
      .filter((r): r is PermissionRequest => r !== null);
    if (requests.length === 0) return;
    set((state) => {
      const known = new Set(state.permissions.map((p) => p.id));
      const fresh = requests.filter((r) => !known.has(r.id));
      return fresh.length ? { permissions: [...state.permissions, ...fresh] } : {};
    });
  } catch {
    // The core may not expose the endpoint on this version; live SSE events
    // still cover the common case. Not worth an error card.
  }
}

function subscribe(set: Setter, get: Getter) {
  const client = get().client;
  if (!client) return;
  unsubscribe?.();
  unsubscribe = client.subscribe(
    (event) => handleEvent(event, set, get),
    (error) => {
      // A drop is retried with backoff inside the client; record the failure
      // once here. `sseLive` tracks whether the current view trusts the feed.
      set({ busy: false, sseLive: false, lastError: normalizeError(error), errorDetailOpen: false });
    },
    () => {
      // Stream is back: anything the core queued while we were blind must be
      // re-fetched, permissions first (a hung agent is the worst outcome).
      // The drop error card is cleared too — it just healed.
      const wasDead = !get().sseLive;
      set({
        sseLive: true,
        ...(wasDead ? { lastError: null, errorDetailOpen: false } : {}),
      });
      void syncPendingPermissions(set, get);
    },
    // The first successful connection is not a "reconnect", but it must
    // still dismiss a startup error card: the webview's very first fetch can
    // fail while the core is still booting (WebKit "Load failed"), and the
    // client's backoff retry then connects fine. Without this the card hung
    // on screen even though everything works — a false alarm with no action.
    () => {
      if (get().lastError?.source === "network") {
        set({ lastError: null, errorDetailOpen: false });
      }
    }
  );
  void syncPendingPermissions(set, get);
}

/**
 * Task-completion notifications: desktop, sound and ntfy push.
 *
 * The ntfy destination is entirely user-configured, so this stays inside the
 * privacy rule: the user chose where it goes.
 */
function notifyTurnComplete(get: Getter) {
  const { notify, language } = get();
  if (!notify.enabled) return;
  const title = t(language, "status.ready");
  const body = t(language, "chat.empty");

  if (notify.desktop && typeof Notification !== "undefined") {
    if (Notification.permission === "granted") {
      new Notification(`BuzzAgent — ${title}`, { body });
    } else if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }

  if (notify.sound) {
    playCompletionSound(notify.soundId);
  }

  const base = notify.ntfyUrl.trim().replace(/\/+$/, "");
  const topic = notify.ntfyTopic.trim();
  if (base && topic) {
    void fetch(`${base}/${topic}`, {
      method: "POST",
      body: `BuzzAgent: ${title}`,
      headers: { Title: "BuzzAgent" },
    }).catch(() => undefined);
  }
}

/** Sound presets for the completion notification. Each is a tiny
 *  Web Audio oscillator sequence — no audio assets needed. */
const SOUND_PRESETS: Record<string, { notes: number[]; gap: number; dur: number }> = {
  bell: { notes: [880], gap: 0, dur: 0.35 },
  chime: { notes: [660, 880, 990], gap: 0.15, dur: 0.12 },
  ding: { notes: [1100, 880], gap: 0.1, dur: 0.1 },
  beep: { notes: [440], gap: 0, dur: 0.2 },
};

/** Play the completion sound. The AudioContext must be resumed() because
 *  the webview autoplay policy suspends it until a user gesture. We fire it
 *  inside a try/catch so a blocked context never breaks the notification. */
export function playCompletionSound(soundId: string) {
  try {
    const preset = SOUND_PRESETS[soundId] ?? SOUND_PRESETS.bell;
    const ctx = new AudioContext();
    void ctx.resume().then(() => {
      let t0 = ctx.currentTime + 0.05;
      for (const freq of preset.notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.08, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + preset.dur);
        osc.start(t0);
        osc.stop(t0 + preset.dur);
        t0 += preset.gap + preset.dur;
      }
      // Close the context after all notes have played to free resources.
      const totalMs = (preset.gap + preset.dur) * preset.notes.length * 1000 + 100;
      setTimeout(() => void ctx.close(), totalMs);
    });
  } catch {
    // Audio may be blocked entirely; notification still went out.
  }
}

async function processQueue(set: Setter, get: Getter) {
  const { queue, busy } = get();
  if (busy || queue.length === 0) return;
  const next = queue[0];
  set({ queue: queue.slice(1) });
  try {
    await get().send(next.text, { model: next.model, agent: next.agent });
  } catch {
    // send() already classified the failure; keep the queued text visible
    // again instead of silently dropping it with a console line.
    set((state) => ({ queue: [next, ...state.queue] }));
  }
}

/**
 * Apply a core event to the projection.
 *
 * Event names are those the pinned core actually emits (see
 * docs/core-api-notes.md); unknown types are ignored rather than guessed at.
 */
function handleEvent(event: CoreEvent, set: Setter, get: Getter) {
  // Event payloads are version-dependent, so they are read defensively rather
  // than cast to a shape we would have to keep in lockstep with the core.
  const props: EventProps = event.properties ?? {};

  // Feed the watchdog: any event is proof the SSE channel is alive.
  markSseAlive();

  switch (event.type) {
    case "session.created":
    case "session.updated": {
      const info = props.info as Session | undefined;
      if (!info?.id) break;
      set((state) => {
        const others = state.sessions.filter((s) => s.id !== info.id);
        return { sessions: [info, ...others].sort(byRecency) };
      });
      break;
    }

    case "session.deleted": {
      const id = str((props.info as Session | undefined)?.id) ?? str(props.sessionID);
      if (!id) break;
      set((state) => ({ sessions: state.sessions.filter((s) => s.id !== id) }));
      break;
    }

    case "session.idle": {
      if (props.sessionID === get().sessionId) {
        set({ busy: false, turnStatus: null });
        stopWatchdog();
        void processQueue(set, get);
      }
      break;
    }

    // (watchdog lifecycle handled inside the busy/turnStatus setters below)

    /**
     * Authoritative busy/idle signal: `{ sessionID, status: { type, … } }`.
     *
     * Relying on `session.idle` alone left the UI stuck on "working" whenever
     * that single frame was missed (reconnect, or a turn that ends via status
     * only). Verified live shapes: type is "busy" | "idle" | "retry", where
     * retry carries `{ attempt, message, next }` — the provider call failed
     * and the core is waiting to retry (message like "Provider response
     * headers timed out after 300000ms"). Hiding that turned a failing turn
     * into a silent spinner for the whole 5-minute timeout window.
     */
    case "session.status": {
      if (props.sessionID !== get().sessionId) break;
      const status = props.status as
        | { type?: string; message?: string; attempt?: number; next?: number }
        | undefined;
      const type = str(status?.type);
      if (type === "idle") {
        const wasBusy = get().busy;
        set({ busy: false, turnStatus: null });
        stopWatchdog();
        if (wasBusy) notifyTurnComplete(get);
        void processQueue(set, get);
      } else if (type === "retry") {
        set({
          busy: true,
          turnStatus: {
            type,
            message: str(status?.message),
            attempt: typeof status?.attempt === "number" ? status.attempt : undefined,
            since: Date.now(),
          },
        });
        startWatchdog(set, get);
      } else if (type) {
        // Generic "busy" frames must NOT wipe the retry explanation — a
        // provider-timeout message flashing for one frame and then reverting
        // to a bare "Thinking…" is exactly the "I don't have time to see it"
        // report. Keep the previous message/attempt until idle or a new
        // retry frame replaces them.
        const prev = get().turnStatus;
        set({
          busy: true,
          turnStatus: {
            type,
            since: prev?.since ?? Date.now(),
            message: prev?.message,
            attempt: prev?.attempt,
          },
        });
        startWatchdog(set, get);
      }
      break;
    }

    case "session.error": {
      set({ busy: false, turnStatus: null });
      stopWatchdog();
      // The core may deliver the failure as a bare payload in `properties.error`.
      if (isRecord(props.error)) {
        set({
          lastError: normalizeError(props.error, {
            sessionID: str(props.sessionID) ?? get().sessionId ?? undefined,
          }),
          errorDetailOpen: false,
        });
        // A model that no longer exists in the core's catalogue (provider
        // refreshed its list, pinned model renamed) would fail EVERY turn.
        // Drop the dead selection so the composer falls back to a valid one.
        // The core nests the real text under `error.data.message`.
        const raw = props.error as Record<string, unknown>;
        const data = isRecord(raw.data) ? raw.data : {};
        const name = str(raw.name) ?? "";
        const message = `${str(raw.message) ?? ""} ${str(data.message) ?? ""}`;
        if (name.includes("ModelNotFound") || /model not found/i.test(message)) {
          set({ model: null });
        }
      }
      break;
    }

    case "message.updated": {
      const info = props.info as MessageInfo | undefined;
      if (!info?.id || info.sessionID !== get().sessionId) break;
      set((state) => {
        const messages = [...state.messages];
        const index = messages.findIndex((m) => m.info.id === info.id);
        if (index === -1) {
          // Replace the optimistic echo of the same role, if present. The
          // local parts are DROPPED, not kept: they carry no part ids, so the
          // authoritative `message.part.updated` events that follow would not
          // match them and would append a second copy of the same text — the
          // "my prompt appears doubled" bug.
          const optimistic = messages.findIndex(
            (m) => m.info.id.startsWith("local-") && m.info.role === info.role
          );
          if (optimistic !== -1) {
            messages[optimistic] = { info, parts: messages[optimistic].parts };
          } else {
            messages.push({ info, parts: [] });
          }
        } else {
          messages[index] = { ...messages[index], info };
        }
        // Sweep any other optimistic echo of the same role: once a real
        // message lands, a leftover local copy can only be a duplicate (e.g.
        // from a part event having realized the echo earlier).
        const pruned = messages.filter(
          (m) => !(m.info.id.startsWith("local-") && m.info.role === info.role)
        );
        return { messages: pruned };
      });
      // A failed assistant message carries the provider error verbatim.
      if (info.error && info.sessionID === get().sessionId) {
        set({
          lastError: normalizeError(info.error, {
            sessionID: info.sessionID,
            providerID: info.providerID,
            modelID: info.modelID,
            messageID: info.id,
          }),
          errorDetailOpen: false,
        });
      }
      break;
    }

    case "message.part.updated": {
      const part = props.part as Part | undefined;
      if (!part?.type || part.sessionID !== get().sessionId) break;
      // A failed tool call is an OpenCode-reported error too: promote it.
      // Tagged with the message/call ids so the error banner suppresses itself
      // when this tool card already renders the failure inline.
      if (part.type === "tool" && part.state?.status === "error" && part.state.error) {
        set({
          lastError: normalizeError(
            { name: part.tool ?? "Tool", message: part.state.error, data: part.state },
            { sessionID: part.sessionID, messageID: part.messageID, callID: part.callID }
          ),
          errorDetailOpen: false,
        });
      }
      set((state) => {
        const messages = [...state.messages];
        const index = messages.findIndex((m) => m.info.id === part.messageID);
        if (index === -1) {
          // The first token can arrive before message.updated. If a pending
          // optimistic user echo is still waiting to be realized by this very
          // message, adopt it — creating a fresh stub here would leave the
          // echo orphaned and show the prompt twice.
          const echo = messages.findIndex(
            (m) =>
              m.info.id.startsWith("local-") &&
              m.info.role === "user" &&
              m.info.sessionID === part.sessionID &&
              part.type === "text"
          );
          if (echo !== -1) {
            messages[echo] = {
              info: {
                id: part.messageID ?? messages[echo].info.id,
                sessionID: part.sessionID ?? state.sessionId ?? "",
                role: "user",
              },
              parts: [part],
            };
            return { messages };
          }
          // Otherwise create a stub so the list does not stay empty while the
          // agent is working.
          messages.push({
            info: {
              id: part.messageID ?? `unknown-${Date.now()}`,
              sessionID: part.sessionID ?? state.sessionId ?? "",
              role: "assistant",
            },
            parts: [part],
          });
          return { messages };
        }
        // Drop any optimistic placeholder of the same type: the authoritative
        // part replaces it. Without this the echoed text stayed and the real
        // part was appended next to it (prompt rendered twice).
        const parts = messages[index].parts.filter(
          (p) => !(p.id?.startsWith("local-part-") && p.type === part.type)
        );
        const existing = parts.findIndex(
          (p) => (part.id && p.id === part.id) || (part.callID && p.callID === part.callID)
        );
        if (existing === -1) parts.push(part);
        else parts[existing] = { ...parts[existing], ...part };
        messages[index] = { ...messages[index], parts };
        return { messages };
      });
      break;
    }

    /**
     * Incremental token / field append. This is the actual streaming surface —
     * there is no "streaming" toggle in OpenCode config. Verified payload:
     * `{ sessionID, messageID, partID, field, delta }`.
     */
    case "message.part.delta": {
      const sessionID = str(props.sessionID);
      const messageID = str(props.messageID);
      const partID = str(props.partID);
      const field = str(props.field) ?? "text";
      const delta = typeof props.delta === "string" ? props.delta : "";
      if (!sessionID || sessionID !== get().sessionId || !messageID || !partID || !delta) break;
      set((state) => {
        const messages = [...state.messages];
        let index = messages.findIndex((m) => m.info.id === messageID);
        if (index === -1) {
          messages.push({
            info: { id: messageID, sessionID, role: "assistant" },
            parts: [],
          });
          index = messages.length - 1;
        }
        const partType = field === "reasoning" ? "reasoning" : "text";
        const parts = messages[index].parts.filter(
          (p) => !(p.id?.startsWith("local-part-") && p.type === partType)
        );
        const existing = parts.findIndex((p) => p.id === partID);
        if (existing === -1) {
          parts.push({ id: partID, messageID, sessionID, type: partType, text: delta });
        } else {
          const prev = parts[existing];
          parts[existing] = { ...prev, text: (prev.text ?? "") + delta };
        }
        messages[index] = { ...messages[index], parts };
        return { messages };
      });
      break;
    }

    case "message.removed": {
      const id = str(props.messageID);
      if (!id) break;
      set((state) => ({ messages: state.messages.filter((m) => m.info.id !== id) }));
      break;
    }

    // The core emits both the legacy and the v2 permission events depending on
    // version. Missing v2 meant a prompt was never shown and the run appeared
    // to hang forever, so accept every spelling.
    case "permission.updated":
    case "permission.asked":
    case "permission.v2.asked": {
      const request = normalisePermission(props);
      if (!request) break;
      set((state) =>
        state.permissions.some((p) => p.id === request.id)
          ? {}
          : { permissions: [...state.permissions, request] }
      );
      break;
    }

    case "permission.replied":
    case "permission.v2.replied": {
      const id = str(props.requestID) ?? str(props.permissionID) ?? str(props.id);
      if (!id) break;
      set((state) => ({ permissions: state.permissions.filter((p) => p.id !== id) }));
      break;
    }

    case "todo.updated": {
      if (props.sessionID && props.sessionID !== get().sessionId) break;
      if (Array.isArray(props.todos)) set({ todos: props.todos });
      break;
    }

    default: {
      // Catch-all: any other OpenCode event that carries an error-shaped
      // payload must reach the screen, even one we have never seen before.
      // Event names differ across core versions; error payloads do not.
      if (isRecord(props.error)) {
        set({
          lastError: normalizeError(props.error, {
            sessionID: str(props.sessionID) ?? get().sessionId ?? undefined,
          }),
          errorDetailOpen: false,
        });
      }
      break;
    }
  }
}

/**
 * Permission payloads vary by version; accept what we can identify.
 *
 * Legacy shape carries `permission` + `tool`, while v2 carries `action` +
 * `resources` + `source.{messageID,callID}`. Both must render a usable prompt.
 */
function normalisePermission(props: EventProps): PermissionRequest | null {
  // `permission` is an object in some versions but a plain action string in
  // others, so only treat it as the payload when it is actually an object.
  const nested = isRecord(props.permission)
    ? props.permission
    : isRecord(props.info)
      ? props.info
      : undefined;
  const source: EventProps = nested ?? props;
  const id = str(source.id) ?? str(props.permissionID) ?? str(props.requestID);
  const sessionID = str(source.sessionID) ?? str(props.sessionID);
  if (!id || !sessionID) return null;

  const origin = (source.source ?? {}) as EventProps;
  // v2 names the operation `action`; legacy uses `permission` or `tool`.
  const action = str(source.action) ?? str(source.permission) ?? str(source.tool);
  const resources = Array.isArray(source.resources)
    ? (source.resources as unknown[]).filter((r): r is string => typeof r === "string")
    : Array.isArray(source.patterns)
      ? (source.patterns as unknown[]).filter((r): r is string => typeof r === "string")
      : [];

  const metadata = (source.metadata as Record<string, unknown> | undefined) ?? {};
  // Surface the resource list so the prompt shows *what* is being requested.
  const enriched =
    resources.length > 0 ? { ...metadata, resources: resources.join(", ") } : metadata;

  return {
    id,
    sessionID,
    messageID: str(source.messageID) ?? str(origin.messageID),
    callID: str(source.callID) ?? str(origin.callID),
    title: str(source.title) ?? action ?? "Permission required",
    tool: action,
    metadata: enriched,
    time: source.time as { created: number } | undefined,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Choose a sensible starting model *without* implicitly using Zen.
 * Returns null when the user has no provider of their own configured.
 */
export function pickUserProvider(providers: ProviderList): ModelRef | null {
  const connected = providers.connected.filter((id) => id !== "opencode");
  for (const id of connected) {
    const provider = providers.all.find((p) => p.id === id);
    const modelId = providers.default[id] ?? firstModel(provider);
    if (provider && modelId) return { providerID: id, modelID: modelId };
  }
  return null;
}

function firstModel(provider?: Provider): string | undefined {
  if (!provider) return undefined;
  return Object.keys(provider.models)[0];
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
