import { useState } from "react";
import { FilePlus2, Loader2, Wrench } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

/**
 * Skills as a first-class editor tab (the right-hand "Skills" surface the user
 * asked for). Distinct from the sidebar presets layer: this is the browse/inspect
 * view, while the sidebar stays a compact toggle list.
 */
export function SkillsPanel() {
  const { skills, projectDir, skillShown, setSkillShown, setSkillToInsert, language, sessionId, client, reportError } =
    useApp(
      useShallow((s) => ({
        skills: s.skills,
        projectDir: s.projectDir,
        skillShown: s.skillShown,
        setSkillShown: s.setSkillShown,
        setSkillToInsert: s.setSkillToInsert,
        language: s.language,
        sessionId: s.sessionId,
        client: s.client,
        reportError: s.reportError,
      }))
    );
  const [initializing, setInitializing] = useState(false);
  const [initDone, setInitDone] = useState(false);

  /**
   * POST /session/:id/init asks the core to analyze the project and write an
   * AGENTS.md. Previously planned but never wired; it belongs next to skills
   * because that is where "teach the agent about this project" lives.
   */
  const initProject = async () => {
    if (!client || !sessionId) return;
    setInitializing(true);
    try {
      await client.initSession(sessionId);
      setInitDone(true);
      setTimeout(() => setInitDone(false), 4000);
    } catch (error) {
      // Init refused (core busy, no project, …) — surface it like any other
      // core failure instead of an unhandled rejection.
      reportError(error, { sessionID: sessionId });
    } finally {
      setInitializing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
        <h2 className="text-xs font-medium text-[var(--fg-primary)]">
          {t(language, "sidebar.skills")}
        </h2>
        <span className="text-2xs text-[var(--fg-muted)]">{skills.length} discovered</span>
        <button
          type="button"
          onClick={() => void initProject()}
          disabled={initializing || !sessionId || !client}
          title={t(language, "init.hint")}
          className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
        >
          {initializing ? (
            <Loader2 size={11} className="animate-spin" />
          ) : initDone ? (
            <FilePlus2 size={11} className="text-[var(--success)]" />
          ) : (
            <FilePlus2 size={11} />
          )}
          {initDone ? t(language, "init.done") : t(language, "init.action")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {skills.length === 0 ? (
          <p className="px-1 text-xs text-[var(--fg-muted)]">
            {t(language, "sidebar.skillsEmpty")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {skills.map((skill) => {
              const shown = skillShown(projectDir, skill.name);
              return (
                <li
                  key={`${skill.location}:${skill.name}`}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                >
                  <div className="flex items-start gap-2">
                    <Wrench size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs font-medium text-[var(--fg-primary)]">
                          {skill.slash === false ? skill.name : `/${skill.name}`}
                        </span>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={shown}
                          onClick={() => projectDir && setSkillShown(projectDir, skill.name, !shown)}
                          title={shown ? "Shown in this project — click to hide" : "Hidden — click to show"}
                          className={`ml-auto shrink-0 rounded-xs border px-1.5 py-0.5 text-2xs transition-colors ${
                            shown
                              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                              : "border-[var(--border-default)] text-[var(--fg-muted)]"
                          }`}
                        >
                          {shown ? "shown" : "hidden"}
                        </button>
                      </div>
                      <p className="mt-1 text-2xs text-[var(--fg-secondary)]">
                        {skill.description || "No description."}
                      </p>
                      <p className="mt-1 truncate font-mono text-2xs text-[var(--fg-muted)]" title={skill.location}>
                        {skill.location}
                      </p>
                      <button
                        type="button"
                        onClick={() => setSkillToInsert(skill.name)}
                        className="mt-2 rounded-md border border-[var(--border-default)] px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                      >
                        Insert into chat
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
