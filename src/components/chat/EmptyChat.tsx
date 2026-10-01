import {
  Check,
  CircleDashed,
  KeyRound,
  MessageSquarePlus,
  Sparkles,
  Zap,
} from "lucide-react";
import appIcon from "../../assets/app-icon.svg";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

/** Example prompts a first-time user can send with one click. */
const EXAMPLES = [
  { key: "chat.example.explain", text: "Explain what this project does" },
  { key: "chat.example.review", text: "Review the code for bugs and suggest fixes" },
  { key: "chat.example.feature", text: "Add a small feature and show me the diff" },
];

/**
 * The empty-state screen — the first thing a newcomer sees, so it teaches.
 *
 * It answers three questions in order: is the app set up (model check), what
 * can I type here (examples), and where are my panels (shortcut hint).
 * Everything is clickable where a click can actually do the thing.
 */
export function EmptyChat() {
  const {
    model,
    language,
    providers,
    busy,
    setSettingsOpen,
    setSettingsTab,
    setPaletteOpen,
  } = useApp(
    useShallow((s) => ({
      model: s.model,
      language: s.language,
      providers: s.providers,
      busy: s.busy,
      setSettingsOpen: s.setSettingsOpen,
      setSettingsTab: s.setSettingsTab,
      setPaletteOpen: s.setPaletteOpen,
    }))
  );

  const modelReady = Boolean(model);
  const hasProvider = Boolean(providers && providers.connected.some((p) => p !== "opencode"));

  const insertExample = (text: string) => {
    // The composer owns its draft; this event is its one external insert path
    // (the same seam skill buttons could use). Filling and focusing beats
    // auto-sending: the newcomer sees what a prompt looks like before it goes.
    window.dispatchEvent(new CustomEvent("buzzagent:composer-insert", { detail: text }));
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center">
      {/* The brand mark greets the user on the main screen (Twemoji bee, MIT). */}
      <img
        src={appIcon}
        alt=""
        aria-hidden
        className="mb-3 size-14 drop-shadow-[0_2px_10px_rgba(37,99,235,0.35)]"
      />
      <h2 className="text-lg font-medium text-[var(--fg-primary)]">
        {t(language, "chat.empty")}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm text-[var(--fg-secondary)]">
        {t(language, "chat.emptyHint")}
      </p>

      {/* Setup checklist: each row states done/not-done in plain words. */}
      <div className="mt-5 w-full max-w-sm space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 text-left">
        <div className="flex items-center gap-2 text-xs">
          {modelReady ? (
            <Check size={14} className="shrink-0 text-[var(--success)]" />
          ) : (
            <CircleDashed size={14} className="shrink-0 text-[var(--warning)]" />
          )}
          <span className={modelReady ? "text-[var(--fg-secondary)]" : "text-[var(--fg-primary)]"}>
            {modelReady ? (
              t(language, "chat.setup.modelDone")
            ) : (
              <>
                {t(language, "chat.setup.modelTodo")}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setSettingsTab("providers");
                    setSettingsOpen(true);
                  }}
                  className="ml-1 inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-0.5 text-2xs font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]"
                >
                  {hasProvider ? <Zap size={10} /> : <KeyRound size={10} />}
                  {t(language, hasProvider ? "chat.setup.pickModel" : "chat.setup.addProvider")}
                </button>
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
          <Sparkles size={14} className="shrink-0 text-[var(--fg-muted)]" />
          {t(language, "chat.setup.agent")}
        </div>
      </div>

      {/* Example prompts: only offer them once a model exists, otherwise the
          click ends in an error and teaches helplessness. */}
      {modelReady && (
        <div className="mt-5 w-full max-w-sm">
          <p className="mb-2 text-2xs uppercase tracking-wide text-[var(--fg-muted)]">
            {t(language, "chat.tryExamples")}
          </p>
          <div className="flex flex-col gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example.key}
                type="button"
                disabled={busy}
                onClick={() => insertExample(example.text)}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left text-xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--fg-primary)] disabled:opacity-50"
              >
                <MessageSquarePlus size={13} className="shrink-0 text-[var(--accent)]" />
                <span className="min-w-0 flex-1">{t(language, example.key)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mt-5 text-2xs text-[var(--fg-muted)] underline underline-offset-2 transition-colors hover:text-[var(--fg-secondary)]"
      >
        {t(language, "chat.paletteHint")}
      </button>
    </div>
  );
}
