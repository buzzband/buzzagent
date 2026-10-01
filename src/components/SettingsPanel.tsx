import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Blocks,
  Braces,
  Bell,
  FlaskConical,
  FolderOpen,
  FolderTree,
  Layers,
  Link,
  Mic,
  Brain,
  Check,
  Cpu,
  FileCode2,
  Loader2,
  RotateCcw,
  Save,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { THEME_OPTIONS, useApp, type Theme } from "../store/app";
import { LANGUAGES, t, PROJECT_URL, type Language } from "../lib/i18n";
import { ZOOM_LEVELS } from "../lib/zoom";
import { copyText, appVersion, buildId } from "./ErrorBoundary";
import { CustomProviderDialog, type ProviderDraft } from "./sidebar/CustomProviderDialog";
import { PersonalSyncSection } from "./settings/PersonalSyncSection";
import { OAuthProvidersSection } from "./settings/OAuthProvidersSection";

/** Frame modes for the custom titlebar setting. */

/**
 * Settings.
 *
 * Every option here maps to a real key in the pinned OpenCode config schema.
 * There is deliberately **no "streaming" toggle**: streaming is not a core
 * setting, it is the transport — tokens always arrive as `message.part.delta`
 * events. Inventing a switch for it would be a lie in the UI.
 *
 * Appearance is ours (it is pure UI state). Everything else round-trips
 * through the core's own config file, because `PATCH /config` does not persist.
 */

type Tab =
  | "general"
  | "agent"
  | "context"
  | "permissions"
  | "providers"
  | "modes"
  | "catalog"
  | "sources"
  | "advanced"
  | "notifications"
  | "privacy";

const TABS: { id: Tab; label: string; icon: typeof SettingsIcon }[] = [
  { id: "general", label: "General", icon: SettingsIcon },
  { id: "providers", label: "Providers", icon: Blocks },
  { id: "modes", label: "Modes", icon: Layers },
  { id: "agent", label: "Agent & Models", icon: Cpu },
  { id: "context", label: "Context & Tools", icon: FileCode2 },
  { id: "permissions", label: "Permissions", icon: ShieldCheck },
  { id: "catalog", label: "Catalog", icon: Blocks },
  { id: "sources", label: "Files & Skills", icon: FolderTree },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "advanced", label: "Advanced", icon: FlaskConical },
  { id: "privacy", label: "Privacy & Logs", icon: ScrollText },
];

/** Tools the core can gate behind a permission prompt. */
const PERMISSION_ACTIONS = [
  { id: "bash", label: "Run shell commands", danger: true },
  { id: "edit", label: "Edit files", danger: true },
  { id: "external_directory", label: "Access files outside the project", danger: true },
  { id: "webfetch", label: "Fetch web pages" },
  { id: "websearch", label: "Web search" },
  { id: "read", label: "Read files" },
  { id: "grep", label: "Search file contents" },
  { id: "glob", label: "Match file paths" },
  { id: "list", label: "List directories" },
  { id: "task", label: "Spawn subagents" },
  { id: "skill", label: "Use skills" },
  { id: "lsp", label: "Language server queries" },
];

const PERMISSION_CHOICES = ["ask", "allow", "deny"] as const;
type PermissionChoice = (typeof PERMISSION_CHOICES)[number];

const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;

