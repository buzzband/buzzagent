import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FilePlus2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import {
  fetchSkillFromGitHub,
  parseGitHubSource,
  searchSkills,
  skillFolderName,
  type SkillSearchResult,
} from "../../lib/registries";

type InstallScope = "project" | "global";

/**
 * Skills as a first-class editor tab. Distinct from anything embedded in the
 * Projects panel: this is the browse/install/manage surface.
 *
 * Skills are plain folders with a SKILL.md discovered by the core from
 * `.opencode/skills/<name>/` (project) and the global config dir. Built-in
 * skills ship inside the pinned core binary — they cannot be removed, but a
 * per-use permission gate stops the agent auto-invoking them.
 */
export function SkillsPanel() {
  const {
    skills,
    projectDir,
    skillShown,
    setSkillShown,
    setSkillToInsert,
    language,
    reportError,
    bumpFsVersion,
  } = useApp(
    useShallow((s) => ({
      skills: s.skills,
      projectDir: s.projectDir,
      skillShown: s.skillShown,
      setSkillShown: s.setSkillShown,
      setSkillToInsert: s.setSkillToInsert,
      language: s.language,
      reportError: s.reportError,
      bumpFsVersion: s.bumpFsVersion,
    }))
  );

  const [creating, setCreating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [source, setSource] = useState("");
  const [scope, setScope] = useState<InstallScope>(projectDir ? "project" : "global");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<string[]>([]);
  const [showBuiltin, setShowBuiltin] = useState(false);
  const [askBeforeUse, setAskBeforeUse] = useState(false);

  const reloadSkills = useCallback(
    () => void useApp.getState().loadSkills(),
    []
  );

  // ---- create locally -------------------------------------------------
  const createSkill = async () => {
    const name = newName.trim();
    if (!name || !projectDir) return;
    setCreatingBusy(true);
    setFormError(null);
    try {
      const folder = skillFolderName(name);
      const body = [
        "---",
        `name: ${folder}`,
        `description: ${newDesc.trim() || `Use when the user asks for ${name}.`}`,
        "---",
        "",
        `# ${name}`,
        "",
        "Describe when this skill applies and what the agent should do, step by step.",
        "",
      ].join("\n");
      await invoke("fs_write_file", {
        projectDir,
        path: `.opencode/skills/${folder}/SKILL.md`,
        content: body,
      });
      bumpFsVersion();
      setNewName("");
      setNewDesc("");
      setCreating(false);
      reloadSkills();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingBusy(false);
    }
  };

  // ---- registry search ------------------------------------------------
  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setFormError(null);
    try {
      setResults(await searchSkills(q));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  // ---- install one skill ----------------------------------------------
  const install = async (opts: {
    sourceText: string;
    skillId?: string;
    resultId?: string;
  }) => {
    const parsed = parseGitHubSource(opts.sourceText);
    if (!parsed) {
      setFormError(
        "Use a GitHub repo (owner/repo) or a github.com/... URL — including repo links from any skills directory."
      );
      return;
    }
    if (opts.resultId) setInstallingId(opts.resultId);
    setFormError(null);
    try {
      const bundle = await fetchSkillFromGitHub(parsed, { skillId: opts.skillId });
      const folder = skillFolderName(bundle.name);
      if (scope === "project" && projectDir) {
        for (const file of bundle.files) {
          await invoke("fs_write_file", {
            projectDir,
            path: `.opencode/skills/${folder}/${file.path}`,
            content: file.content,
          });
        }
        bumpFsVersion();
      } else {
        // Global scope lives inside the app's sandboxed core config dir, which
        // the project-scoped fs commands cannot reach.
        const inTauri =
          typeof window !== "undefined" &&
          ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
        if (!inTauri) throw new Error("Global install requires the desktop app.");
        for (const file of bundle.files) {
          await invoke("core_write_global_file", {
            relPath: `skills/${folder}/${file.path}`,
            content: file.content,
          });
        }
      }
      setInstalled((prev) => [...prev, opts.resultId ?? bundle.name]);
      setSource("");
      setResults(null);
      reloadSkills();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstallingId(null);
    }
  };

  // ---- remove (non-builtin, non-slash project/global files) ------------
  const removeSkill = async (location: string) => {
    // Skill locations are absolute paths to the SKILL.md; delete its folder.
    const inTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!inTauri) return;
    const normalized = location.replace(/\/+$/, "");
    const isProject = projectDir && normalized.startsWith(projectDir);
    const skillMd = normalized.endsWith("SKILL.md")
      ? normalized
      : `${normalized}/SKILL.md`;
    try {
      if (isProject) {
        await invoke("fs_delete", {
          projectDir,
          path: skillMd.slice(projectDir.length).replace(/^\/+/, ""),
          isDir: false,
        });
        bumpFsVersion();
      } else {
        const rel = skillMd.includes("core/config/opencode/")
          ? skillMd.slice(skillMd.indexOf("core/config/opencode/") + "core/config/opencode/".length)
          : null;
        if (!rel) throw new Error("Cannot determine the skill folder to remove.");
        // Remove the skill's whole folder so no stale files linger.
        const folderRel = rel.replace(/(^|\/)SKILL\.md$/, "");
        await invoke("core_delete_global_file", {
          relPath: folderRel,
          isDir: folderRel !== rel,
        });
      }
      reloadSkills();
    } catch (e) {
      reportError(e);
    }
  };

  // ---- permission gate for auto-activation ----------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const settings = await invoke<Record<string, unknown>>("core_read_settings");
        if (cancelled) return;
        const perms = settings.permission as Record<string, unknown> | undefined;
        setAskBeforeUse(perms?.skill === "ask");
      } catch {
        // Plain browser: leave the toggle at its default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAskBeforeUse = async () => {
    const next = !askBeforeUse;
    setAskBeforeUse(next);
    try {
      await invoke("core_write_settings", {
        patch: { permission: { skill: next ? "ask" : "allow" } },
      });
    } catch (e) {
      setAskBeforeUse(!next);
      reportError(e);
    }
  };

  const visible = skills.filter((s) => showBuiltin || !isBuiltin(s));
  const builtinCount = skills.filter(isBuiltin).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
        <h2 className="text-xs font-medium text-[var(--fg-primary)]">
          {t(language, "sidebar.skills")}
        </h2>
        <span className="text-2xs text-[var(--fg-muted)]">{skills.length} discovered</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setCreating((v) => !v);
              setInstalling(false);
            }}
            className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <FilePlus2 size={11} />
            {t(language, "skills.newSkill")}
          </button>
          <button
            type="button"
            onClick={() => {
              setInstalling((v) => !v);
              setCreating(false);
            }}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-2xs transition-colors ${
              installing
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                : "border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }`}
          >
            <Download size={11} />
            {t(language, "skills.install")}
          </button>
        </div>
      </div>

      {formError && (
        <p
          role="alert"
          className="border-b border-[var(--border-subtle)] px-4 py-1.5 text-2xs text-[var(--danger)]"
        >
          {formError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Create local skill */}
        {creating && (
          <div className="mb-3 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="skill name (e.g. release-notes)"
                autoFocus
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void createSkill()}
                disabled={creatingBusy || !newName.trim() || !projectDir}
                title={projectDir ? undefined : "Open a project first"}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-2xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
              >
                {creatingBusy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Create
              </button>
            </div>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="when should the agent use it? (one line)"
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
            />
            <p className="text-2xs text-[var(--fg-muted)]">
              Writes <code>.opencode/skills/&lt;name&gt;/SKILL.md</code> in the current project.
            </p>
          </div>
        )}

        {/* Install from directory */}
        {installing && (
          <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="flex flex-wrap gap-1.5">
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && source.trim()) {
                    void install({ sourceText: source });
                  }
                  if (e.key === "Escape") setInstalling(false);
                }}
                placeholder="owner/repo or https://github.com/owner/repo/tree/main/skills/my-skill"
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void install({ sourceText: source })}
                disabled={!source.trim() || installingId !== null}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-2xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
              >
                {installingId ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                Install
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-[var(--fg-muted)]">
              <span>Scope:</span>
              {(["project", "global"] as InstallScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  disabled={s === "project" && !projectDir}
                  className={`rounded px-1.5 py-0.5 transition-colors disabled:opacity-40 ${
                    scope === s
                      ? "bg-[var(--accent-subtle)] font-medium text-[var(--accent)]"
                      : "hover:text-[var(--fg-primary)]"
                  }`}
                >
                  {s === "project"
                    ? t(language, "skills.project")
                    : t(language, "skills.global")}
                </button>
              ))}
            </div>

            <div className="mt-2 flex gap-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5">
                <Search size={12} className="shrink-0 text-[var(--fg-muted)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doSearch();
                  }}
                  placeholder="…or search skills.sh (the npx skills registry)"
                  className="min-w-0 flex-1 bg-transparent text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => void doSearch()}
                disabled={searching || !query.trim()}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-raised)] px-2.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40"
              >
                {searching ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                Search
              </button>
            </div>

            {results && (
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {results.length === 0 && !searching && (
                  <li className="py-3 text-center text-xs text-[var(--fg-muted)]">
                    No skills match “{query}”.
                  </li>
                )}
                {results.map((r) => {
                  const done = installed.includes(r.id);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-2"
                    >
                      <BookOpen size={13} className="shrink-0 text-[var(--accent)]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-[var(--fg-primary)]">
                          /{r.name}
                        </p>
                        <p className="truncate font-mono text-2xs text-[var(--fg-muted)]">
                          {r.source} · {r.installs.toLocaleString()} installs
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void install({
                            sourceText: r.source,
                            skillId: r.skillId,
                            resultId: r.id,
                          })
                        }
                        disabled={done || installingId !== null}
                        className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors ${
                          done
                            ? "text-[var(--success)]"
                            : "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
                        }`}
                      >
                        {done ? (
                          <Check size={11} />
                        ) : installingId === r.id ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Plus size={11} />
                        )}
                        {done ? "Installed" : "Install"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-2xs text-[var(--fg-muted)]">
              Any GitHub repo with SKILL.md folders works — links from cursor.directory, awesome
              lists or your own repos all install the same way.
            </p>
          </div>
        )}

        {/* Auto-activation gate */}
        <label className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-2xs text-[var(--fg-secondary)]">
          <input
            type="checkbox"
            checked={askBeforeUse}
            onChange={() => void toggleAskBeforeUse()}
            className="accent-[var(--accent)]"
          />
          <span>
            Ask before the agent uses a skill (permission prompt on every activation, including
            built-ins)
          </span>
        </label>

        {/* Skill list */}
        {visible.length === 0 ? (
          <p className="px-1 text-xs text-[var(--fg-muted)]">
            {t(language, "sidebar.skillsEmpty")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visible.map((skill) => {
              const shown = skillShown(projectDir, skill.name);
              const builtin = isBuiltin(skill);
              const scoped = locationScope(skill.location, projectDir);
              return (
                <li
                  key={`${skill.location}:${skill.name}`}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                >
                  <div className="flex items-start gap-2">
                    <Wrench size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-xs font-medium text-[var(--fg-primary)]">
                          {skill.slash === false ? skill.name : `/${skill.name}`}
                        </span>
                        {builtin && (
                          <span
                            title={t(language, "skills.collapseHint")}
                            className="flex shrink-0 items-center gap-0.5 rounded-xs bg-[var(--bg-raised)] px-1 py-0.5 text-2xs text-[var(--fg-muted)]"
                          >
                            <Lock size={9} />
                            {t(language, "skills.builtin")}
                          </span>
                        )}
                        <span className="shrink-0 rounded-xs bg-[var(--bg-raised)] px-1 py-0.5 text-2xs text-[var(--fg-muted)]">
                          {t(language, scoped)}
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
                      <p className="mt-1 line-clamp-2 text-2xs text-[var(--fg-secondary)]">
                        {skill.description || "No description."}
                      </p>
                      <p
                        className="mt-1 truncate font-mono text-2xs text-[var(--fg-muted)]"
                        title={skill.location}
                      >
                        {skill.location}
                      </p>
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSkillToInsert(skill.name)}
                          className="rounded-md border border-[var(--border-default)] px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          Insert into chat
                        </button>
                        {!builtin && (
                          <button
                            type="button"
                            onClick={() => void removeSkill(skill.location)}
                            title={t(language, "skills.remove")}
                            aria-label={`${t(language, "skills.remove")} ${skill.name}`}
                            className="flex items-center gap-1 rounded-md border border-[var(--border-default)] px-2 py-1 text-2xs text-[var(--fg-muted)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                          >
                            <Trash2 size={11} />
                            {t(language, "skills.remove")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {builtinCount > 0 && (
          <button
            type="button"
            onClick={() => setShowBuiltin((v) => !v)}
            className="mx-auto mt-3 flex items-center gap-1 rounded-md px-2 py-1 text-2xs text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-secondary)]"
          >
            {showBuiltin ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {showBuiltin ? "Hide" : "Show"} built-in skills ({builtinCount})
          </button>
        )}
        {showBuiltin && (
          <ul className="mx-auto mt-1 max-w-md space-y-0.5">
            {skills.filter(isBuiltin).map((skill) => (
              <li
                key={`builtin-${skill.location}:${skill.name}`}
                className="flex items-center gap-2 rounded-md bg-[var(--bg-surface)] px-2.5 py-1.5 text-2xs"
              >
                <Lock size={10} className="shrink-0 text-[var(--fg-muted)]" />
                <span className="truncate font-mono text-[var(--fg-secondary)]">{skill.name}</span>
                <span className="ml-auto truncate pl-2 text-[var(--fg-muted)]" title={skill.description}>
                  {skill.description}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Core-shipped skills: locations outside the project and the sandbox dirs. */
function isBuiltin(skill: { location: string; slash?: boolean }): boolean {
  return (
    skill.slash === false &&
    !skill.location.includes("core/config/opencode/") &&
    !skill.location.includes(".opencode")
  );
}

function locationScope(location: string, projectDir: string | null): "skills.project" | "skills.global" {
  if (projectDir && location.startsWith(projectDir)) return "skills.project";
  return "skills.global";
}
