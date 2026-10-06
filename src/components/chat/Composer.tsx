import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BellOff,
  BellRing,
  Brain,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  Mic,
  MicOff,
  Settings,
  Square,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../../store/app";
import { REASONING_LEVELS, type ReasoningLevel } from "../../store/app";
import { t } from "../../lib/i18n";
import { BUILTINS } from "../../lib/builtinCommands";
import { toast } from "sonner";
import { MessageQueue } from "./MessageQueue";
import { ComposerModelPicker } from "./ComposerModelPicker";
/** Much taller ceiling than before: the composer is a workspace, not a field. */
const MAX_ROWS = 24;

/** The one missing setup step, stated as guidance rather than an error. */
function noModelError(): string {
  const lang = useApp.getState().language;
  return t(lang, "composer.noModel");
}

export function Composer() {
  const {
    send,
    addToQueue,
    abort,
    busy,
    model,
    sessionId,
    language,
    agents,
    commands,
    voice,
    customProviders,
    setModelReasoningLevel,
    notify,
    setNotify,
    skillToInsert,
    setSkillToInsert,
    composerDraft,
    openSettingsAt,
    reportError,
  } = useApp(
    useShallow((s) => ({
      send: s.send,
      addToQueue: s.addToQueue,
      abort: s.abort,
      busy: s.busy,
      model: s.model,
      sessionId: s.sessionId,
      language: s.language,
      agents: s.agents,
      commands: s.commands,
      voice: s.voice,
      customProviders: s.customProviders,
      setModelReasoningLevel: s.setModelReasoningLevel,
      notify: s.notify,
      setNotify: s.setNotify,
      skillToInsert: s.skillToInsert,
      setSkillToInsert: s.setSkillToInsert,
      composerDraft: s.composerDraft,
      openSettingsAt: s.openSettingsAt,
      reportError: s.reportError,
    }))
  );
  const [value, setValue] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>(undefined);
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Once the user drags the textarea themselves, autosize stands down. */
  const userResized = useRef(false);
  const expectedHeight = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const openSettings = useCallback(
    (tab: string) => {
      // One atomic update: the previous setSettingsTab+setSettingsOpen pair
      // was undone by setSettingsOpen wiping settingsInitialTab on open, so
      // every gear landed on the General pane instead of its own pane.
      openSettingsAt(tab);
    },
    [openSettingsAt]
  );

  // Autosize without a layout thrash on every keystroke — until the user
  // takes over height by dragging the native resize handle.
  useEffect(() => {
    const el = ref.current;
    if (!el || userResized.current) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = lineHeight * MAX_ROWS;
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    expectedHeight.current = next;
  }, [value]);

  // A height that does not match what autosize set means the user dragged.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const actual = el.getBoundingClientRect().height;
      if (expectedHeight.current > 0 && Math.abs(actual - expectedHeight.current) > 4) {
        userResized.current = true;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Focus the composer when switching sessions: the next thing you do is type.
  useEffect(() => {
    ref.current?.focus();
  }, [sessionId]);

  // A skill picked in the sidebar drops its slash command straight into the
  // draft. Insert is tracked through a ref so React StrictMode's doubled
  // effect run (dev) cannot insert the same skill twice: both runs see the
  // same stale `skillToInsert` snapshot, the second one must be a no-op.
  const lastSkill = useRef<string | null>(null);
  useEffect(() => {
    if (!skillToInsert) {
      // Store cleared (or the StrictMode reset pass): forget the consumed value
      // so picking the same skill again inserts it again.
      lastSkill.current = null;
      return;
    }
    if (lastSkill.current === skillToInsert) return;
    lastSkill.current = skillToInsert;
    setValue((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}/${skillToInsert} `);
    setSkillToInsert(null);
    ref.current?.focus();
  }, [skillToInsert, setSkillToInsert]);

  // One-shot composer fill from MessageActions' "edit": replaces the draft
  // entirely (the user asked to edit THAT message) and focuses for editing.
  const lastDraft = useRef<string | null>(null);
  useEffect(() => {
    if (!composerDraft) {
      lastDraft.current = null;
      return;
    }
    if (lastDraft.current === composerDraft) return;
    lastDraft.current = composerDraft;
    setValue(composerDraft);
    ref.current?.focus();
  }, [composerDraft]);

  // External insert path (example prompts on the empty screen): fill the
  // draft and focus, but never auto-send — the newcomer should see what a
  // prompt looks like before it goes anywhere.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text !== "string" || !text) return;
      setValue((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${text}`);
      ref.current?.focus();
    };
    window.addEventListener("buzzagent:composer-insert", onInsert);
    return () => window.removeEventListener("buzzagent:composer-insert", onInsert);
  }, []);

  const submit = async () => {
    const text = value.trim();
    if (!text) return;

    if (busy) {
      addToQueue({ text, agent: selectedAgent });
      setValue("");
      setCommandQuery(null);
      return;
    }

    // No model configured yet: explain instead of throwing. The send() path
    // would reject with "Choose a model first", which reads as a system error
    // rather than the single missing setup step that it is.
    if (!model) {
      openSettings("providers");
      reportError(new Error(noModelError()));
      return;
    }

    setValue("");
    try {
      await send(text, { agent: selectedAgent });
    } catch (e) {
      // Store already classified it (reportError inside send()); keep the
      // composer silent here so the banner above shows the full detail once.
      reportError(e);
      setValue(text); // Never silently lose what the user typed.
    }
  };

  const toggleVoice = useCallback(async () => {
    if (listening && recorder.current) {
      recorder.current.stop();
      setListening(false);
      return;
    }
    if (!voice.endpoint.trim()) {
      openSettings("general");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("file", blob, "speech.webm");
          form.append("model", voice.model.trim() || "whisper-1");
          const response = await fetch(`${voice.endpoint.trim().replace(/\/+$/, "")}`, {
            method: "POST",
            body: form,
          });
          if (!response.ok) {
            throw new Error(`Transcription failed: HTTP ${response.status}`);
          }
          const result = (await response.json()) as { text?: string };
          const text = (result.text ?? "").trim();
          if (text) setValue((prev) => `${prev}${prev ? " " : ""}${text} `);
          ref.current?.focus();
        } catch (e) {
          reportError(e);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorder.current = rec;
      setListening(true);
    } catch (e) {
      reportError(e);
    }
  }, [listening, voice.endpoint, voice.model, openSettings, reportError]);

  const modes = agents.length > 0 ? agents : [{ name: "build" }, { name: "plan" }];

  // @file finder: typing `@token` scans the project tree (fs_tree, capped).
  const [fileMatches, setFileMatches] = useState<{ path: string; isDir: boolean }[]>([]);
  const fileQuery = /(?:^|\s)@([^\s]*)$/.exec(value)?.[1] ?? null;
  useEffect(() => {
    if (fileQuery === null) {
      setFileMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const dir = fileQuery.includes("/") ? fileQuery.slice(0, fileQuery.lastIndexOf("/")) : undefined;
        const prefix = fileQuery.includes("/") ? fileQuery.slice(fileQuery.lastIndexOf("/") + 1).toLowerCase() : fileQuery.toLowerCase();
        const entries = await invoke<{ name: string; path: string; is_dir: boolean }[]>(
          "fs_tree",
          { projectDir: useApp.getState().projectDir ?? ".", path: dir ?? null }
        );
        if (cancelled) return;
        setFileMatches(
          entries
            .filter((e) => e.name.toLowerCase().startsWith(prefix))
            .slice(0, 8)
            .map((e) => ({ path: e.path, isDir: e.is_dir }))
        );
      } catch {
        if (!cancelled) setFileMatches([]);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fileQuery]);

  const insertFileRef = (entry: { path: string; isDir: boolean }) => {
    const m = /(?:^|\s)@([^\s]*)$/.exec(value);
    if (!m) return;
    const start = value.length - m[0].length + m[0].indexOf("@");
    const next = `${value.slice(0, start)}@${entry.path}${entry.isDir ? "/" : " "}`;
    setValue(next);
    setFileMatches([]);
    ref.current?.focus();
  };

  // Built-in commands merged with project commands for the completion popup.
  const builtinMatches =
    commandQuery !== null
      ? BUILTINS.filter(
          (c) =>
            (c.name.startsWith(commandQuery.toLowerCase()) ||
              (c.aliases ?? []).some((a) => a.startsWith(commandQuery.toLowerCase()))) &&
            commandQuery.length <= c.name.length
        ).slice(0, 4)
      : [];

  // Transient notices from builtin commands (export/copy/undo/...) as toasts.
  const lastNotice = useApp((s) => s.lastNotice);
  useEffect(() => {
    if (!lastNotice) return;
    toast.success(lastNotice.text, { id: `notice-${lastNotice.at}` });
  }, [lastNotice]);

  // Slash-command completion: typing `/xyz` pops the project's command list
  // (GET /command). Tab or click completes; Escape dismisses.
  const slashMatches =
    commandQuery !== null
      ? commands
          .filter(
            (c) =>
              c.name.toLowerCase().startsWith(commandQuery.toLowerCase()) &&
              commandQuery.length <= c.name.length
          )
          .slice(0, 6)
      : [];

  const completeCommand = (name: string) => {
    setValue(`/${name} `);
    setCommandQuery(null);
    ref.current?.focus();
  };

  // Reasoning is a property of the active model; the chip mirrors and flips it.
  const reasoningOn =
    model
      ? (customProviders[model.providerID] as
          | { models?: Record<string, { reasoning?: boolean }> }
          | undefined
        )?.models?.[model.modelID]?.reasoning === true
      : false;

  // Selected effort level for the active model ("off" = provider default).
  const reasoningLevel: ReasoningLevel =
    model
      ? ((customProviders[model.providerID] as
            | { models?: Record<string, { level?: string }> }
            | undefined
          )?.models?.[model.modelID]?.level as ReasoningLevel | undefined) ?? "off"
      : "off";
  const [reasoningOpen, setReasoningOpen] = useState(false);

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-2.5">
      <div className="mx-auto max-w-3xl">
        {/* Message queue drawer */}
        <MessageQueue />

        {/* Slash-command completion popup: project + built-ins */}
        {(slashMatches.length > 0 || builtinMatches.length > 0) && (
          <div className="mb-1.5 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]">
            <p className="border-b border-[var(--border-subtle)] px-2.5 py-1 text-2xs text-[var(--fg-muted)]">
              {t(language, "composer.commandsTitle")}
            </p>
            {slashMatches.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => completeCommand(c.name)}
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="font-mono text-xs text-[var(--accent)]">/{c.name}</span>
                <span className="truncate text-2xs text-[var(--fg-muted)]">
                  {c.description ?? ""}
                </span>
              </button>
            ))}
            {builtinMatches.map((c) => (
              <button
                key={`builtin-${c.name}`}
                type="button"
                onClick={() => completeCommand(c.name)}
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="font-mono text-xs text-[var(--accent)]">/{c.name}</span>
                <span className="text-2xs text-[var(--fg-muted)]">{c.argHint ?? ""}</span>
                <span className="truncate text-2xs text-[var(--fg-secondary)]">
                  {t(language, `help.cmd.${c.name}`, c.description)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* @file finder popup */}
        {fileMatches.length > 0 && (
          <div className="mb-1.5 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]">
            {fileMatches.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => insertFileRef(f)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <span className="font-mono text-2xs text-[var(--accent)]">@</span>
                <span className="truncate font-mono text-2xs text-[var(--fg-primary)]">
                  {f.path}{f.isDir ? "/" : ""}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Errors surface through the shared ErrorBanner below the composer. */}

        {/* Input box */}
        <div className="flex items-end gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 transition-colors focus-within:border-[var(--accent)]">
          <textarea
            ref={ref}
            rows={3}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              // Track an in-progress /command token for completion.
              const m = /(^|\s)\/([a-z0-9_-]*)$/i.exec(e.target.value);
              setCommandQuery(m ? m[2] : null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab" && slashMatches.length > 0) {
                e.preventDefault();
                completeCommand(slashMatches[0].name);
                return;
              }
              if (e.key === "Escape" && commandQuery !== null) {
                setCommandQuery(null);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                setCommandQuery(null);
                void submit();
              }
            }}
            placeholder={
              busy
                ? t(language, "composer.placeholderBusy")
                : model
                  ? t(language, "composer.placeholder")
                  : t(language, "composer.placeholderNoModel")
            }
            aria-label="Message"
            className="min-h-[3.75rem] flex-1 resize-y bg-transparent text-xs leading-relaxed text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
          />

          <div className="flex shrink-0 flex-col items-center gap-1.5">
            {/* Voice input: records, then transcribes through the local Whisper server */}
            {voice.endpoint.trim() && (
              <button
                type="button"
                onClick={() => void toggleVoice()}
                disabled={transcribing}
                title={
                  listening
                    ? t(language, "voice.stop")
                    : t(language, "voice.record")
                }
                aria-label={listening ? t(language, "voice.stop") : t(language, "voice.record")}
                className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                  listening
                    ? "bg-[var(--danger)] text-white"
                    : "bg-[var(--bg-overlay)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                } disabled:opacity-40`}
              >
                {transcribing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : listening ? (
                  <MicOff size={13} />
                ) : (
                  <Mic size={13} />
                )}
              </button>
            )}

            {busy ? (
              <div className="flex items-center gap-1.5">
                {value.trim() && (
                  <button
                    type="button"
                    onClick={() => void submit()}
                    title={t(language, "composer.queue")}
                    className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-2xs font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
                  >
                    <Clock size={12} />
                    <span>{t(language, "composer.queue")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void abort()}
                  aria-label={t(language, "composer.stop")}
                  title={t(language, "composer.stop")}
                  className="flex size-7 items-center justify-center rounded-md bg-[var(--danger-subtle)] text-[var(--danger)] transition-colors hover:bg-[var(--danger)] hover:text-white"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!value.trim()}
                aria-label={t(language, "composer.send")}
                className="flex size-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-fg)] transition-opacity hover:bg-[var(--accent-hover)] disabled:opacity-30"
              >
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Toolbar: modes (editable via the gear), hint, model picker with its own gear */}
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-2xs text-[var(--fg-muted)]">
          <div className="flex min-w-0 items-center gap-1">
            <span className="mr-1 shrink-0">{t(language, "composer.mode")}</span>
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {modes.map((modeItem) => {
                const active = selectedAgent === modeItem.name;
                return (
                  <button
                    key={modeItem.name}
                    type="button"
                    onClick={() => setSelectedAgent(active ? undefined : modeItem.name)}
                    title={modeItem.description ?? `${modeItem.name} — ${t(language, "composer.modeHint")}`}
                    aria-pressed={active}
                    className={`shrink-0 rounded px-1.5 py-0.5 transition-colors ${
                      active
                        ? "bg-[var(--bg-active)] font-medium text-[var(--fg-primary)]"
                        : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
                    }`}
                  >
                    {modeItem.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => openSettings("modes")}
                title={t(language, "modes.title")}
                aria-label={t(language, "modes.title")}
                className="shrink-0 rounded p-0.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
              >
                <Settings size={11} />
              </button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span>
              <kbd className="font-sans">Enter</kbd> → {busy ? t(language, "composer.queue") : t(language, "composer.send")}
            </span>
            {model && (
              <span className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setNotify({ sound: !notify.sound })}
                  title={
                    notify.sound
                      ? t(language, "notify.sound") + " — on"
                      : t(language, "notify.sound") + " — off"
                  }
                  aria-pressed={notify.sound}
                  className={`flex items-center justify-center rounded p-0.5 transition-colors ${
                    notify.sound
                      ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                      : "text-[var(--fg-muted)] opacity-60 hover:text-[var(--fg-primary)]"
                  }`}
                >
                  {notify.sound ? <BellRing size={11} /> : <BellOff size={11} />}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setReasoningOpen(!reasoningOpen)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setReasoningOpen(false);
                    }}
                    title="Reasoning level — choose how hard this model thinks"
                    aria-expanded={reasoningOpen}
                    aria-haspopup="menu"
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
                      reasoningOn
                        ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                        : "text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                    }`}
                  >
                    <Brain size={11} />
                    <span className="text-2xs">
                      reasoning
                      {reasoningLevel !== "off"
                        ? ` · ${reasoningLevel}`
                        : reasoningOn
                          ? " · on"
                          : ""}
                    </span>
                    <ChevronDown size={10} className="shrink-0 opacity-70" />
                  </button>

                  {reasoningOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setReasoningOpen(false)}
                        aria-hidden
                      />
                      <div
                        role="menu"
                        className="absolute bottom-full left-0 z-20 mb-1.5 w-40 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] py-1 shadow-[var(--shadow-panel)]"
                      >
                        {(
                          (reasoningOn
                            ? REASONING_LEVELS
                            : (["off", ...REASONING_LEVELS] as const)
                          )
                        ).map((item) => {
                          const active = reasoningLevel === item;
                          return (
                            <button
                              key={item}
                              type="button"
                              role="menuitemradio"
                              aria-checked={active}
                              onClick={() => {
                                setReasoningOpen(false);
                                void setModelReasoningLevel(item as ReasoningLevel);
                              }}
                              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-2xs transition-colors ${
                                active
                                  ? "bg-[var(--accent-subtle)] text-[var(--fg-primary)]"
                                  : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
                              }`}
                            >
                              <span className="font-mono">{item}</span>
                              {active && <Check size={12} className="text-[var(--accent)]" />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                <ComposerModelPicker />
                <button
                  type="button"
                  onClick={() => openSettings("providers")}
                  title={t(language, "tab.providers")}
                  aria-label={t(language, "tab.providers")}
                  className="rounded p-0.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
                >
                  <Settings size={11} />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