type Settings = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): string {
  return typeof value === "number" ? String(value) : "";
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    theme,
    setTheme,
    frameMode,
    setFrameMode,
    zoomIndex,
    changeZoom,
    pinnedVersion,
    core,
    providers,
    language,
    setLanguage,
    voice,
    setVoice,
    notify,
    setNotify,
    agents,
    customProviders,
    deleteProvider,
    loadAgents,
    settingsInitialTab,
  } = useApp(
    useShallow((s) => ({
      theme: s.theme,
      setTheme: s.setTheme,
      frameMode: s.frameMode,
      setFrameMode: s.setFrameMode,
      zoomIndex: s.zoomIndex,
      changeZoom: s.changeZoom,
      pinnedVersion: s.pinnedVersion,
      core: s.core,
      providers: s.providers,
      language: s.language,
      setLanguage: s.setLanguage,
      voice: s.voice,
      setVoice: s.setVoice,
      notify: s.notify,
      setNotify: s.setNotify,
      agents: s.agents,
      customProviders: s.customProviders,
      deleteProvider: s.deleteProvider,
      loadAgents: s.loadAgents,
      settingsInitialTab: s.settingsInitialTab,
    }))
  );
  const [tab, setTab] = useState<Tab>("general");
  const [siteCopied, setSiteCopied] = useState(false);
  const [trayOn, setTrayOn] = useState<boolean>(
    () => localStorage.getItem("buzzagent.tray_enabled") === "true"
  );
  const [providerDialog, setProviderDialog] = useState<{
    open: boolean;
    initial: ProviderDraft | null;
  }>({ open: false, initial: null });

  // Honor deep links like Settings → Providers from gear buttons.
  useEffect(() => {
    if (open && settingsInitialTab) {
      setTab(settingsInitialTab as Tab);
    }
  }, [open, settingsInitialTab]);

  const customProviderIds = Object.keys(customProviders);

  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rawText, setRawText] = useState("");
  const [rawDirty, setRawDirty] = useState(false);
  const [modeForm, setModeForm] = useState({ name: "", description: "", prompt: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await invoke<Settings>("core_read_settings");
      setSettings(loaded);
      setRawText(JSON.stringify(loaded, null, 2));
      setRawDirty(false);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const update = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const updateNested = (parent: string, key: string, value: unknown) => {
    setSettings((prev) => {
      const next = { ...record(prev[parent]) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return { ...prev, [parent]: next };
    });
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("core_write_settings", { patch: settings });
      setDirty(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      await load();
      // Mode chips read the agent list from the core: refresh after saves.
      await loadAgents();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const permissions = record(settings.permission);
  const compaction = record(settings.compaction);
  const toolOutput = record(settings.tool_output);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[82vh] w-full max-w-3xl overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tabs */}
        <nav className="flex w-48 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
          <div className="mb-2 flex items-center gap-1.5 px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
            <SettingsIcon size={12} />
            Settings
          </div>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
                tab === entry.id
                  ? "bg-[var(--bg-active)] font-medium text-[var(--fg-primary)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <entry.icon size={13} />
              {entry.label}
            </button>
          ))}

          <div className="mt-auto px-2 py-1 text-2xs text-[var(--fg-muted)]">
            core {core?.version ?? pinnedVersion ?? "unknown"}
          </div>
        </nav>

        {/* Body */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
              {TABS.find((t) => t.id === tab)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
            >
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {error && (
              <div
                role="alert"
                className="mb-3 flex items-start gap-2 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]"
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {loading ? (
              <div className="flex items-center gap-2 py-8 text-xs text-[var(--fg-muted)]">
                <Loader2 size={14} className="animate-spin" />
                Loading core settings…
              </div>
            ) : (
              <>

                {tab === "agent" && (
                  <>
                    <Section
                      title="Default model"
                      hint="Used when a session does not specify one. Format: provider/model."
                    >
                      <TextField
                        value={asString(settings.model)}
                        placeholder="anthropic/claude-sonnet-4-5"
                        onChange={(v) => update("model", v || null)}
                        mono
                      />
                    </Section>

                    <Section
                      title="Small model"
                      hint="Cheap model for side tasks like session titles. Point this at your own provider so nothing implicitly goes to a hosted gateway."
                    >
                      <TextField
                        value={asString(settings.small_model)}
                        placeholder="ollama/qwen3"
                        onChange={(v) => update("small_model", v || null)}
                        mono
                      />
                    </Section>

                    <Section title="Default agent" hint="Which agent a new session starts with.">
                      <TextField
                        value={asString(settings.default_agent)}
                        placeholder="build"
                        onChange={(v) => update("default_agent", v || null)}
                        mono
                      />
                    </Section>

                    <Section
                      title="Subagent depth"
                      hint="How deep agents may nest. 0 disables subagents."
                    >
                      <NumberField
                        value={asNumber(settings.subagent_depth)}
                        min={0}
                        placeholder="1"
                        onChange={(v) => update("subagent_depth", v)}
                      />
                    </Section>

                    <Section
                      title="Reasoning"
                      hint="Reasoning is a per-model capability, not a global slider. Enable it per model when adding a provider; the core decides how many thinking tokens to spend."
                    >
                      <div className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-2xs text-[var(--fg-muted)]">
                        <Brain size={13} className="shrink-0 text-[var(--accent)]" />
                        Configure it in Models → Add provider.
                      </div>
                    </Section>
                  </>
                )}

                {tab === "context" && (
                  <>
                    <Section
                      title="Automatic compaction"
                      hint="Summarise older turns as the context window fills, instead of failing a long session."
                    >
                      <Toggle
                        checked={asBool(compaction.auto, true)}
                        onChange={(v) => updateNested("compaction", "auto", v)}
                        label="Compact automatically"
                      />
                      <Toggle
                        checked={asBool(compaction.prune, false)}
                        onChange={(v) => updateNested("compaction", "prune", v)}
                        label="Prune stale tool output when compacting"
                      />
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <LabelledNumber
                          label="Keep recent turns"
                          value={asNumber(compaction.tail_turns)}
                          placeholder="2"
                          onChange={(v) => updateNested("compaction", "tail_turns", v)}
                        />
                        <LabelledNumber
                          label="Reserve tokens"
                          value={asNumber(compaction.reserved)}
                          placeholder="4000"
                          onChange={(v) => updateNested("compaction", "reserved", v)}
                        />
                      </div>
                    </Section>

                    <Section
                      title="Tool output limits"
                      hint="Caps how much a single tool result may add to the context."
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        <LabelledNumber
                          label="Max lines"
                          value={asNumber(toolOutput.max_lines)}
                          placeholder="1000"
                          onChange={(v) => updateNested("tool_output", "max_lines", v)}
                        />
                        <LabelledNumber
                          label="Max bytes"
                          value={asNumber(toolOutput.max_bytes)}
                          placeholder="51200"
                          onChange={(v) => updateNested("tool_output", "max_bytes", v)}
                        />
                      </div>
                    </Section>

                    <Section
                      title="Snapshots"
                      hint="Lets the core revert agent edits. Turning this off makes changes harder to undo."
                    >
                      <Toggle
                        checked={asBool(settings.snapshot, true)}
                        onChange={(v) => update("snapshot", v)}
                        label="Keep snapshots for revert"
                      />
                    </Section>

                    <Section
                      title="Shell"
                      hint="Shell used for the bash tool. Empty means the system default."
                    >
                      <TextField
                        value={asString(settings.shell)}
                        placeholder="/bin/bash"
                        onChange={(v) => update("shell", v || null)}
                        mono
                      />
                    </Section>

                    <Section
                      title="Language servers & formatters"
                      hint="LSP gives the agent IDE-grade understanding; formatters keep edits consistent."
                    >
                      <Toggle
                        checked={asBool(settings.lsp, true)}
                        onChange={(v) => update("lsp", v)}
                        label="Enable LSP"
                      />
                      <Toggle
                        checked={asBool(settings.formatter, true)}
                        onChange={(v) => update("formatter", v)}
                        label="Enable formatters"
                      />
                    </Section>
                  </>
                )}

                {tab === "permissions" && (
                  <Section
                    title="Tool permissions"
                    hint="“Ask” prompts you in the chat before the agent acts. Shell and file edits default to asking on purpose."
                  >
                    <div className="space-y-1">
                      {PERMISSION_ACTIONS.map((action) => {
                        const current =
                          (asString(permissions[action.id]) as PermissionChoice) || "ask";
                        return (
                          <div
                            key={action.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5"
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 text-xs text-[var(--fg-primary)]">
                                {action.danger && (
                                  <Terminal size={11} className="shrink-0 text-[var(--warning)]" />
                                )}
                                {action.label}
                              </span>
                              <span className="block font-mono text-2xs text-[var(--fg-muted)]">
                                {action.id}
                              </span>
                            </span>

                            <div className="flex shrink-0 gap-0.5 rounded-md bg-[var(--bg-base)] p-0.5">
                              {PERMISSION_CHOICES.map((choice) => (
                                <button
                                  key={choice}
                                  type="button"
                                  onClick={() => updateNested("permission", action.id, choice)}
                                  className={`rounded px-2 py-0.5 text-2xs capitalize transition-colors ${
                                    current === choice
                                      ? choice === "deny"
                                        ? "bg-[var(--danger)] text-white"
                                        : choice === "allow"
                                          ? "bg-[var(--success)] text-white"
                                          : "bg-[var(--accent)] text-[var(--accent-fg)]"
                                      : "text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                                  }`}
                                >
                                  {choice}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                )}

                {tab === "catalog" && (
                  <Section
                    title="Provider catalogue"
                    hint="The core knows every provider in models.dev. Hidden providers stay configured but disappear from pickers."
                  >
                    <ListEditor
                      label="Hidden providers (disabled_providers)"
                      values={asStrings(settings.disabled_providers)}
                      onChange={(values) => update("disabled_providers", values.length ? values : null)}
                      addSuggestions={(providers?.all ?? [])
                        .map((p) => p.id)
                        .filter((id) => !asStrings(settings.disabled_providers).includes(id))}
                      mono
                    />
                    <div className="mt-3">
                      <ListEditor
                        label="Explicitly enabled (enabled_providers)"
                        hint="Empty means all are allowed."
                        values={asStrings(settings.enabled_providers)}
                        onChange={(values) => update("enabled_providers", values.length ? values : null)}
                        addSuggestions={(providers?.all ?? [])
                          .map((p) => p.id)
                          .filter((id) => !asStrings(settings.enabled_providers).includes(id))}
                        mono
                      />
                    </div>
                  </Section>
                )}

                {tab === "sources" && (
                  <>
                    <Section
                      title="Instruction files"
                      hint="Extra AGENTS.md-style files the core always reads. Paths or globs, relative to the project."
                    >
                      <ListEditor
                        label="instructions"
                        values={asStrings(settings.instructions)}
                        onChange={(values) => update("instructions", values.length ? values : null)}
                        placeholder="docs/conventions.md"
                      />
                    </Section>

                    <Section
                      title="Skill sources"
                      hint="Directories (or URLs) to scan for skills on top of the project's own .opencode/skill."
                    >
                      <ListEditor
                        label="skills.paths"
                        values={asStrings(record(settings.skills).paths)}
                        onChange={(values) =>
                          updateNested("skills", "paths", values.length ? values : null)
                        }
                        placeholder="/home/me/my-skills"
                      />
                      <div className="mt-3">
                        <ListEditor
                          label="skills.urls"
                          values={asStrings(record(settings.skills).urls)}
                          onChange={(values) =>
                            updateNested("skills", "urls", values.length ? values : null)
                          }
                          placeholder="https://example.com/skill.tar.gz"
                          mono
                        />
                      </div>
                    </Section>

                    <Section
                      title="Plugins"
                      hint="npm packages loaded by the core (name, or [name, options] pairs — pairs via raw JSON)."
                    >
                      <ListEditor
                        label="plugin"
                        values={asStrings(settings.plugin)}
                        onChange={(values) => update("plugin", values.length ? values : null)}
                        placeholder="my-opencode-plugin"
                        mono
                      />
                    </Section>

                    <Section
                      title="File watcher"
                      hint="Globs the project watcher should ignore."
                    >
                      <ListEditor
                        label="watcher.ignore"
                        values={asStrings(record(settings.watcher).ignore)}
                        onChange={(values) =>
                          updateNested("watcher", "ignore", values.length ? values : null)
                        }
                        placeholder="dist/**"
                      />
                    </Section>
                  </>
                )}

                {tab === "advanced" && (
                  <>
                    <Section
                      title="Experimental flags"
                      hint="These belong to the core and may change between versions."
                    >
                      {(() => {
                        const exp = record(settings.experimental);
                        return (
                          <div className="space-y-1">
                            <Toggle
                              checked={asBool(exp.batch_tool, false)}
                              onChange={(v) => updateNested("experimental", "batch_tool", v)}
                              label="batch_tool"
                            />
                            <Toggle
                              checked={asBool(exp.disable_paste_summary, false)}
                              onChange={(v) => updateNested("experimental", "disable_paste_summary", v)}
                              label="disable_paste_summary"
                            />
                            <Toggle
                              checked={asBool(exp.continue_loop_on_deny, false)}
                              onChange={(v) => updateNested("experimental", "continue_loop_on_deny", v)}
                              label="continue_loop_on_deny"
                            />
                            <LabelledNumber
                              label="mcp_timeout (seconds)"
                              value={asNumber(exp.mcp_timeout)}
                              placeholder="60"
                              onChange={(v) => updateNested("experimental", "mcp_timeout", v)}
                            />
                            <ListEditor
                              label="primary_tools"
                              values={asStrings(exp.primary_tools)}
                              onChange={(values) =>
                                updateNested("experimental", "primary_tools", values.length ? values : null)
                              }
                              mono
                            />
                          </div>
                        );
                      })()}
                    </Section>

                    <Section
                      title="Enterprise endpoint"
                      hint="Only relevant for OpenCode enterprise deployments."
                    >
                      <TextField
                        value={asString(record(settings.enterprise).url)}
                        placeholder="https://opencode.ai/enterprise"
                        onChange={(v) => update("enterprise", v ? { url: v } : null)}
                        mono
                      />
                    </Section>

                    <Section
                      title="Raw config (everything)"
                      hint="The complete file, verbatim — agents, commands, per-server LSP and formatter maps, attachment, references, server. JSON is validated before saving."
                    >
                      <textarea
                        value={rawText}
                        onChange={(e) => {
                          setRawText(e.target.value);
                          setRawDirty(true);
                        }}
                        spellCheck={false}
                        rows={18}
                        className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 font-mono text-2xs leading-relaxed text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={!rawDirty}
                        onClick={async () => {
                          try {
                            const parsed = JSON.parse(rawText) as Settings;
                            await invoke("core_replace_settings", { value: parsed });
                            setRawDirty(false);
                            await load();
                          } catch (e) {
                            setError(
                              e instanceof SyntaxError
                                ? `Invalid JSON: ${e.message}`
                                : e instanceof Error
                                  ? e.message
                                  : String(e)
                            );
                          }
                        }}
                        className="mt-2 flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
                      >
                        <Braces size={13} />
                        Replace whole config
                      </button>
                    </Section>
                  </>
                )}

                {tab === "general" && (
                  <>
                    <Section title={t(language, "about.title")}>
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🐝</span>
                          <span className="text-sm font-semibold text-[var(--fg-primary)]">
                            BuzzAgent
                          </span>
                          <span className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 font-mono text-2xs text-[var(--fg-muted)]">
                            v{appVersion()}
                          </span>
                          <span className="font-mono text-2xs text-[var(--fg-muted)]">
                            build {buildId()}
                          </span>
                        </div>
                        <p className="mt-2 text-2xs leading-relaxed text-[var(--fg-secondary)]">
                          {t(language, "about.tagline")}
                        </p>
                        <p className="mt-1 text-2xs leading-relaxed text-[var(--fg-muted)]">
                          {t(language, "about.licenseLine")}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              if (await copyText(PROJECT_URL)) {
                                setSiteCopied(true);
                                setTimeout(() => setSiteCopied(false), 1500);
                              }
                            }}
                            title={t(language, "about.siteHint")}
                            className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-2xs text-[var(--accent)] transition-colors hover:border-[var(--border-default)]"
                          >
                            <Link size={11} />
                            {PROJECT_URL.replace("https://", "")}
                            <span className="text-[var(--fg-muted)]">
                              {siteCopied ? t(language, "about.copied") : t(language, "about.copy")}
                            </span>
                          </button>
                          <a
                            href="https://github.com/buzzband/buzzagent"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              if ("__TAURI_INTERNALS__" in window) e.preventDefault();
                            }}
                            className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--fg-primary)]"
                          >
                            <FolderOpen size={11} />
                            {t(language, "about.source")}
                          </a>
                        </div>
                        {pinnedVersion && (
                          <p className="mt-2 text-2xs text-[var(--fg-muted)]">
                            agent core: opencode {pinnedVersion}
                          </p>
                        )}
                      </div>
                    </Section>

                    <Section title={t(language, "settings.theme")}>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {THEME_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => setTheme(option.id as Theme)}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                              theme === option.id
                                ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                                : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]"
                            }`}
                          >
                            <span>
                              <span className="block text-xs font-medium text-[var(--fg-primary)]">
                                {option.label}
                              </span>
                              <span className="block text-2xs text-[var(--fg-muted)]">
                                {option.description}
                              </span>
                            </span>
                            {theme === option.id && (
                              <Check size={14} className="shrink-0 text-[var(--accent)]" />
                            )}
                          </button>
                        ))}
                      </div>
                    </Section>

                    <Section title={t(language, "settings.frameMode")}>
                      <p className="mb-2 text-2xs text-[var(--fg-muted)]">
                        {t(language, "settings.frameModeHint")}
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {(["system", "custom"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setFrameMode(mode)}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                              frameMode === mode
                                ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                                : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]"
                            }`}
                          >
                            <span>
                              <span className="block text-xs font-medium text-[var(--fg-primary)]">
                                {t(
                                  language,
                                  mode === "system" ? "settings.frameSystem" : "settings.frameCustom"
                                )}
                              </span>
                            </span>
                            {frameMode === mode && (
                              <Check size={14} className="shrink-0 text-[var(--accent)]" />
                            )}
                          </button>
                        ))}
                      </div>
                    </Section>

                    <Section title={t(language, "settings.zoom")}>
                      <p className="mb-2 text-2xs text-[var(--fg-muted)]">
                        {t(language, "settings.zoomHint")}
                      </p>
                      <div
                        className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-2xs text-[var(--fg-muted)]"
                        aria-hidden
                      >
                        {(
                          [
                            ["Ctrl", "+"],
                            ["Ctrl", "−"],
                            ["Ctrl", "0"],
                          ] as const
                        ).map(([mod, key]) => (
                          <span key={key} className="flex items-center gap-0.5">
                            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 py-0.5 font-mono text-2xs text-[var(--fg-secondary)]">
                              {mod}
                            </kbd>
                            <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-2xs text-[var(--fg-secondary)]">
                              {key}
                            </kbd>
                          </span>
                        ))}
                        <span className="flex items-center gap-0.5">
                          <kbd className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 py-0.5 font-mono text-2xs text-[var(--fg-secondary)]">
                            Ctrl
                          </kbd>
                          <span className="text-[var(--fg-muted)]">+</span>
                          {t(language, "settings.zoomWheel")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => changeZoom("out")}
                          className="flex size-7 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
                          aria-label="-"
                        >
                          −
                        </button>
                        <span className="min-w-14 text-center text-xs font-medium text-[var(--fg-primary)]">
                          {Math.round(ZOOM_LEVELS[zoomIndex] * 100)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => changeZoom("in")}
                          className="flex size-7 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
                          aria-label="+"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => changeZoom("reset")}
                          className="ml-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)]"
                        >
                          {t(language, "settings.zoomReset")}
                        </button>
                      </div>
                    </Section>

                    <Section title={t(language, "settings.trayIcon")}>
                      <p className="mb-2 text-2xs text-[var(--fg-muted)]">
                        {t(language, "settings.trayHint")}
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {([true, false] as const).map((enabled) => (
                          <button
                            key={String(enabled)}
                            type="button"
                            onClick={() => {
                              setTrayOn(enabled);
                              localStorage.setItem(
                                "buzzagent.tray_enabled",
                                JSON.stringify(enabled)
                              );
                              void invoke("app_toggle_tray", { enabled }).catch(() => undefined);
                            }}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                              trayOn === enabled
                                ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                                : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]"
                            }`}
                          >
                            <span className="block text-xs font-medium text-[var(--fg-primary)]">
                              {t(language, enabled ? "settings.trayOn" : "settings.trayOff")}
                            </span>
                            {trayOn === enabled && (
                              <Check size={14} className="shrink-0 text-[var(--accent)]" />
                            )}
                          </button>
                        ))}
                      </div>
                    </Section>

                    <Section title={t(language, "settings.language")}>
                      <div className="flex flex-wrap gap-1">
                        {LANGUAGES.map((lang) => (
                          <button
                            key={lang.id}
                            type="button"
                            onClick={() => setLanguage(lang.id as Language)}
                            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                              language === lang.id
                                ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                                : "border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                            }`}
                          >
                            {lang.label}
                          </button>
                        ))}
                      </div>
                    </Section>

                    <Section title={t(language, "voice.title")} hint={t(language, "voice.hint")}>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="text-2xs text-[var(--fg-muted)]">
                            {t(language, "voice.endpoint")}
                          </span>
                          <input
                            type="url"
                            value={voice.endpoint}
                            onChange={(e) => setVoice({ endpoint: e.target.value })}
                            placeholder="http://127.0.0.1:8080/inference"
                            className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="text-2xs text-[var(--fg-muted)]">
                            {t(language, "voice.model")}
                          </span>
                          <input
                            type="text"
                            value={voice.model}
                            onChange={(e) => setVoice({ model: e.target.value })}
                            placeholder="whisper-1"
                            className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-2xs text-[var(--fg-muted)]">
                        <Mic size={11} />
                        Runs locally: whisper.cpp / faster-whisper / LocalAI.
                      </p>
                    </Section>
                  </>
                )}

                {tab === "providers" && (
                  <>
                  <OAuthProvidersSection connected={providers?.connected ?? []} />
                  <div className="h-4" />
                  <PersonalSyncSection />
                  <div className="h-4" />
                  <Section
                    title={t(language, "tab.providers")}
                    hint="Edit connection details, model lists and reasoning flags. Removing a provider also clears its stored key."
                  >
                    {customProviderIds.length === 0 && (
                      <p className="mb-2 text-xs text-[var(--fg-muted)]">
                        No custom providers yet.
                      </p>
                    )}
                    <div className="mb-3 space-y-1">
                      {customProviderIds.map((id) => {
                        const def = customProviders[id];
                        const options = (def.options ?? {}) as Record<string, unknown>;
                        const models = (def.models ?? {}) as Record<string, unknown>;
                        const draft: ProviderDraft = {
                          id,
                          name: typeof def.name === "string" ? def.name : id,
                          baseUrl: typeof options.baseURL === "string" ? options.baseURL : "",
                          apiKey: typeof options.apiKey === "string" ? options.apiKey : undefined,
                          models: models as ProviderDraft["models"],
                        };
                        return (
                          <div
                            key={id}
                            className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-medium text-[var(--fg-primary)]">
                                {draft.name}
                              </div>
                              <div className="truncate font-mono text-2xs text-[var(--fg-muted)]">
                                {draft.baseUrl} · {Object.keys(models).length} model
                                {Object.keys(models).length === 1 ? "" : "s"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setProviderDialog({ open: true, initial: draft })}
                              className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-2xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                            >
                              {t(language, "common.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Remove provider "${draft.name}"?`)) {
                                  void deleteProvider(id);
                                }
                              }}
                              className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-2xs text-[var(--fg-muted)] hover:border-[var(--danger)]/40 hover:text-[var(--danger)]"
                            >
                              {t(language, "common.delete")}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setProviderDialog({ open: true, initial: null })}
                      className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
                    >
                      + Add provider
                    </button>
                  </Section>
                  </>
                )}

                {tab === "modes" && (
                  <Section title={t(language, "modes.title")} hint={t(language, "modes.hint")}>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {agents.map((agent) => (
                        <span
                          key={agent.name}
                          title={agent.description}
                          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1 font-mono text-2xs text-[var(--fg-secondary)]"
                        >
                          {agent.name}
                        </span>
                      ))}
                    </div>
                    <div className="mb-3 space-y-1">
                      {Object.entries(record(settings.agent)).map(([name, def]) => {
                        const cfg = record(def);
                        return (
                          <div
                            key={name}
                            className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-xs font-medium text-[var(--fg-primary)]">
                                {name}
                              </div>
                              <div className="truncate text-2xs text-[var(--fg-muted)]">
                                {(asString(cfg.description) || asString(cfg.prompt)).slice(0, 90) ||
                                  "no prompt"}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setModeForm({
                                  name,
                                  description: asString(cfg.description),
                                  prompt: asString(cfg.prompt),
                                })
                              }
                              className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-2xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                            >
                              {t(language, "common.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                // Deep merge: null deletes this mode only.
                                update("agent", { [name]: null });
                              }}
                              className="rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-2xs text-[var(--fg-muted)] hover:border-[var(--danger)]/40 hover:text-[var(--danger)]"
                            >
                              {t(language, "common.delete")}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!modeForm.name.trim()) return;
                        const next = { ...record(settings.agent) };
                        next[modeForm.name.trim()] = {
                          mode: "primary",
                          description: modeForm.description.trim(),
                          prompt: modeForm.prompt.trim(),
                        };
                        update("agent", next);
                        setModeForm({ name: "", description: "", prompt: "" });
                      }}
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3"
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="text-2xs text-[var(--fg-muted)]">
                            {t(language, "modes.name")}
                          </span>
                          <input
                            type="text"
                            value={modeForm.name}
                            onChange={(e) =>
                              setModeForm((prev) => ({ ...prev, name: e.target.value }))
                            }
                            placeholder="reviewer"
                            required
                            className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="text-2xs text-[var(--fg-muted)]">Description</span>
                          <input
                            type="text"
                            value={modeForm.description}
                            onChange={(e) =>
                              setModeForm((prev) => ({ ...prev, description: e.target.value }))
                            }
                            placeholder="Reviews PRs for style violations"
                            className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                      </div>
                      <label className="mt-2 block">
                        <span className="text-2xs text-[var(--fg-muted)]">
                          {t(language, "modes.prompt")}
                        </span>
                        <textarea
                          rows={4}
                          value={modeForm.prompt}
                          onChange={(e) =>
                            setModeForm((prev) => ({ ...prev, prompt: e.target.value }))
                          }
                          placeholder="You are a strict code reviewer…"
                          className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                        />
                      </label>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={!modeForm.name.trim()}
                          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
                        >
                          {modeForm.name && record(settings.agent)[modeForm.name.trim()]
                            ? t(language, "common.save")
                            : t(language, "modes.new")}
                        </button>
                        {modeForm.name && (
                          <button
                            type="button"
                            onClick={() => setModeForm({ name: "", description: "", prompt: "" })}
                            className="text-2xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                          >
                            {t(language, "common.cancel")}
                          </button>
                        )}
                      </div>
                    </form>
                  </Section>
                )}

                {tab === "notifications" && (
                  <Section
                    title={t(language, "tab.notifications")}
                    hint="Fires when an agent turn finishes. ntfy goes only to the server you name here."
                  >
                    <div className="space-y-1">
                      <Toggle
                        checked={notify.enabled}
                        onChange={(v) => setNotify({ enabled: v })}
                        label={t(language, "notify.enable")}
                      />
                      <Toggle
                        checked={notify.desktop}
                        onChange={(v) => setNotify({ desktop: v })}
                        label={t(language, "notify.desktop")}
                      />
                      <Toggle
                        checked={notify.sound}
                        onChange={(v) => setNotify({ sound: v })}
                        label={t(language, "notify.sound")}
                      />
                      <Toggle
                        checked={Boolean(notify.ntfyUrl && notify.ntfyTopic)}
                        onChange={(v) =>
                          setNotify(
                            v
                              ? { ntfyUrl: notify.ntfyUrl || "https://ntfy.sh", ntfyTopic: notify.ntfyTopic || "buzzagent" }
                              : { ntfyUrl: "", ntfyTopic: "" }
                          )
                        }
                        label={t(language, "notify.ntfy")}
                      />
                    </div>
                    {notify.ntfyUrl && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="text-2xs text-[var(--fg-muted)]">
                            {t(language, "notify.ntfyUrl")}
                          </span>
                          <input
                            type="url"
                            value={notify.ntfyUrl}
                            onChange={(e) => setNotify({ ntfyUrl: e.target.value })}
                            placeholder="https://ntfy.sh"
                            className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                        <label className="block">
                          <span className="text-2xs text-[var(--fg-muted)]">
                            {t(language, "notify.ntfyTopic")}
                          </span>
                          <input
                            type="text"
                            value={notify.ntfyTopic}
                            onChange={(e) => setNotify({ ntfyTopic: e.target.value })}
                            placeholder="buzzagent"
                            className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                          />
                        </label>
                      </div>
                    )}
                  </Section>
                )}

                {tab === "privacy" && (
                  <>
                    <Section
                      title="Privacy"
                      hint="These two are enforced by BuzzAgent and cannot be turned on from the UI."
                    >
                      <div className="space-y-1.5">
                        <LockedRow label="Conversation sharing" value="disabled" />
                        <LockedRow label="Session auto-share (autoshare)" value="off" />
                        <LockedRow label="OpenTelemetry export" value="off" />
                        <LockedRow label="Core auto-update" value="off" />
                      </div>
                      <p className="mt-2 text-2xs text-[var(--fg-muted)]">
                        No analytics, no tracking, no crash reporting. At startup the core
                        downloads a model catalogue from opencode.ai; nothing about your code
                        is sent.
                      </p>
                    </Section>

                    <Section title="Log level" hint="Verbosity of the core log.">
                      <div className="flex gap-1">
                        {LOG_LEVELS.map((level) => {
                          const active = asString(settings.logLevel) === level;
                          return (
                            <button
                              key={level}
                              type="button"
                              onClick={() => update("logLevel", active ? null : level)}
                              className={`rounded-md px-2.5 py-1 text-2xs font-medium transition-colors ${
                                active
                                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                                  : "border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                              }`}
                            >
                              {level}
                            </button>
                          );
                        })}
                      </div>
                    </Section>

                    <Section
                      title="Username"
                      hint="Name the agent uses for you. Local only."
                    >
                      <TextField
                        value={asString(settings.username)}
                        placeholder="your name"
                        onChange={(v) => update("username", v || null)}
                      />
                    </Section>
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">
            <span className="flex items-center gap-1.5 text-2xs text-[var(--fg-muted)]">
              {saved ? (
                <>
                  <Check size={12} className="text-[var(--success)]" />
                  Saved to the core config
                </>
              ) : dirty ? (
                <>
                  <Sparkles size={12} className="text-[var(--warning)]" />
                  Unsaved changes
                </>
              ) : (
                "Settings are stored in the core config file"
              )}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading || saving}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40"
              >
                <RotateCcw size={12} />
                Revert
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !dirty}
                className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                Save
              </button>
            </div>
          </div>
        </div>
        <CustomProviderDialog
          open={providerDialog.open}
          initial={providerDialog.initial}
          onClose={() => setProviderDialog({ open: false, initial: null })}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h4 className="text-xs font-semibold text-[var(--fg-primary)]">{title}</h4>
      {hint && <p className="mt-0.5 mb-2 text-2xs text-[var(--fg-muted)]">{hint}</p>}
      {children}
    </section>
  );
}

