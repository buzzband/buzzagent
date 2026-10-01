<div align="center">
  <img src="./branding/logo/buzzagent-icon.svg" width="150" alt="BuzzAgent bee logo">

  # 🐝 BuzzAgent

  ### The buzzing visual workbench for AI coding agents

  [![README / PROJECT SITE — https://b4zz.com/agent](https://img.shields.io/badge/README_%2F_PROJECT_SITE-b4zz.com%2Fagent-FCD41E?style=for-the-badge&logo=googlechrome&logoColor=1B1E23)](https://b4zz.com/agent)

  [![License: MIT](https://img.shields.io/badge/license-MIT-FCD41E)](./LICENSE)
  [![Version 0.1.17](https://img.shields.io/badge/version-0.1.17-FE8D00)](https://github.com/buzzband/buzzagent/releases)
  [![Core: OpenCode](https://img.shields.io/badge/core-OpenCode-1B1E23)](https://github.com/anomalyco/opencode)
  [![Zero telemetry, verified](https://img.shields.io/badge/telemetry-zero_verified-2E7D32)](./docs/telemetry-audit.md)

  [![CI](https://github.com/buzzband/buzzagent/actions/workflows/ci.yml/badge.svg)](https://github.com/buzzband/buzzagent/actions)
  [![Tests: 138 passing](https://img.shields.io/badge/tests-138_passing-4CAF50)](https://github.com/buzzband/buzzagent/actions)
  [![Platforms: Windows | macOS | Linux](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-8A8F98)](https://github.com/buzzband/buzzagent/releases)
  [![UI languages: 15 built in](https://img.shields.io/badge/UI_languages-15%20built%20in-F5B942)](./README/README.md)
  [![PRs welcome](https://img.shields.io/badge/PRs-welcome-FE8D00)](https://github.com/buzzband/buzzagent/pulls)

  **EN** | [Other languages](./README/README.md) · 🌐 [README / PROJECT SITE](https://b4zz.com/agent)

  🟨 ⬛ 🟨 ⬛ 🐝 ⬛ 🟨 ⬛ 🟨
</div>

Open-source visual workbench for AI coding agents. The agent core is
[OpenCode](https://github.com/anomalyco/opencode) (MIT); BuzzAgent is the GUI
client around it — not another agent runtime.

> **See everything the agent does. Control models, tools, browser, MCP, and
> reasoning — locally, with zero telemetry.**

## 🐝 Why this OpenCode GUI is a powerhouse among IDEs

Every other AI coding tool makes you pick one side: **a pretty UI wrapped
around a weak agent**, or **a brutal agent locked inside a terminal**.
BuzzAgent refuses the trade-off:

- **🏎️ Terminal-grade brain, zero terminal.** You get the *real* OpenCode —
  75+ providers, MCP, LSP, subagents, skills, permissions, session resume —
  the same engine power users run from the shell, wrapped in a workbench
  instead of a wall of text.
- **👁️ You can see the swarm work.** Every tool call, diff and permission
  shows up as a card you can inspect and gate. No black-box spinner, no
  guessing what the agent just touched.
- **🌐 A browser inside the loop.** The agent opens what it just built,
  screenshots it, reads its own console and fixes it — without leaving the
  app. VS Code extensions, Cursor and Claude Code cannot do this.
- **🐝 Many bees, one hive.** Run several agents in parallel on isolated
  git worktrees with a live monitor — explore risky ideas without touching
  your working tree.
- **🔒 Free as in swarm.** Standalone desktop app, MIT, zero telemetry,
  no account, no subscription: Cursor rents you an IDE, Cline needs VS
  Code, BuzzAgent just runs — your code and keys never leave the machine.

That is the difference: IDE extensions are tenants in someone else's IDE,
closed IDEs are rented, terminal agents are blind. BuzzAgent is a
free-flying open-source hive built on the strongest open agent core
there is — and it shows in every panel.

## 🤔 Why this exists

The market is split in two:

**Visual but weak.** Cline, Kilo Code, Roo Code — a usable UI, but locked to
VS Code, with telemetry and a weaker agent loop.

**Powerful but blind.** OpenCode, Claude Code, Codex CLI, Oh My Pi — a strong
agent, but a terminal. No visual diffs, no in-app browser, no workspace
orchestration.

The gap is a product that keeps terminal-agent power **and** gives visual
control, without telemetry or a vendor lock-in.

BuzzAgent is that product. It does **not** reimplement the agent. OpenCode
already is a headless HTTP server (`opencode serve`) with an OpenAPI spec, an
SSE event stream, and a typed JS SDK. Their TUI is one client of that server;
their IDE plugins are another. BuzzAgent is the third client: a standalone
desktop GUI.

Kilo Code's CLI is a **fork** of OpenCode, then wrapped as a VS Code
extension (Cline lineage) with accounts and telemetry. We do not copy that.
A fork inherits their maintenance cost and cuts us off from upstream. A
client keeps the core current as OpenCode ships, which it does constantly.

### 💻 OpenCode now ships its own GUI

As of 1.18 the OpenCode repo publishes `opencode-desktop-*` builds
(Electron + SolidJS, ~120–150 MB) and a browser mode (`opencode web`).
“A visual client for OpenCode” is therefore **no longer a differentiator by
itself** — the core authors have one.

What is still ours:

- **Zero telemetry as a verifiable fact.** Their desktop wires up
  `@sentry/solid` and initialises it when `VITE_SENTRY_DSN` is set at build
  time (`packages/desktop/src/renderer/index.tsx`), plus `sentryVitePlugin`
  in the build. Our process has no crash reporter and no analytics
  dependency at all.
- **A browser inside the agent loop** — write code, open the result,
  screenshot back as a tool result, fix. Not headless-only: also attach to a
  running Chrome over CDP, so the agent can work against a profile the user
  is already logged into (permission-gated like `shell_exec`).
- **Worktree orchestration** — several agents in parallel on isolated
  branches, with a visual monitor.
- **No account, no bundled gateway.** No Zen/Go default path.

The consequence: our GUI gets compared to theirs directly. That raises the
quality bar and is the reason Milestone 1 is a narrow, reliable slice rather
than a broad feature sweep.

Useful precedent from their desktop: `packages/desktop/src/main/sidecar.ts`
starts the server with `OPENCODE_SERVER_PASSWORD`, a random port, CORS
restricted to its own renderer origin, loopback forced into `NO_PROXY`, and
system CA certificates loaded. We adopt the same hardening.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Visual layer  ──HTTP + SSE──►  opencode serve          │
│  chat · diffs · files ·         (sidecar binary,        │
│  providers · permissions ·       pinned version)        │
│  worktrees                                              │
│                                                         │
│  Rust layer                                             │
│  · supervise the core process                           │
│  · embedded browser (CDP)  ──registered as a core tool──│
│  · git worktree orchestration                           │
└─────────────────────────────────────────────────────────┘
```

- **Core = OpenCode.** Tool loop, native function calling, streaming, sessions
  and resume, compaction, permissions, LSP, MCP, grep/glob/symbols, AGENTS.md,
  skills, slash commands, 75+ providers, OAuth. We do not rewrite any of this.
- **GUI = BuzzAgent.** Chat with tool-call cards, visual diffs, file tree,
  permission inbox, per-role model/effort controls, worktree monitor.
- **Native extras the core does not have.** Embedded browser in the agent
  loop; parallel agents in isolated git worktrees.

The frontend talks to the core **directly** over HTTP and SSE, using
`@opencode-ai/sdk` generated from a **pinned** OpenAPI spec (`GET /doc`).
Rust does not proxy agent traffic. Rust only:

1. Spawns and supervises `opencode serve` (random port, password, health).
2. Exposes native tools the core cannot do itself (browser, worktrees).

That is the same split OpenCode uses internally: the TUI is a client, the
server is the runtime.

## ⚙️ Why Tauri (and what it costs)

The hot path — streaming tokens, tool cards, diffs — goes straight from the
webview to the local core over HTTP/SSE. It does **not** pass through Tauri
IPC, so the shell's IPC throughput is not on the critical path. That makes
the desktop shell a packaging and native-capability decision, not a
performance one.

Tauri, because:

- We already need a native layer for process supervision, CDP browser
  control and git worktrees; that code exists and its tests pass.
- Moving to Electron would put us on the exact stack of OpenCode's own
  desktop (Electron + SolidJS + sidecar), where the core authors have a
  head start and we would differentiate on nothing.
- Their Electron template ships a Sentry integration. Our “no telemetry”
  claim is easier to keep true on a stack we control.
- Bundle size is a weak argument here either way: the core binary alone is
  ~57 MB, so a 5 MB vs 120 MB shell is not decisive.

The real cost, stated plainly:

- **Three different webviews.** WebView2 (Chromium, self-updating) on
  Windows, WKWebView on macOS, `webkit2gtk` on Linux. Per Tauri's own table,
  `webkit2gtk` 2.36 ≈ Safari 16 and older distros are far behind. Linux is
  the weakest target and the one where we will see rendering bugs first.
  Mitigation: conservative CSS, no bleeding-edge web APIs, test on real
  `webkit2gtk`.
- **Multiple webviews in one window are behind Tauri's `unstable` feature
  flag.** This matters for the browser panel: prefer CDP + screenshots/
  streaming into the UI over embedding a second live webview, or accept a
  separate window.
- Rust build times and a smaller plugin ecosystem than Electron's.

### 🧭 Alternatives considered

| Option | Verdict |
|---|---|
| **Electron** | Most predictable UX: one Chromium everywhere, best ecosystem, easiest devtools story. Rejected as the default because it is OpenCode desktop's exact stack, and we would still need native code via node addons. The honest fallback if `webkit2gtk` bugs become unmanageable. |
| **Go + Wails** | Same system-webview model as Tauri, so it inherits the identical `webkit2gtk` problem while giving up Rust code we already have. Go buys nothing here: the core is not Go, and our native work (CDP, worktrees, process supervision) is not easier in Go. |
| **Pure Rust GUI** (egui, Iced, GPUI, Dioxus native, Slint) | Removes the webview class of bugs and gives real native performance. But we would hand-build chat, markdown, syntax highlighting, diff views and a file tree — the exact surface where a code-agent GUI is judged. That is a multi-year detour, and a browser panel becomes very hard. Not viable for v1. |
| **Web-only UI** (serve our own frontend, run in a browser) | Cheapest to build and a genuinely useful secondary target — but OpenCode already ships `opencode web`, and a browser tab cannot own native menus, worktrees, or an embedded browser. Good as an extra mode later, not as the product. |
| **Flutter / .NET / Qt** | Native-quality widgets, but no React reuse, and the ecosystem for “render markdown + diffs + code” is weaker than the web's. Large rewrite for no strategic gain. |
| **VS Code extension** | Instantly familiar and cheap, but that is the Cline/Kilo box we are explicitly positioned against, and it kills the standalone/no-telemetry story. |

Decision: **Tauri + React now**, with Electron as the documented fallback if
Linux webview defects prove unmanageable. Keeping the UI a plain
HTTP/SSE client of the core is what makes that fallback cheap — the shell is
replaceable precisely because no agent logic lives in it.

### ❓ Why not Oh My Pi as the core

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30k stars) is a strong
agent — in places deeper than OpenCode: LSP in the loop, DAP, hashline edits,
a large native Rust layer, `pr://`/`issue://`/`agent://` URI schemes, model
fallback chains. It is still the wrong core *for this product*:

- **No HTTP server.** Its four surfaces are the TUI, a one-shot prompt, an
  in-process Node SDK, and `--mode rpc` / `acp` over **stdio**. A browser
  cannot speak stdio, so Rust would have to proxy every message — the layer
  we deliberately removed — and their RPC needs manual 1 MiB frame chunking
  and protocol negotiation. No OpenAPI spec means no generated client.
- **Telemetry we cannot switch off.** A persistent install UUID
  (`~/.omp/install-id`, documented in their `docs/install-id.md`) survives
  wiping agent state and feeds, among others, an auth-broker usage report
  that also carries the hostname, plus auto-QA pushes. Removing that means
  forking their runtime, which defeats the point of reusing a core.
- **The niche is taken:** `gooey-pi`, `pi-desktop`, `ohmypi-craft`, `ompweb`
  are already OMP GUIs.

If we ever add a second backend it goes through **ACP** — a shared protocol —
behind an adapter interface, and only after the OpenCode slice is solid.

## ✨ Interface quality is the product

Everything above is plumbing. The reason to use BuzzAgent is the interface,
so it is held to a standard rather than to “it works”: no blocking on the
network, 60 fps while streaming, no layout shift, keyboard-first, real
side-by-side diffs with syntax highlighting, virtualized long sessions,
designed empty/error/offline states, dark **and** light themes, and genuine
accessibility (focus, contrast, screen-reader support for the message
stream).

The full bar, the chosen frontend stack (React 19, Tailwind 4, Radix, Shiki,
CodeMirror 6, TanStack Virtual, cmdk) and the rules for adding dependencies
are in [PLAN.md](./PLAN.md#ui-quality-bar).

## 🎛️ How a setting reaches the core

The UI never keeps a second copy of core state. Example — the user pastes an
API key:

1. The Models panel calls `GET /provider/auth`. The form is rendered from the
   schema the core returns (API key, OAuth, device flow, …).
2. On save, the UI calls `PUT /auth/:id`. The core writes
   `~/.local/share/opencode/auth.json`. The key does not sit in our store or
   in `localStorage`.
3. Base URL, model whitelist, `share: "disabled"` go through `PATCH /config`.
4. The model picker is `GET /config/providers` / `GET /provider`.
5. The model used for a turn is a field on `POST /session/:id/message`
   (`model`, `agent`). A “router by role” is our UI choosing those fields —
   not a second HTTP client in front of 75 providers.

OAuth providers (Claude Pro, Copilot, GitLab Duo, DigitalOcean) use
`POST /provider/{id}/oauth/authorize` → system browser →
`POST /provider/{id}/oauth/callback`. No provider-specific code on our side.

If two stores ever diverge again, the agent will not start. The core is the
single owner of config, sessions, diffs, and permissions.

## 📦 What we ship vs. what we don't

**We do not write:** providers, OAuth, the tool loop, streaming, sessions,
compaction, the permission engine, LSP, MCP, grep/glob/symbols, AGENTS.md,
slash commands, skills, todos.

**We do write:** the whole visual layer; the embedded browser as a core tool;
worktree orchestration; the permission inbox; the visual model/effort
router; process supervision; packaging.

**We do not fork OpenCode** unless a vertical slice proves we must change
core semantics (system prompts, tool behaviour, diff staging). That decision
is made on evidence, after Milestone 1, not in advance.

## 📊 Positioning

```
BuzzAgent = OpenCode core
          + Cline-class visual control
          + Orca-class worktree orchestration
          + an in-app browser in the agent loop
          + zero telemetry
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Open source | yes | yes | no | no | yes |
| Zero telemetry | yes (gated — see below) | no | no | no | almost (share/Zen optional) |
| Visual GUI | standalone desktop | VS Code | yes | no | TUI / web |
| Built-in browser in the loop | yes | no | no | no | no |
| Worktree orchestration | yes | no | no | no | sessions only |
| Subagents, LSP, MCP, permissions | via core | partial | partial | yes | yes |
| Agent-agnostic later | adapter interface, OpenCode first | no | no | no | n/a |

Kilo Code proved OpenCode's core can carry a product, and MIT allows it.
They then occupied the IDE + telemetry + billing niche. The niche they left
open is exactly this one: standalone desktop, no account, no telemetry,
browser + worktrees.

## 🔐 Zero telemetry — verified

The audit (Milestone 0) has been completed and verified empirically. See [docs/telemetry-audit.md](./docs/telemetry-audit.md) for full reproduction steps.

- **Zero third-party telemetry.** No Sentry, PostHog, Segment, Mixpanel, Datadog or analytics SDKs in the core binary.
- **Outbound network calls forced off.** Conversation sharing (`"share": "disabled"`), self-updates (`"autoupdate": false`), and Zen small models are turned off via forced on-disk config.
- **Isolated environment.** All state, cache, db and logs are isolated inside the application data directory (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`).
- **Security.** HTTP Basic authentication with random generated 64-char passwords, binding only to `127.0.0.1`.

## 🟢 Current status

BuzzAgent is rebuilt and fully functional:
- **Core Supervisor (Rust)**: Automated process management, random port allocation, password generation, health checks, environment isolation, loopback `NO_PROXY` bypass, clean exit teardown.
- **Direct HTTP + SSE Client**: Direct connection to OpenCode core API, event stream parsing with frame boundary resilience, session management, multi-turn message handling, permission gating.
- **Visual Workbench UI**: Real-time streaming chat with non-flickering markdown, syntax-highlighted code blocks (Shiki), inspectable tool cards with execution states/durations/errors, permission prompt dialogs.
- **Visual Diffs Panel**: Real-time git changes viewer with word-level diff marks (`+`/`−`) and single-click file revert.
- **In-App Browser Panel**: Headless Chrome automation and live CDP attach (`http://127.0.0.1:9222`), live viewport screenshot streaming, selector interaction (click, type), and real-time CDP console log viewer.
- **Worktree Orchestration**: Create and manage isolated git worktrees per branch, switch active workbench project on the fly.
- **Command Palette (`⌘K`)**: Fast keyboard-first navigation between panels, sessions, and themes (Dark, Light, System).

## 🚀 Quick start

### 📋 1. Prerequisites & Setup

```bash
npm install
npm run setup:core   # Downloads the pinned OpenCode binary into src-tauri/bin
```

### 🖥️ 2. Run Desktop App

```bash
npm run dev          # Starts Tauri desktop app + automatically supervises core
```

Or for web preview:
```bash
npm run web          # Vite only — http://localhost:1420
```

### 🧰 3. Build installers (Windows / macOS / Linux)

```bash
npm run dist         # Downloads the pinned core, then builds release installers
```

Artifacts land in `src-tauri/target/release/bundle/`:

| OS | Files |
|---|---|
| Windows | `.msi`, NSIS `.exe` |
| macOS | `.app`, `.dmg` (build per-arch with `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

The pinned OpenCode core ships **inside** every installer (`bundle.externalBin`), so
end users install one file and never touch a terminal.

Fast iteration without release bundling: `npm run dist:debug`.

### 🏷️ 4. Release to users (one command for all three OSes)

Installers for every OS are built by CI when a version tag is pushed:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions (`.github/workflows/release.yml`) builds Windows `.msi`/`.exe`,
macOS `.dmg` (Apple Silicon + Intel) and Linux `.deb`/`.rpm`/`.AppImage`, then
attaches them all to the GitHub Release. That is the closest equivalent of
`npm install -g` for a desktop app: users click one link on the Releases page.

> Note: `npm install -g` is for CLI tools. BuzzAgent is a desktop GUI app, so
> distribution is via installers; there is no global-install path.

### ✅ 5. Verification & Tests

```bash
npm run typecheck    # TypeScript strict check
npm run lint         # ESLint 9
npm test             # Vitest unit test suite (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Rust supervisor, git, browser tests
npm run test:integration     # End-to-end against live OpenCode + mock provider
```

## 📜 License

[MIT](./LICENSE) © BuzzAgent Contributors.

OpenCode is also MIT ([anomalyco/opencode](https://github.com/anomalyco/opencode)).
The sidecar binary is a dependency, not a fork.
