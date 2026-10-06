/**
 * Registry clients: skills.sh search parsing, GitHub source parsing, skill
 * tree selection and MCP registry parsing. All network I/O is injected.
 */

import { describe, expect, it } from "vitest";
import {
  fetchSkillFromGitHub,
  parseGitHubSource,
  parseMcpRegistry,
  parseSkillsSearch,
  pickSkillRoots,
  skillFolderName,
} from "./registries";

const SKILLS_PAYLOAD = JSON.stringify({
  query: "react",
  searchType: "fuzzy",
  skills: [
    {
      id: "vercel-labs/agent-skills/vercel-react-best-practices",
      source: "vercel-labs/agent-skills",
      skillId: "vercel-react-best-practices",
      name: "vercel-react-best-practices",
      installs: 771144,
    },
    { id: "x/y/broken", source: "x/y", skillId: "", name: "" },
    null,
    42,
  ],
});

describe("parseSkillsSearch", () => {
  it("keeps valid entries and drops malformed ones", () => {
    const results = parseSkillsSearch(SKILLS_PAYLOAD);
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("vercel-labs/agent-skills");
    expect(results[0].skillId).toBe("vercel-react-best-practices");
    expect(results[0].installs).toBe(771144);
  });

  it("returns empty for junk payloads", () => {
    expect(parseSkillsSearch("not json")).toEqual([]);
    expect(parseSkillsSearch(JSON.stringify({}))).toEqual([]);
    expect(parseSkillsSearch(JSON.stringify({ skills: "nope" }))).toEqual([]);
  });
});

describe("parseGitHubSource", () => {
  it("accepts shorthand, URLs, tree URLs, .git and trailing slashes", () => {
    expect(parseGitHubSource("owner/repo")).toEqual({ repo: "owner/repo" });
    expect(parseGitHubSource("https://github.com/owner/repo")).toEqual({ repo: "owner/repo" });
    expect(parseGitHubSource("https://github.com/owner/repo.git/")).toEqual({
      repo: "owner/repo",
    });
    expect(
      parseGitHubSource("https://github.com/owner/repo/tree/main/skills/my-skill")
    ).toEqual({ repo: "owner/repo", subPath: "skills/my-skill" });
    expect(parseGitHubSource("https://github.com/owner/repo/tree/main?foo=1")).toEqual({
      repo: "owner/repo",
    });
  });

  it("rejects garbage", () => {
    expect(parseGitHubSource("")).toBeNull();
    expect(parseGitHubSource("https://gitlab.com/a/b")).toBeNull();
    expect(parseGitHubSource("just a sentence")).toBeNull();
  });
});

const TREE = [
  { path: "README.md", type: "blob" },
  { path: "SKILL.md", type: "blob" },
  { path: "skills/web-design/SKILL.md", type: "blob" },
  { path: "skills/web-design/assets/logo.png", type: "blob" },
  { path: "skills/frontend-design/SKILL.md", type: "blob" },
  { path: "skills/frontend-design/guide.md", type: "blob" },
  { path: "skills/frontend-design/sub/SKILL.md", type: "blob" },
  { path: "dir", type: "tree" },
];

describe("pickSkillRoots", () => {
  it("prefers the subPath scope when given", () => {
    const roots = pickSkillRoots(TREE, { subPath: "skills/web-design" });
    expect(roots).toEqual(["skills/web-design"]);
  });

  it("ranks matching skillId folders above others", () => {
    const roots = pickSkillRoots(TREE, { skillId: "frontend-design" });
    expect(roots[0]).toBe("skills/frontend-design");
  });

  it("falls back to shallowest-first ordering", () => {
    const roots = pickSkillRoots(TREE);
    expect(roots[0]).toBe("");
  });

  it("returns empty when the repo has no SKILL.md", () => {
    expect(pickSkillRoots([{ path: "a.txt", type: "blob" }])).toEqual([]);
  });
});

describe("fetchSkillFromGitHub", () => {
  it("downloads SKILL.md first and strips the folder prefix", async () => {
    const calls: string[] = [];
    const fetchText = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/repos/owner/repo")) {
        return JSON.stringify({ default_branch: "trunk" });
      }
      if (url.includes("/git/trees/")) {
        return JSON.stringify({
          tree: [
            { path: "skills/demo/SKILL.md", type: "blob" },
            { path: "skills/demo/notes.md", type: "blob" },
            { path: "skills/demo/deep/SKILL.md", type: "blob" },
          ],
        });
      }
      return `content-of:${url}`;
    };
    const bundle = await fetchSkillFromGitHub({ repo: "owner/repo" }, {}, fetchText);
    expect(bundle.name).toBe("demo");
    expect(bundle.files[0].path).toBe("SKILL.md");
    expect(bundle.files.map((f) => f.path)).toEqual(["SKILL.md", "notes.md", "deep/SKILL.md"]);
    expect(calls.some((c) => c.includes("/trunk/skills/demo/SKILL.md"))).toBe(true);
  });

  it("throws a helpful error when no SKILL.md exists", async () => {
    const fetchText = async (url: string) =>
      url.endsWith("/repos/owner/repo")
        ? JSON.stringify({ default_branch: "main" })
        : JSON.stringify({ tree: [{ path: "x.md", type: "blob" }] });
    await expect(
      fetchSkillFromGitHub({ repo: "owner/repo" }, {}, fetchText)
    ).rejects.toThrow(/No SKILL.md/);
  });
});

describe("skillFolderName", () => {
  it("sanitizes names into folder-safe slugs", () => {
    expect(skillFolderName("My Great Skill!")).toBe("my-great-skill");
    expect(skillFolderName("vercel-react-best-practices")).toBe(
      "vercel-react-best-practices"
    );
    expect(skillFolderName("...")).toBe("skill");
    expect(skillFolderName("  spaced  out  ")).toBe("spaced-out");
  });
});

const MCP_PAYLOAD = JSON.stringify({
  servers: [
    {
      server: {
        name: "io.github.modelcontextprotocol/filesystem",
        title: "Filesystem",
        description: "Node.js file server",
        websiteUrl: "https://github.com/modelcontextprotocol/servers",
        remotes: [],
        packages: [
          { registryType: "npm", identifier: "@modelcontextprotocol/server-filesystem", version: "0.6.2" },
        ],
      },
    },
    {
      server: {
        name: "com.example/remote-only",
        remotes: [{ url: "https://mcp.example.com/sse", type: "sse" }],
        packages: [],
      },
    },
    { server: { description: "no name" } },
    { bogus: true },
  ],
});

describe("parseMcpRegistry", () => {
  it("extracts npm packages and remote URLs", () => {
    const entries = parseMcpRegistry(MCP_PAYLOAD);
    expect(entries).toHaveLength(2);
    expect(entries[0].npmPackage).toBe("@modelcontextprotocol/server-filesystem@0.6.2");
    expect(entries[0].remoteUrl).toBeUndefined();
    expect(entries[1].remoteUrl).toBe("https://mcp.example.com/sse");
    expect(entries[1].npmPackage).toBeUndefined();
  });

  it("tolerates junk", () => {
    expect(parseMcpRegistry("{}")).toEqual([]);
    expect(parseMcpRegistry("zzz")).toEqual([]);
  });
});
