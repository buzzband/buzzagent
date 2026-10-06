import { useCallback, useEffect, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Download,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import { searchMcpServers, type McpRegistryEntry } from "../../lib/registries";

/**
 * MCP servers as a first-class dockable panel (they used to be a collapsed
 * section at the bottom of the Projects panel). Browses configured servers
 * with live status, adds remote/local servers manually, and installs from the
 * official MCP Registry by search.
 */
export function McpPanel() {
  const {
    mcp,
    mcpServers,
    projectDir,
    projectMcp,
    language,
    client,
    setProjectMcpEnabled,
    setMcpEnabled,
    removeMcp,
    addMcpServer,
    openSettingsAt,
  } = useApp(
    useShallow((s) => ({
      mcp: s.mcp,
      mcpServers: s.mcpServers,
      projectDir: s.projectDir,
      projectMcp: s.projectMcp,
      language: s.language,
      client: s.client,
      setProjectMcpEnabled: s.setProjectMcpEnabled,
      setMcpEnabled: s.setMcpEnabled,
      removeMcp: s.removeMcp,
      addMcpServer: s.addMcpServer,
      openSettingsAt: s.openSettingsAt,
    }))
  );

  const [adding, setAdding] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"remote" | "local">("remote");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<McpRegistryEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addingName, setAddingName] = useState<string | null>(null);

  const configuredServers = Object.keys(mcpServers);
  const discovered = configuredServers.length > 0 ? configuredServers : Object.keys(mcp);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await searchMcpServers(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const addServer = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      if (kind === "remote") {
        const target = url.trim();
        if (!target) return;
        await addMcpServer(trimmed, { type: "remote", url: target, enabled: true });
      } else {
        const cmd = command.trim();
        if (!cmd) return;
        const argv = args
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const envMap: Record<string, string> = {};
        for (const line of env.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) envMap[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
        await addMcpServer(trimmed, {
          type: "local",
          command: [cmd, ...argv],
          ...(Object.keys(envMap).length ? { environment: envMap } : {}),
          enabled: true,
        });
      }
      setName("");
      setUrl("");
      setCommand("");
      setArgs("");
      setEnv("");
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** One-click install from a registry entry. */
  const installEntry = async (entry: McpRegistryEntry) => {
    const serverName =
      entry.name
        .split("/")
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-") ?? entry.name;
    setAddingName(serverName);
    setError(null);
    try {
      if (entry.remoteUrl) {
        await addMcpServer(serverName, {
          type: "remote",
          url: entry.remoteUrl,
          enabled: true,
        });
      } else if (entry.npmPackage) {
        await addMcpServer(serverName, {
          type: "local",
          command: ["npx", "-y", entry.npmPackage],
          enabled: true,
        });
      } else {
        // No directly installable transport (docker/binary packages): open the
        // listing so the user copies the command the maintainer published.
        if (entry.websiteUrl) window.open(entry.websiteUrl, "_blank", "noopener");
        setAddingName(null);
        return;
      }
      setResults((prev) => prev?.filter((r) => r.name !== entry.name) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingName(null);
    }
  };

  // Idle polling of live status, like the old sidebar section did on load.
  const [, forceTick] = useState(0);
  useEffect(() => {
    void forceTick;
    if (!client) return;
    const id = window.setInterval(() => {
      void useApp.getState().loadMcp();
    }, 15000);
    return () => window.clearInterval(id);
  }, [client]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
        <h2 className="text-xs font-medium text-[var(--fg-primary)]">
          {t(language, "sidebar.mcp")}
        </h2>
        <span className="text-2xs text-[var(--fg-muted)]">{discovered.length} configured</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setInstalling((v) => !v);
              setAdding(false);
            }}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-2xs transition-colors ${
              installing
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                : "border-[var(--border-subtle)] text-[var(--fg-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }`}
          >
            <Download size={11} />
            Install from registry
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding((v) => !v);
              setInstalling(false);
            }}
            title={t(language, "sidebar.mcpAdd")}
            className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <Plus size={11} />
            Add manually
          </button>
          <button
            type="button"
            onClick={() => {
              openSettingsAt("sources");
            }}
            title="Settings"
            aria-label="Open MCP settings"
            className="rounded p-1 text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="border-b border-[var(--border-subtle)] px-4 py-1.5 text-2xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Registry install */}
        {installing && (
          <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doSearch();
                  if (e.key === "Escape") setInstalling(false);
                }}
                placeholder="Search the official MCP Registry (e.g. filesystem, github, sqlite)…"
                autoFocus
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void doSearch()}
                disabled={searching || !query.trim()}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--bg-raised)] px-2.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40"
              >
                {searching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Search
              </button>
            </div>
            <p className="mt-1 text-2xs text-[var(--fg-muted)]">
              registry.modelcontextprotocol.io — remote servers connect in one click; npm servers
              are added as <code>npx -y &lt;package&gt;</code>.
            </p>
            {results && (
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                {results.length === 0 && !searching && (
                  <li className="py-3 text-center text-xs text-[var(--fg-muted)]">
                    No servers match “{query}”.
                  </li>
                )}
                {results.map((entry) => {
                  const installable = Boolean(entry.remoteUrl || entry.npmPackage);
                  return (
                    <li
                      key={entry.name}
                      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[var(--fg-primary)]">
                            {entry.title || entry.name.split("/").pop()}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-2xs text-[var(--fg-secondary)]">
                            {entry.description || "No description."}
                          </p>
                          <p className="mt-0.5 font-mono text-2xs text-[var(--fg-muted)]">
                            {entry.remoteUrl
                              ? `remote · ${entry.remoteUrl}`
                              : entry.npmPackage
                                ? `npm · npx -y ${entry.npmPackage}`
                                : entry.name}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void installEntry(entry)}
                          disabled={!installable || addingName !== null}
                          className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-2xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
                        >
                          {addingName !== null ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Plus size={11} />
                          )}
                          {entry.remoteUrl ? "Connect" : "Add"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Manual add */}
        {adding && (
          <div className="mb-3 space-y-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="flex gap-1.5">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="server name"
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <div className="flex shrink-0 overflow-hidden rounded-md border border-[var(--border-default)]">
                {(["remote", "local"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`px-2.5 text-2xs transition-colors ${
                      kind === k
                        ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                        : "bg-[var(--bg-base)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                    }`}
                  >
                    {k === "remote" ? t(language, "mcp.kindRemote") : t(language, "mcp.kindLocal")}
                  </button>
                ))}
              </div>
            </div>
            {kind === "remote" ? (
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/sse"
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
            ) : (
              <>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
                <textarea
                  rows={2}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem /path"}
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
                <input
                  type="text"
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  placeholder="API_KEY=secret OTHER=value"
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
                />
              </>
            )}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void addServer()}
                disabled={!name.trim() || (kind === "remote" ? !url.trim() : !command.trim())}
                className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-3 py-1.5 text-2xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
              >
                <Plug size={11} />
                Connect
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-md px-3 py-1.5 text-2xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Server list */}
        {discovered.length === 0 && !adding && !installing ? (
          <p className="px-1 text-xs text-[var(--fg-muted)]">
            {t(language, "sidebar.mcpEmpty")} Use “Install from registry” or “Add manually” to
            connect one.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {discovered.map((serverName) => {
              const server = mcpServers[serverName] ?? {};
              // Project-level flag wins over global, like the core resolves it.
              const enabled = serverName in projectMcp ? projectMcp[serverName] : server.enabled !== false;
              const raw = mcp[serverName] as
                | { status?: string; error?: string; tools?: string[] }
                | undefined;
              const status = raw?.status ?? (enabled ? "unknown" : "disabled");
              const failed = status === "failed" || status === "needs_auth";
              const kindLabel =
                (server as { type?: string }).type === "local" || Array.isArray((server as { command?: unknown }).command)
                  ? "local"
                  : "remote";
              return (
                <li
                  key={serverName}
                  className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                >
                  <div className="flex items-start gap-2">
                    <Plug size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs font-medium text-[var(--fg-primary)]">
                          {serverName}
                        </span>
                        <span className="shrink-0 rounded-xs bg-[var(--bg-raised)] px-1 text-2xs text-[var(--fg-muted)]">
                          {kindLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void (projectDir
                              ? setProjectMcpEnabled(serverName, !enabled)
                              : setMcpEnabled(serverName, !enabled))
                          }
                          className={`ml-auto shrink-0 rounded-xs border px-1.5 py-0.5 text-2xs transition-colors ${
                            enabled
                              ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                              : "border-[var(--border-default)] text-[var(--fg-muted)]"
                          }`}
                        >
                          {enabled ? "on" : "off"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeMcp(serverName)}
                          title={`Remove ${serverName}`}
                          aria-label={`Remove MCP server ${serverName}`}
                          className="shrink-0 rounded p-0.5 text-[var(--fg-muted)] transition-colors hover:text-[var(--danger)]"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-2xs">
                        {status === "connected" ? (
                          <CircleCheck size={11} className="text-[var(--success)]" />
                        ) : failed ? (
                          <CircleAlert size={11} className="text-[var(--danger)]" />
                        ) : (
                          <CircleDashed size={11} className="text-[var(--fg-muted)]" />
                        )}
                        <span className="text-[var(--fg-secondary)]">
                          {status}
                          {raw?.tools?.length ? ` · ${raw.tools.length} tools` : ""}
                        </span>
                        {failed && client && (
                          <button
                            type="button"
                            onClick={() => void client.connectMcp(serverName).catch(() => undefined)}
                            className="text-[var(--accent)] hover:underline"
                          >
                            {t(language, "mcp.retry")}
                          </button>
                        )}
                      </p>
                      {failed && raw?.error && (
                        <p className="selectable mt-1 whitespace-pre-wrap break-words text-2xs text-[var(--danger)]">
                          {raw.error}
                        </p>
                      )}
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
