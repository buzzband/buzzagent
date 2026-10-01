import { useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Plug,
  Plus,
  Settings,
  Trash2,
  Wrench,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

function Section({
  title,
  count,
  open,
  onToggle,
  onSettings,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onSettings?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--border-subtle)] px-1.5 py-1">
      <div className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs font-semibold uppercase tracking-wide text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-secondary)]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronDown
            size={11}
            className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="flex-1 truncate text-left">{title}</span>
          <span className="rounded bg-[var(--bg-raised)] px-1 text-2xs">{count}</span>
        </button>
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            title="Settings"
            aria-label="Open settings"
            className="shrink-0 rounded p-0.5 hover:text-[var(--fg-primary)]"
          >
            <Settings size={11} />
          </button>
        )}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

/**
 * Presets layer: skills and MCP servers discovered from the core.
 *
 * Skills flagged `slash` are applied by inserting their /command into the
 * composer draft. MCP servers show live status; enable/disable and add/remove
 * round-trip through the core config and are applied to the running instance.
 */
export function CapabilitiesSections() {
  const {
    skills,
    mcp,
    mcpServers,
    projectDir,
    projectMcp,
    language,
    client,
    skillShown,
    setSkillShown,
    setSkillToInsert,
    setProjectMcpEnabled,
    setMcpEnabled,
    removeMcp,
    addMcpServer,
    setSettingsTab,
    setSettingsOpen,
  } = useApp(
    useShallow((s) => ({
      skills: s.skills,
      mcp: s.mcp,
      mcpServers: s.mcpServers,
      projectDir: s.projectDir,
      projectMcp: s.projectMcp,
      language: s.language,
      client: s.client,
      skillShown: s.skillShown,
      setSkillShown: s.setSkillShown,
      setSkillToInsert: s.setSkillToInsert,
      setProjectMcpEnabled: s.setProjectMcpEnabled,
      setMcpEnabled: s.setMcpEnabled,
      removeMcp: s.removeMcp,
      addMcpServer: s.addMcpServer,
      setSettingsTab: s.setSettingsTab,
      setSettingsOpen: s.setSettingsOpen,
    }))
  );
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [addingMcp, setAddingMcp] = useState(false);
  const [mcpName, setMcpName] = useState("");
  const [mcpKind, setMcpKind] = useState<"remote" | "local">("remote");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpEnv, setMcpEnv] = useState("");
  const [mcpError, setMcpError] = useState<string | null>(null);

  const configuredServers = Object.keys(mcpServers);
  const discovered = configuredServers.length > 0 ? configuredServers : Object.keys(mcp);

  const addServer = async () => {
    const name = mcpName.trim();
    if (!name) return;
    setMcpError(null);
    try {
      if (mcpKind === "remote") {
        const url = mcpUrl.trim();
        if (!url) return;
        await addMcpServer(name, { type: "remote", url, enabled: true });
      } else {
        const command = mcpCommand.trim();
        if (!command) return;
        const args = mcpArgs
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const env: Record<string, string> = {};
        for (const line of mcpEnv.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
        await addMcpServer(name, {
          type: "local",
          command: [command, ...args],
          ...(Object.keys(env).length ? { environment: env } : {}),
          enabled: true,
        });
      }
      setMcpName("");
      setMcpUrl("");
      setMcpCommand("");
      setMcpArgs("");
      setMcpEnv("");
      setAddingMcp(false);
    } catch (e) {
      setMcpError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <Section
        title={t(language, "sidebar.skills")}
        count={skills.length}
        open={skillsOpen}
        onToggle={() => setSkillsOpen(!skillsOpen)}
        onSettings={() => {
          setSettingsTab("sources");
          setSettingsOpen(true);
        }}
      >
        {skills.length === 0 ? (
          <p className="px-2 py-1 text-2xs text-[var(--fg-muted)]">
            {t(language, "sidebar.skillsEmpty")}
          </p>
        ) : (
          <ul className="max-h-44 space-y-0.5 overflow-y-auto">
            {skills.map((skill) => {
              // Per-project choice: the core has no per-skill disable, so the
              // checkbox controls whether the skill is offered in this
              // project's presets layer.
              const shown = skillShown(projectDir, skill.name);
              return (
                <li key={`${skill.location}:${skill.name}`} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={shown}
                    onClick={() => projectDir && setSkillShown(projectDir, skill.name, !shown)}
                    title={shown ? "Shown — click to hide" : "Hidden — click to show"}
                    aria-label={`Toggle ${skill.name}`}
                    className={`flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors ${
                      shown
                        ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "border-[var(--border-default)] bg-[var(--bg-base)] text-transparent"
                    }`}
                  >
                    <Check size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSkillToInsert(skill.name)}
                    title={
                      skill.description
                        ? `${skill.description}\n(${skill.location})`
                        : skill.location
                    }
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <Wrench size={11} className="shrink-0 text-[var(--accent)]" />
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-[var(--fg-secondary)]">
                      {skill.slash === false ? skill.name : `/${skill.name}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-2 pt-0.5 text-2xs text-[var(--fg-muted)]">
          {t(language, "sidebar.skillsHint")}
        </p>
      </Section>

      <Section
        title={t(language, "sidebar.mcp")}
        count={discovered.length}
        open={mcpOpen}
        onToggle={() => setMcpOpen(!mcpOpen)}
        onSettings={() => {
          setSettingsTab("sources");
          setSettingsOpen(true);
        }}
      >
        {discovered.length === 0 && !addingMcp && (
          <p className="px-2 py-1 text-2xs text-[var(--fg-muted)]">
            {t(language, "sidebar.mcpEmpty")}
          </p>
        )}

        <ul className="space-y-0.5">
          {discovered.map((name) => {
            const server = mcpServers[name] ?? {};
            // A project-level flag wins over the global one, mirroring how
            // OpenCode itself resolves project config over global config.
            const enabled =
              name in projectMcp ? projectMcp[name] : server.enabled !== false;
            const raw = mcp[name] as
              | { status?: string; error?: string; tools?: string[] }
              | undefined;
            const status = raw?.status ?? (enabled ? "unknown" : "disabled");
            const failed = status === "failed" || status === "needs_auth";
            return (
              <li
                key={name}
                className="group rounded-md px-2 py-1 hover:bg-[var(--bg-hover)]"
              >
                <div className="flex items-center gap-1.5">
                <span
                  title={
                    failed && raw?.error
                      ? `${status}: ${raw.error}`
                      : `status: ${status}`
                  }
                  className="shrink-0"
                >
                  {status === "connected" ? (
                    <CircleCheck size={12} className="text-[var(--success)]" />
                  ) : failed ? (
                    <CircleAlert size={12} className="text-[var(--danger)]" />
                  ) : (
                    <CircleDashed size={12} className="text-[var(--fg-muted)]" />
                  )}
                </span>

                <span
                  className={`min-w-0 flex-1 truncate font-mono text-2xs ${
                    enabled ? "text-[var(--fg-secondary)]" : "text-[var(--fg-muted)] line-through"
                  }`}
                  title={name}
                >
                  {name}
                  {raw?.tools?.length ? (
                    <span className="ml-1.5 not-italic text-[var(--fg-muted)]">
                      · {raw.tools.length} tools
                    </span>
                  ) : null}
                </span>

                {failed && client && (
                  <button
                    type="button"
                    onClick={() => void client.connectMcp(name).catch(() => undefined)}
                    title={t(language, "mcp.retry")}
                    className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-[var(--accent)] hover:underline disabled:opacity-40"
                  >
                    {t(language, "mcp.retry")}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    void (projectDir
                      ? setProjectMcpEnabled(name, !enabled)
                      : setMcpEnabled(name, !enabled))
                  }
                  className={`shrink-0 rounded px-1.5 py-0.5 text-2xs transition-colors ${
                    enabled
                      ? "bg-[var(--bg-raised)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                      : "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  }`}
                >
                  {enabled ? "on" : "off"}
                </button>

                <button
                  type="button"
                  onClick={() => void removeMcp(name)}
                  title={`Remove ${name}`}
                  aria-label={`Remove MCP server ${name}`}
                  className="shrink-0 rounded p-0.5 text-[var(--fg-muted)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
                </div>

                {/* The core's own reason for the failure, verbatim. */}
                {failed && raw?.error && (
                  <p className="selectable ml-5 mt-0.5 whitespace-pre-wrap break-words text-2xs text-[var(--danger)]">
                    {raw.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {addingMcp ? (
          <div className="mt-1 space-y-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] p-2">
            <input
              type="text"
              value={mcpName}
              onChange={(e) => setMcpName(e.target.value)}
              placeholder="server name"
              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
            />

            <div className="flex gap-1">
              {(["remote", "local"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setMcpKind(kind)}
                  className={`flex-1 rounded px-2 py-1 text-2xs transition-colors ${
                    mcpKind === kind
                      ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                      : "bg-[var(--bg-surface)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                  }`}
                >
                  {kind === "remote"
                    ? t(language, "mcp.kindRemote")
                    : t(language, "mcp.kindLocal")}
                </button>
              ))}
            </div>

            {mcpKind === "remote" ? (
              <input
                type="url"
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                placeholder="https://mcp.example.com/sse"
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            ) : (
              <>
                <input
                  type="text"
                  value={mcpCommand}
                  onChange={(e) => setMcpCommand(e.target.value)}
                  placeholder="npx"
                  className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
                <textarea
                  rows={2}
                  value={mcpArgs}
                  onChange={(e) => setMcpArgs(e.target.value)}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem /path"}
                  className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
                <input
                  type="text"
                  value={mcpEnv}
                  onChange={(e) => setMcpEnv(e.target.value)}
                  placeholder="API_KEY=secret OTHER=value"
                  className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-2xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </>
            )}
            {mcpError && <p className="text-2xs text-[var(--danger)]">{mcpError}</p>}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => void addServer()}
                disabled={
                  !mcpName.trim() ||
                  (mcpKind === "remote" ? !mcpUrl.trim() : !mcpCommand.trim())
                }
                className="flex items-center gap-1 rounded bg-[var(--accent)] px-2 py-0.5 text-2xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
              >
                <Plug size={10} />
                Connect
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingMcp(false);
                  setMcpError(null);
                }}
                className="rounded px-2 py-0.5 text-2xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingMcp(true)}
            className="mt-1 flex w-full items-center gap-1 rounded-md border border-dashed border-[var(--border-default)] px-2 py-1 text-2xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Plus size={10} />
            {t(language, "sidebar.mcpAdd")}
          </button>
        )}
      </Section>
    </div>
  );
}