function TextField({
  value,
  placeholder,
  onChange,
  mono,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none ${
        mono ? "font-mono" : ""
      }`}
    />
  );
}

/** Empty input clears the key so the core falls back to its own default. */
function NumberField({
  value,
  min,
  placeholder,
  onChange,
}: {
  value: string;
  min?: number;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? null : Number(raw));
      }}
      className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
    />
  );
}

function LabelledNumber({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-2xs text-[var(--fg-muted)]">{label}</span>
      <span className="mt-1 block">
        <NumberField value={value} placeholder={placeholder} onChange={onChange} min={0} />
      </span>
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5">
      <span className="text-xs text-[var(--fg-primary)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
          checked ? "bg-[var(--accent)]" : "bg-[var(--bg-overlay)]"
        }`}
      >
        <span
          className={`pointer-events-none inline-block size-4 transform rounded-full bg-white transition ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--success)]/30 bg-[var(--success-subtle)] px-3 py-1.5">
      <span className="text-xs text-[var(--fg-primary)]">{label}</span>
      <span className="flex items-center gap-1 font-mono text-2xs text-[var(--success)]">
        <ShieldCheck size={12} />
        {value}
      </span>
    </div>
  );
}


/** Editable string list with optional suggestions drawn from the live catalogue. */
function ListEditor({
  label,
  hint,
  values,
  onChange,
  addSuggestions,
  placeholder,
  mono,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  addSuggestions?: string[];
  placeholder?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");

  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setDraft("");
    setFilter("");
  };

  const remaining = (addSuggestions ?? []).filter((s) => !values.includes(s));

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs text-[var(--fg-secondary)]">{label}</span>
        <span className="text-2xs text-[var(--fg-muted)]">{values.length}</span>
      </div>
      {hint && <p className="mt-0.5 text-2xs text-[var(--fg-muted)]">{hint}</p>}

      {values.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {values.map((entry) => (
            <li
              key={entry}
              className="group flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-[var(--bg-hover)]"
            >
              <span
                className={`min-w-0 flex-1 truncate text-xs text-[var(--fg-primary)] ${mono ? "font-mono" : ""}`}
              >
                {entry}
              </span>
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== entry))}
                className="shrink-0 rounded p-0.5 text-[var(--fg-muted)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover:opacity-100"
                aria-label={`Remove ${entry}`}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1.5 flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder={placeholder ?? "Add entry…"}
          className={`min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none ${
            mono ? "font-mono" : ""
          }`}
        />
        <button
          type="button"
          onClick={() => add(draft)}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md bg-[var(--bg-raised)] px-2.5 py-1 text-2xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {remaining.length > 0 && (
        <div className="mt-1.5">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter suggestions…"
            className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-0.5 text-2xs text-[var(--fg-secondary)] focus:outline-none"
          />
          <div className="mt-1 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
            {remaining
              .filter((s) => s.toLowerCase().includes(filter.toLowerCase()))
              .slice(0, 40)
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => add(s)}
                  className={`rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-2xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] ${mono ? "font-mono" : ""}`}
                >
                  {s}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
