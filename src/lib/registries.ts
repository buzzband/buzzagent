/**
 * Registry clients for installing skills and MCP servers from public
 * directories, entirely from the user's machine (no intermediary service).
 *
 * Sources:
 *  - skills.sh (`GET /api/search`) — the same search the `npx skills` CLI
 *    uses; entries resolve to GitHub repos containing SKILL.md folders.
 *  - Official MCP Registry (`registry.modelcontextprotocol.io/v0.1/servers`)
 *    for MCP server discovery.
 *  - Any GitHub repo / repo tree URL, which covers cursor.directory links and
 *    any other directory that points at a repository.
 *
 * Every network call goes through an injected `fetchText` so the parsing and
 * selection logic is unit-testable without a network, and so the desktop app
 * can route through Rust (`http_get_text`, no proxy, no CORS) while a plain
 * browser build can fall back to `fetch`.
 */

export type FetchText = (url: string) => Promise<string>;

/** Default transport: the Rust bridge inside Tauri, plain fetch elsewhere. */
export async function defaultFetchText(url: string): Promise<string> {
  const inTauri =
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  if (inTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("http_get_text", { url });
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text();
}

// --------------------------------------------------------------- skills.sh

export interface SkillSearchResult {
  /** Unique registry id: `owner/repo/skillId`. */
  id: string;
  /** GitHub repo in `owner/repo` form. */
  source: string;
  skillId: string;
  name: string;
  installs: number;
}

/** Parse the skills.sh search payload defensively (shape verified live). */
export function parseSkillsSearch(payload: string): SkillSearchResult[] {
  let parsed: { skills?: unknown };
  try {
    parsed = JSON.parse(payload) as { skills?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.skills)) return [];
  const out: SkillSearchResult[] = [];
  for (const raw of parsed.skills) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const source = typeof entry.source === "string" ? entry.source : "";
    const skillId = typeof entry.skillId === "string" ? entry.skillId : "";
    const name = typeof entry.name === "string" ? entry.name : skillId;
    if (!source || !skillId) continue;
    out.push({
      id: typeof entry.id === "string" ? entry.id : `${source}/${skillId}`,
      source,
      skillId,
      name,
      installs: typeof entry.installs === "number" ? entry.installs : 0,
    });
  }
  return out;
}

export async function searchSkills(
  query: string,
  fetchText: FetchText = defaultFetchText
): Promise<SkillSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const payload = await fetchText(
    `https://skills.sh/api/search?q=${encodeURIComponent(q)}`
  );
  return parseSkillsSearch(payload).slice(0, 30);
}

// ------------------------------------------------------------------ GitHub

export interface GitHubSource {
  /** `owner/repo`. */
  repo: string;
  /** Optional path inside the repo (from a /tree/<branch>/<path> URL). */
  subPath?: string;
}

/**
 * Accept everything directories link to:
 *  - `owner/repo`
 *  - `https://github.com/owner/repo`
 *  - `https://github.com/owner/repo/tree/<branch>/<path…>`
 *  - trailing `.git`, query strings and fragments are ignored
 */
export function parseGitHubSource(input: string): GitHubSource | null {
  // Cut the query/fragment first (a raw "?"/"#" is never part of a repo or
  // tree path), then trailing slashes, then the .git suffix — that order
  // makes "…/repo.git/" collapse to "…/repo".
  const trimmed = input
    .trim()
    .split(/[?#]/)[0]
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (!trimmed) return null;

  // Full URL: repo (optional .git), optionally /tree/<branch>/<path…>.
  const urlMatch =
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/[^/\s]+(?:\/(.+))?)?$/i.exec(
      trimmed
    );
  if (urlMatch) {
    return {
      repo: `${urlMatch[1]}/${urlMatch[2]}`,
      subPath: urlMatch[3]?.replace(/\/+$/, ""),
    };
  }

  const shorthand = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
  if (shorthand) return { repo: `${shorthand[1]}/${shorthand[2]}` };

  return null;
}

interface GitTreeEntry {
  path: string;
  type: string;
}

/** SKILL.md candidates inside a repo tree, best match first. */
export function pickSkillRoots(
  tree: GitTreeEntry[],
  opts: { skillId?: string; subPath?: string } = {}
): string[] {
  const skillFiles = tree.filter(
    (e) => e.type === "blob" && (e.path === "SKILL.md" || e.path.endsWith("/SKILL.md"))
  );
  if (skillFiles.length === 0) return [];

  let candidates = skillFiles;
  if (opts.subPath) {
    const scoped = candidates.filter(
      (e) => e.path === `${opts.subPath}/SKILL.md` || e.path.startsWith(`${opts.subPath}/`)
    );
    if (scoped.length) candidates = scoped;
  }
  if (opts.skillId && candidates.length > 1) {
    const id = opts.skillId.toLowerCase();
    const named = candidates.filter((e) => {
      const parent = e.path.includes("/")
        ? e.path.slice(0, e.path.lastIndexOf("/")).split("/").pop()
        : "";
      return parent?.toLowerCase() === id || parent?.toLowerCase().includes(id);
    });
    if (named.length) candidates = named;
  }
  // Shallowest path wins when several remain (the primary skill of a repo).
  return candidates
    .map((e) => e.path.slice(0, Math.max(0, e.path.length - "SKILL.md".length - 1)))
    .sort((a, b) => a.split("/").length - b.split("/").length);
}

export interface SkillBundle {
  /** Folder name to install under (the skill's own directory name). */
  name: string;
  /** Files relative to the skill folder root, SKILL.md first. */
  files: { path: string; content: string }[];
}

/** Cap the bundle: skills are markdown + small scripts, not repositories. */
const MAX_SKILL_FILES = 20;
const MAX_SKILL_FILE_BYTES = 256 * 1024;

/**
 * Resolve and download one skill from a GitHub repo.
 *
 * Uses the unauthenticated GitHub API (60 req/h per IP; an install costs two
 * or three calls). `skillId` selects among several SKILL.md folders; without
 * it the shallowest one is taken.
 */
export async function fetchSkillFromGitHub(
  source: GitHubSource,
  opts: { skillId?: string } = {},
  fetchText: FetchText = defaultFetchText
): Promise<SkillBundle> {
  const repoInfo = JSON.parse(
    await fetchText(`https://api.github.com/repos/${source.repo}`)
  ) as { default_branch?: string };
  const branch = repoInfo.default_branch || "main";

  const treePayload = JSON.parse(
    await fetchText(
      `https://api.github.com/repos/${source.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    )
  ) as { tree?: GitTreeEntry[] };
  const tree = Array.isArray(treePayload.tree) ? treePayload.tree : [];

  const roots = pickSkillRoots(tree, { skillId: opts.skillId, subPath: source.subPath });
  if (roots.length === 0) {
    throw new Error(`No SKILL.md found in ${source.repo}`);
  }
  const root = roots[0];
  const prefix = root ? `${root}/` : "";

  const files = tree
    .filter(
      (e) =>
        e.type === "blob" &&
        e.path.startsWith(prefix) &&
        !e.path.slice(prefix.length).includes("/.git/") &&
        !e.path.endsWith(".DS_Store")
    )
    .slice(0, MAX_SKILL_FILES);

  const out: { path: string; content: string }[] = [];
  for (const file of files) {
    const content = await fetchText(
      `https://raw.githubusercontent.com/${source.repo}/${branch}/${file.path}`
    );
    if (content.length > MAX_SKILL_FILE_BYTES) continue;
    out.push({ path: file.path.slice(prefix.length), content });
  }
  // SKILL.md first — callers write files in order and the frontmatter parse
  // happens before anything else.
  out.sort((a, b) => (a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : 0));

  return {
    name: root ? (root.split("/").pop() as string) : source.repo.split("/").pop() || "skill",
    files: out,
  };
}

/** Skill folder name from a bundle: sanitized, lowercase, dash-separated. */
export function skillFolderName(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "skill"
  );
}

// ------------------------------------------------------- MCP registry

export interface McpRegistryEntry {
  /** Canonical registry name, e.g. `io.github.owner/server`. */
  name: string;
  title?: string;
  description?: string;
  websiteUrl?: string;
  /** First remote (streamable HTTP/SSE) endpoint, when the server offers one. */
  remoteUrl?: string;
  /** `npx`-able npm package with version, when published as npm. */
  npmPackage?: string;
}

/** Parse `GET /v0.1/servers` results defensively. */
export function parseMcpRegistry(payload: string): McpRegistryEntry[] {
  let parsed: { servers?: unknown };
  try {
    parsed = JSON.parse(payload) as { servers?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.servers)) return [];
  const out: McpRegistryEntry[] = [];
  for (const raw of parsed.servers) {
    if (!raw || typeof raw !== "object") continue;
    const server = (raw as Record<string, unknown>).server as
      | Record<string, unknown>
      | undefined;
    if (!server || typeof server.name !== "string") continue;
    const remotes = Array.isArray(server.remotes) ? server.remotes : [];
    const firstRemote = remotes.find(
      (r) => r && typeof r === "object" && typeof (r as Record<string, unknown>).url === "string"
    ) as Record<string, unknown> | undefined;
    const packages = Array.isArray(server.packages) ? server.packages : [];
    const npm = packages.find(
      (p) =>
        p &&
        typeof p === "object" &&
        (p as Record<string, unknown>).registryType === "npm" &&
        typeof (p as Record<string, unknown>).identifier === "string"
    ) as Record<string, unknown> | undefined;
    out.push({
      name: server.name,
      title: typeof server.title === "string" ? server.title : undefined,
      description: typeof server.description === "string" ? server.description : undefined,
      websiteUrl: typeof server.websiteUrl === "string" ? server.websiteUrl : undefined,
      remoteUrl: typeof firstRemote?.url === "string" ? (firstRemote.url as string) : undefined,
      npmPackage: npm
        ? `${npm.identifier as string}${typeof npm.version === "string" ? `@${npm.version}` : ""}`
        : undefined,
    });
  }
  return out;
}

export async function searchMcpServers(
  query: string,
  fetchText: FetchText = defaultFetchText
): Promise<McpRegistryEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const payload = await fetchText(
    `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(q)}&version=latest`
  );
  return parseMcpRegistry(payload).slice(0, 30);
}
