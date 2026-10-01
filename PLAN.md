# BuzzAgent plan

Rebuild BuzzAgent as a GUI client of a local `opencode serve` process.
The previous in-house agent core has been deleted. Do not resurrect it.

OpenCode is MIT, exposes HTTP + SSE + a typed JS SDK, and is the runtime
their own TUI already uses. We consume that runtime; we do not fork it
unless Milestone 1 proves we must change core semantics.

## Hard rules

1. **No telemetry in our code.** No analytics, crash reporting, or network
   calls other than: the local core, the user-configured LLM provider, and
   user-added MCP servers.
2. **The frontend talks to the core directly** over HTTP and SSE
   (`@opencode-ai/sdk`). Rust does not proxy session/message/event traffic.
3. **The core is the single owner of state.** Auth, config, sessions, diffs,
   permissions live in OpenCode. We do not keep a parallel store of the same
   facts (this is what broke the old UI).
4. **Sidecar config is forced, not optional:** `share: "disabled"`,
   `small_model` pointing at a user-configured provider (never Zen by
   default), random port, `OPENCODE_SERVER_PASSWORD`, CORS locked to the
   Tauri origin.
5. **Pin the OpenCode version and regenerate the client from that version's
   `/doc` spec.** Do not track `dev` HEAD live.
6. **Tauri is the shell.** Rationale and the alternatives we rejected (Wails,
   pure-Rust GUI, web-only, VS Code extension) are in README. Electron is the
   documented fallback, not a parallel target — do not maintain both. Keep
   the UI a plain HTTP/SSE client so swapping the shell stays cheap: no agent
   logic, no core state, and no Tauri-specific API in the chat/diff path.
7. **Verify before finishing a change:** `npm run typecheck`, `npm run lint`,
   `npm test`, `cd src-tauri && cargo test`.

## Current tree

```
src/
  core/client.ts          HTTP + SSE client for OpenCode core
  core/types.ts           API contract types (pinned 1.18.30)
  store/app.ts            App state & SSE event projector (no duplicate core state)
  components/
    chat/                 MessageList, Message, Composer, ToolCard, PermissionInbox
    diffs/DiffPanel.tsx   Git-based diff panel with word-level changes
    browser/BrowserPanel  Browser in the loop (Managed Headless + CDP Attach)
    worktrees/            Git worktree isolation & switcher
    Sidebar.tsx           Navigation tabs, session list, model picker
    StatusBar.tsx         Core liveness, telemetry badge, live log modal
    CommandPalette.tsx    Cmd/Ctrl+K keyboard palette
src-tauri/src/
  main.rs                 Tauri 2 application entry & IPC dispatch
  core.rs                 Hardened OpenCode core supervisor
  browser.rs              Headless Chrome & CDP attach controller
  git.rs                  Git working tree changes & worktree management
```

Deleted on purpose and must not come back: `agent.rs`, `mcp.rs`, `git.rs`,
the old Zustand stores, `services/tools.ts`, the Electron shell, monaco /
xterm / react-query / playwright / puppeteer.

---

## Milestone 0 — Telemetry gate

**Stop the project if this fails.** The positioning is “zero telemetry”.
If the core phones home in a way we cannot force off, the product idea is
wrong and we do not spend time on the UI.

- Clone a **pinned** OpenCode tag. Read the source for: `/share`, Zen, Go,
  update checks, `small_model` / session-title calls, any default fetch
  outside the user-configured provider.
- **Sentry.** Their desktop initialises `@sentry/solid` when
  `VITE_SENTRY_DSN` is set at build time
  (`packages/desktop/src/renderer/index.tsx`) and uses `sentryVitePlugin`.
  Confirm this is confined to `packages/desktop` / `packages/app` (their GUI)
  and is **not** present in `packages/server` / the core we run as a sidecar.
  If any crash reporting exists in the server path, it must be provably off.
- Run `opencode serve` under a network sniffer (or `strace`/`mitmproxy`)
  with `share: "disabled"` and a local-only provider (Ollama). Confirm the
  only outbound destinations are the ones we expect.
- Write the forced sidecar config that turns every optional channel off.
- Document residual risk in README (what we verified, what we force off).

Exit: a short audit note in this repo (keep it factual) and a config
snippet the supervisor will pass into the process.

---

## Milestone 1 — Vertical slice

One screen, one happy path. Nothing else.

1. **Supervisor (Rust).** Spawn `opencode serve --hostname 127.0.0.1 --port
   <free>`. Set `OPENCODE_SERVER_PASSWORD`. Pass the forced config from
   Milestone 0 via the SDK `createOpencode({ config })` inline object (no
   temp files). Health-check `GET /global/health`. Kill the process on app
   quit. Expose to the UI only: `core_url`, `core_auth` (basic auth),
   `core_status`.

   Mirror the hardening OpenCode's own desktop does in
   `packages/desktop/src/main/sidecar.ts` — worth reading before writing this:
   - random port + generated password, CORS limited to our origin only;
   - force `127.0.0.1`, `localhost`, `::1` into `NO_PROXY` / `no_proxy`,
     otherwise a corporate proxy routes loopback traffic and the UI hangs;
   - load **system CA certificates** and honour `HTTPS_PROXY` so enterprise
     networks work at all;
   - point the core's state dir at our app data dir (`XDG_STATE_HOME`) so a
     BuzzAgent install does not silently share credentials with the user's
     own `opencode` CLI unless they ask for it. Decide this explicitly and
     document it — it is a privacy-visible choice.
2. **CSP.** `tauri.conf.json` `connect-src` must allow the local core origin.
   Do not widen CORS on the server.
3. **SDK.** Add `@opencode-ai/sdk`, generated from the pinned spec. Client
   lives in the frontend.
4. **UI slice.**
   - Pick a project directory (Tauri dialog) → start/bind the core in that
     directory.
   - `PUT /auth/:id` form for one OpenAI-compatible provider (enough to run).
   - `POST /session` → `POST /session/:id/prompt_async` (or `/message`).
   - Subscribe to `GET /event` and render text + tool-call parts live.
   - `GET /session/:id/diff` → list of file diffs. Accept/revert through the
     core API (`/session/:id/revert` or file write via core — use whatever
     the spec actually offers; do not invent a parallel staged-write map).
5. **Permission prompt.** If the core emits a permission request on `/event`,
   show Allow / Deny and `POST /session/:id/permissions/:permissionID`.
   `shell_exec` must never be auto-approved.

Exit: a developer can open the app, paste a key, ask “list the files in this
repo”, see the tool card, see a diff if the agent writes, and stop the run.

Do **not** start on browser, worktrees, marketplace, role grids, or a second
agent backend until this path is boringly reliable.

Open questions to answer empirically in this milestone (do not guess):

- Does `PUT /auth/:id` apply without restarting the server?
- Does `PATCH /config` persist on disk or only in the instance?
- Exact event payload shape for text, tool start/end, permission, diff.
- Can we attach to a core someone already started (`opencode attach
  <url>` exists for the TUI)? If a running `opencode serve` / `opencode web`
  can be shared, “run the agent in a terminal, watch it visually” becomes a
  feature for free — and also dictates whether we always spawn our own core
  or can bind to an existing one.
- Does one core instance serve multiple project directories, or is it one
  process per directory? This decides the whole worktree design in M5.

---

## UI quality bar

The GUI is the product. It will be compared side by side with OpenCode's own
desktop, Cursor and Cline, so “functional” is not the target. These are
requirements, not aspirations, and they apply from Milestone 2 onward.

**Feel**
- Nothing blocks on the network. Every action has an immediate optimistic
  response; streaming text never reflows the block above it.
- 60 fps while streaming into a long session. Token appends must not
  re-render the message list.
- No layout shift when a tool card expands, a diff loads, or an image
  arrives. Reserve space; never let content jump under the cursor.
- Keyboard-first: command palette, session switching, accept/reject diff,
  approve/deny permission, focus composer — all reachable without a mouse.
  Every shortcut discoverable in one place.
- Motion is functional only: state transitions and focus movement. No
  decorative animation, and honour `prefers-reduced-motion`.

**Substance**
- Diffs are real side-by-side/inline diffs with syntax highlighting and
  word-level intra-line marks, not `<pre>` blocks. Per-hunk actions where the
  core allows it.
- Long sessions are virtualized; thousands of parts must scroll smoothly.
- Streaming markdown must render incrementally without flickering on partial
  code fences — a common failure in agent GUIs; test it explicitly.
- Every tool call is inspectable: arguments, result, duration, token cost.
  Failures show the actual error, never a swallowed spinner.
- Empty, loading, error and offline states are designed, not afterthoughts.
  “Core not running” must be actionable, with a way to see the log.

**Craft**
- Dark and light themes, both first-class. Respect the OS setting.
- One type scale, one spacing scale, one radius scale. No ad-hoc pixel values.
- Accessible by default: visible focus rings, AA contrast, labelled controls,
  correct roles on custom widgets. Screen-reader support for the message
  stream is a real requirement, not a checkbox.
- Native feel: correct window controls per OS, native menus, remembered
  window state, drag-and-drop of files into the composer, paste an image.

**Method**
- Look at how the competitors solve a screen before designing it (OpenCode
  desktop, Cursor, Cline, Zed, Linear for interaction polish). Copy what
  works, and note where we deliberately differ.
- Build components in isolation with fixtures for streaming, huge diffs,
  errors and permission prompts. A stories/dev-harness route is worth it.

### Frontend stack decisions

Verified current versions at the time of writing; re-check before adopting.
Prefer few, well-maintained, headless primitives over a heavyweight kit.

| Concern | Choice | Why |
|---|---|---|
| Framework | React 19 | Already in use; ecosystem depth for markdown/diff/virtualization. |
| Styling | Tailwind CSS 4 + design tokens as CSS variables | Enforces one scale; themes become token swaps. |
| Primitives | Radix UI (or Base UI when stable) | Accessible, headless, no visual lock-in. Base UI is still `1.0.0-rc`, so Radix first. |
| Virtualization | `@tanstack/react-virtual` | Non-negotiable for long sessions. |
| Syntax highlighting | Shiki | TextMate-grade accuracy; same grammars as VS Code. Run in a worker. |
| Editor / code viewing | CodeMirror 6 | Far lighter than Monaco and enough for viewing and light editing. Do not bring Monaco back without a concrete need. |
| Command palette | `cmdk` | Keyboard-first surface, minimal. |
| Toasts | `sonner` | Non-blocking, accessible notifications. |
| Panels | `react-resizable-panels` | Persisted, keyboard-resizable layout. |
| Icons | `lucide-react` | One consistent set. |
| Motion | `motion` | Only for state/focus transitions. |
| Server state | Core SDK + thin store | Zustand only for genuine UI state. The core owns agent state — never mirror it. |

Rules that outlive the table:
- No component kit that dictates a look we cannot fully re-theme.
- Every dependency must be justified against bundle cost and maintenance; if
  a library phones home, it is removed (rule 1).
- Do the expensive work (highlighting, diff computation) off the main thread.

---

## Milestone 2 — Visual control

Rebuild the real UI against `Message` / `Part[]` from the SDK. No custom
`AgentEvent` union.

- Chat: user / assistant / tool cards, stop (`POST /session/:id/abort`),
  session list + resume (`GET /session`, `GET /session/:id/message`).
- Diff panel driven by `GET /session/:id/diff`. Per-file accept/reject if
  the API supports it; otherwise revert-message as the unit.
- File tree + file read via `GET /file`, `GET /find/file`.
- Models panel: `GET /provider`, `GET /provider/auth`, `PUT /auth/:id`,
  OAuth flow, `PATCH /config` for baseURL / whitelist.
- Usage: tokens/cost from `AssistantMessage` — display only, never invent
  numbers.
- Effort / role: UI that sets `model` + `agent` + reasoning options on the
  next `POST /session/:id/message`. No local “router” that returns `null`.

---

## Milestone 3 — Permissions, rules, MCP

- Permission inbox as a first-class panel (queue, remember, per-tool).
- Surface core MCP: `GET /mcp`, `POST /mcp`. The agent must be able to call
  those tools; we do not reimplement an MCP client.
- Project rules: rely on the core’s AGENTS.md loader; add
  `POST /session/:id/init` from the UI.
- Slash commands and skills: list from `GET /command` / core skills API,
  trigger via `POST /session/:id/command`.

---

## Milestone 4 — Browser in the loop

Keep `src-tauri/src/browser.rs`. Register it with the core as a custom tool
or as a local MCP server the sidecar auto-connects:

`navigate`, `screenshot`, `click`, `type`, `console_logs`.

Rendering constraint: multiple webviews inside one Tauri window require the
`unstable` feature flag. Do not build the browser panel on an embedded
second live webview. Drive Chrome over CDP and render screenshots (or a
frame stream) into the panel; a separate OS window is the fallback. This
also keeps the agent and the human looking at the *same* browser session.

The loop we want: agent writes code → browser opens the result → screenshot
comes back as a tool result → agent fixes. The browser panel is a view of
that same session, not a disconnected toy.

**Support three attach modes, not just headless** (borrowed from OMP, whose
`browser` tool covers Puppeteer tabs, CDP-attached apps, and the user's own
Chrome via a relay). Headless-only is the weakest option and the one we have
today:

1. **Managed headless** — we launch Chromium. Default, zero setup.
2. **Attach to a running Chrome** over CDP (`--remote-debugging-port`). Lets
   the agent work against a real profile with the user already logged in —
   the single biggest practical win, because most real debugging happens
   behind a login.
3. **Relay into the user's everyday browser** via an extension/bridge, for
   when launching a separate Chrome is unacceptable.

Design notes:
- Never touch a user profile without explicit, per-session consent. An agent
  driving a logged-in browser is a serious capability: gate it like
  `shell_exec`, through the permission inbox, and show clearly in the UI
  which mode is active.
- Report console errors, failed requests and unhandled rejections back as
  structured tool results, not only screenshots — text is what the model can
  actually act on.
- Prefer a viewport screenshot stream over one-shot full-page captures for
  the panel; keep full-page capture as an explicit tool call.

---

## Milestone 5 — Worktree orchestration

This is the Orca-shaped piece and a real differentiator.

- `git worktree add` for a task/agent pair (Rust).
- One core instance **or** one session bound to that worktree path
  (measure which the OpenCode process model actually supports — do not
  assume one process can juggle many cwd’s).
- Monitor: status of each agent, diff summary, jump-to-session.
- Merge / abandon worktree from the UI.

---

## Milestone 5.5 — Shell decision review

A scheduled checkpoint so the Electron fallback is a measured call, not a
mood. Re-evaluate only against evidence collected during M1–M5:

- Count real rendering/API defects attributable to `webkit2gtk` on the Linux
  versions we support. Note which ones we could not work around.
- Check whether the browser panel and worktree monitor forced us into
  Tauri's `unstable` flag.
- Measure UI responsiveness on a long session (thousands of parts): virtual
  list scrolling, diff rendering, SSE backpressure.

Switch to Electron only if Linux webview defects are unfixable **and** they
hit the main path. Note it in this file with the defect list; do not
half-migrate.

---

## Milestone 6 — Product hardening

- Pin + auto-update policy for the sidecar (manual “update core” is fine
  for v1).
- Packaging: sidecar binary in the Tauri bundle (`externalBin`), Linux /
  macOS / Windows.
- Fallback: if `opencode` is already on PATH, let the user point at it.
- CI: typecheck, lint, vitest, cargo test, a smoke that boots the sidecar.
- e2e against a fake/local model later; not a substitute for Milestone 1.

---

## Milestone 7 — UX Polish & Power Features

1. **Startup & Boot Diagnostic Logs**:
   - Live log viewer on startup screen and onboarding with auto-reveal on error.
   - User can inspect stdout/stderr of `opencode serve` directly without opening terminals.
2. **Standard Native Window Decorations**:
   - Ensure standard OS window titlebar and controls in Linux/GNOME/KDE/macOS/Windows.
3. **Scheduled Message Queue**:
   - Queue up upcoming prompts while the agent is busy executing a task.
   - Choose specific model and agent/mode (build, plan, review) per queued item.
   - Auto-execute next task when the session becomes idle.
4. **Interactive Creature Mascot**:
   - Delightful animated vector creature on the empty chat state ("What are we building?").
   - Responsive micro-animations (breathing float, blinking eyes, glowing antenna).
5. **Soft Luxury Theme Presets**:
   - Replace harsh contrast with soft, ergonomic colorways (Midnight Slate, Warm Obsidian, Soft Paper / Sand, Nordic Frost).
   - Theme switcher in command palette, sidebar and settings.
6. **Recent Projects History (Up to 10 Projects)**:
   - Track and persist the last 10 opened project directories in local history.
   - Display on startup / onboarding screen with single-click quick open and removal.
7. **Provider Model Auto-Discovery & Reasoning**:
   - Probe endpoint (`/v1/models`) automatically as the key or URL is typed, with
     an explicit verified/failed status (HTTP 401 vs connection refused).
   - Multi-model selection with checkboxes, select-all, search, editable display
     names and manual add for unlisted IDs. A provider is not one model.
   - Reasoning is a per-model boolean toggle (auto-detected), never a slider —
     thinking-token budgets belong to the core, not the UI.
8. **Settings Panel (M8)** — driven by the pinned core's config schema, not
   invented options:
   - Appearance: the five theme presets.
   - Agent & Models: `model`, `small_model`, `default_agent`, `subagent_depth`.
   - Context & Tools: `compaction` (auto/prune/tail_turns/reserved),
     `tool_output` limits, `snapshot`, `shell`, `lsp`, `formatter`.
   - Permissions: per-action `ask`/`allow`/`deny` (bash, edit, webfetch, …).
   - Privacy & Logs: share/auto-update shown as locked-off, `logLevel`,
     `username`.
   - Writes go to the on-disk config file (`PATCH /config` does not persist)
     with `share`/`autoupdate` force-reapplied; the live core is patched too.
   - **No `streaming` toggle exists or may be added**: streaming is the event
     transport, not a config key.
9. **Streaming correctness (M8)** — regression-guarded against a live core:
   - `session.status` (`busy`/`idle`) is the authoritative busy signal.
   - `message.part.delta` renders streamed tokens; `permission.v2.*` is
     handled alongside legacy permission events, with a v2 reply fallback.
   - `test:integration` includes a store-level test that fails if the turn
     does not end by itself (the "working forever" bug).

---

## Milestone 9 — Workbench UX round two (DONE — all nine shipped)

1. **Composer**: taller by default (up to ~24 rows) and manually resizable —
   once the user drags it, autosize stops fighting them.
2. **Notifications**: task-completion events with desktop notification, sound
   and **ntfy** push (URL + topic in settings). Privacy note: the ntfy URL is
   user-configured, so it is an explicit user-chosen destination, not us.
3. **Sidebar = projects** (Onorca-style): sessions grouped by project
   directory, expand/collapse, click a session of the *current* project to
   open it; switching projects goes through the normal core restart.
4. **Skills & MCP per project**: checkbox per skill (shown/hidden in the
   presets layer — the core has no per-skill disable) and per MCP server
   (real `enabled` flag, written to the project's own `opencode.json` via the
   core's native project-config mechanism).
5. **Providers leave the sidebar**: management lives in Settings → Providers.
   The sidebar keeps only sessions/projects/skills/MCP.
6. **Bottom bar under the composer** owns working state: mode chips (from the
   core's agents, editable), model picker, and gear shortcuts into the
   relevant settings tabs.
7. **Theme + language in general settings**; ~10 UI languages via a compact
   built-in dictionary (no runtime i18n framework dependency).
8. **Voice input**: capture in the composer, transcribe through a local
   Whisper-compatible server (whisper.cpp / faster-whisper / LocalAI — the
   OpenAI `/v1/audio/transcriptions` shape), endpoint and model selectable in
   settings. A bundled Handy-style native engine stays future work; shipping
   a 1 GB model inside the app is not a v1 decision.
9. **Mode templates**: create/edit custom agents in Settings (written to the
   core `agent` config), chips at the bottom reflect them, gear icon opens the
   editor.

---

## Explicitly out of scope until the slice works

- A second agent backend (Oh My Pi, Claude Code CLI, “any CLI”).
  Agent-agnostic is an adapter **interface**, added after OpenCode is solid.
- Forking OpenCode.
- Plugin marketplace.
- LSP/DAP UI (the core already speaks LSP; a visual debugger is later).
- Collaboration / cloud sync.
- Mobile.
- Electron.

## Milestone 10 — Core surface parity (audit 2026-09)

An audit against the pinned core found API surface the client already has
methods for but the UI never calls, plus gaps in the client itself. Priority
order is driven by user harm: a lost permission prompt hangs the agent.

### 10.1 — Permission sync + SSE reconnect (highest priority)

- Add `GET /permission` to the client; on connect (and reconnect), merge
  pending requests into the store so a prompt lost mid-stream resurfaces
  instead of hanging the agent forever.
- Auto-reconnect the SSE stream with capped exponential backoff (250 ms →
  8 s). A dropped stream must heal itself; today it dies with an error card.
  Surface a low-key "reconnecting" state, not an alarm, while retrying.

### 10.2 — OAuth provider login

- `GET /provider/auth` already returns per-provider auth methods (api key,
  oauth, device flow). Settings → Providers must render them and run the
  OAuth flow: `POST /provider/:id/oauth/authorize` → system browser →
  `POST /provider/:id/oauth/callback`.

### 10.3 — Local stdio MCP servers

- The add-server dialog must support `type: local` with command / args / env
  alongside remote URL. Env is key-value rows; secrets stay in core config.
- Show `McpStatus.error` text next to a failed server, list its `tools`, and
  give a reconnect button (`connectMcp`).

### 10.4 — Todos panel

- `todo.updated` is already projected into the store but rendered nowhere.
  Render the live list under the composer; load `GET /session/:id/todo` on
  session open.

### 10.5 — Session hygiene

- Rename session (inline in the sidebar, `PATCH /session/:id`).
- Slash commands from `GET /command` offered in the composer.
- `POST /session/:id/init` button to generate project AGENTS.md.

### Status (2026-09-22)

- 10.1, 10.2, 10.3, 10.4 — done.
- 10.5 — done, including the gap the composer review found: completion alone
  was never enough, `send()` now routes a leading `/known-command` through
  `POST /session/:id/command` (unknown `/tokens` stay plain text).

### 10.6 — Deferred

- Manual compaction (`summarize`), `unrevert`, file/text search in Explorer,
  `GET /lsp` status — real gaps, lower harm; schedule after 10.1–10.5.

---

## When to fork

Only if Milestone 1 shows we cannot: stage writes the way we want, inject
the browser tool, disable share/Zen, or keep the GUI from depending on
their TUI control endpoints. Even then, fork from the pinned tag and
rebase; do not copy the tree into this repo piecemeal.

---

## Rejected: Oh My Pi as the core

Evaluated `can1357/oh-my-pi` (MIT, TypeScript + Rust, ~30k stars, very
active) as an alternative core. It is a strong agent — arguably deeper than
OpenCode in places — but it is the wrong core **for this product**. Recorded
here so the decision is not relitigated from memory.

1. **No HTTP server.** Their README states the four wrappers plainly: TUI,
   `omp -p` one-shot, an in-process Node SDK, and `omp --mode rpc` / `omp acp`
   over **stdio**. There is no HTTP/SSE surface and no OpenAPI spec.
   Consequences:
   - “Frontend talks to the core directly, almost no code” dies. A browser
     cannot speak stdio, so Rust must proxy every message — exactly the
     layer rule 2 forbids and exactly where the old BuzzAgent rotted.
   - `docs/rpc.md` requires 1 MiB frame caps, manual `rpc_chunk` reassembly
     with base64 segments, `chunkId`/`index`/`count`/`byteLength` validation
     and v1/v2 negotiation. That is a transport to maintain, not consume.
   - No spec means no generated client; types are hand-maintained against a
     moving private protocol.
2. **Telemetry cannot be turned off from the outside.** `docs/install-id.md`
   documents a persistent UUID at `~/.omp/install-id` that survives wiping
   agent state. Documented consumers include an auth-broker “observed-usage”
   report **that also sends hostname**, and auto-QA “grievance pushes”.
   Some of it is provider compatibility (Codex `installationId`, Anthropic
   `device_id`), but the broker/QA paths are outbound reporting. Making our
   zero-telemetry claim true would require patching their runtime — i.e. a
   fork, which defeats the reason for using someone else's core.
3. **The niche is taken.** GUIs for OMP already exist: `am-will/gooey-pi`
   (~880★), `FaqFirebase/pi-desktop` (Electron, chat/diffs/terminal),
   `BRCOO/ohmypi-craft`, `kahme247/ompweb`. We would arrive fourth with no
   advantage.

Where OMP is genuinely ahead of OpenCode, and worth watching: LSP in the
loop, DAP, hashline edits, a large native Rust layer, `pr://` / `issue://` /
`agent://` URI schemes, model fallback chains, and a browser relay.

**Second-backend path.** Do not wire OMP in as a bespoke RPC integration.
If and when we add a second backend, do it through **ACP** (`omp acp`), which
is a shared protocol rather than a private one, behind an adapter interface
defined *after* Milestone 1 proves the OpenCode slice. Two cores before one
works means neither ships.

## 2026-09: GUI parity research — Claude Code & peers

Researched (docs, Sep 2026): **Claude Code** command reference, **opencode
TUI** docs, **Cursor** agent/IDE surfaces, plus the earlier Aider/Windsurf
pass. What their CLI/TUI/IDE layers have that our GUI still lacks, mapped to
what the pinned core already supports — i.e. GUI-only work, no core fork.

Gap analysis (theirs → ours):

| Their feature (Claude Code / opencode TUI / Cursor) | Core support | Verdict |
|---|---|---|
| `/init` — generate/update AGENTS.md | agent writes files | **do now** |
| `/compact` — summarize session in place | `POST /session/{id}/summarize` | **do now** |
| `/export` — conversation → Markdown | messages in store | **do now** |
| `/copy` — copy last reply | clipboard | **do now** |
| `/undo`·`/redo` (TUI) — revert last turn + files | `revert`/`unrevert` client methods exist, no UI | **do now** |
| `/context` — token breakdown visual | `MessageInfo.tokens` per message | **do now** (StatusBar) |
| `/cost`·`/usage` — spend tracking | `session.cost`, `tokens.cost` | **do now** (StatusBar) |
| `/btw` — side-question without history | needs provider support for non-persisted ask | later |
| `/branch`, `/fork` — conversation branches | core `parentID` exists; UI model unclear | later |
| `/rewind` — checkpoint picker | needs checkpoint snapshots (git stash juggling) | later |
| `/batch` — worktree-per-unit parallel execution | worktrees exist; orchestration is a big build | later |
| `@file` fuzzy references in prompt | core accepts file parts; UI missing | **do now** (basic) |
| `!cmd` — bash passthrough as tool result | permission-gated core bash tool | **do now** (confirmation via existing permission flow) |
| Checkpoints / Tab autocomplete / multi-agent composer UI | — | out of scope (wrong architecture or no core support) |

### Batch 1 — Chat power commands (all core-supported, low risk)

**B1.1 Built-in slash commands.** New `src/lib/builtinCommands.ts`: typed
registry (name, aliases, description, argument hint, run()). Composer: typing
`/` shows built-ins merged with project commands (already implemented); Enter
executes. Store gains `runBuiltin(name, args)`. Commands:

- `/init` — sends a seeded prompt that makes the agent write/update
  `AGENTS.md` (bump `fsVersion` after completion);
- `/compact` — `client.summarize(sessionId, model)` then re-`GET /session/{id}/messages`;
- `/export [file]` — Markdown transcript of the session (ask path via the
  dialog plugin) written through `core_write_project_config`-style fs command;
- `/copy [n]` — last (or Nth) assistant reply → clipboard;
- `/undo`, `/redo` — `client.revert`/`unrevert` on the last user message, then
  re-`GET messages` + `git_changes` refresh;
- `/help` — modal listing built-ins + project commands (reuses CoreLogModal shell).

**B1.2 `@file` references.** Typing `@` in the composer opens a fuzzy file
finder over the explorer tree (`fs_tree` recursion, capped depth), Tab/Enter
inserts the relative path. Sent as a plain text path (the agent resolves it);
no `user/inserts` dependency.

**B1.3 `!command` passthrough.** A `!`-prefixed submit sends the text as a
normal user message whose visible text explains it is a bash request — the
core's own permission flow gates execution. Title bar of the queued message
shows the raw command. (Honest version: the core has no "run without model"
endpoint; documented as such.)

### Batch 2 — Session insight

**B2.1 StatusBar session chip.** Context tokens + cost of the active session
(sum over `messages`), click → popover with per-message breakdown (input,
output, reasoning, cache read/write, cost) for the last N messages, plus a
`/compact` shortcut when tokens look heavy.

**B2.2 Context meter.** Colored usage bar in the same chip vs the model's
`limit.context` when known (from the provider catalogue); neutral when
unknown.

### Batch 3 — Session management niceties (stretch, this pass only if cheap)

- **Duplicate/branch a session**: copy transcript into a new session
  (read-only clone; core-side forking is not exposed). Only if messages →
  new-session copy can be done with existing endpoints; otherwise defer.
- **Session rename** exists; add **pinned sessions** (localStorage) at top of
  the list.

Explicitly **not** doing (rationale recorded): token-estimated checkpoints
(`/rewind` — needs snapshot infra), `/batch` orchestration (big build, later
milestone), `/btw` (needs provider support), Tab-completion of code (wrong
architecture for a chat GUI), multi-agent parallel composer (needs core-level
session fan-out).

### Implementation order

1. `builtinCommands.ts` + store wiring + composer integration (B1.1)
2. `@file` finder (B1.2) → `!cmd` hint (B1.3)
3. StatusBar chip + context meter (B2)
4. Tests: builtin command resolution, export formatting, undo/redo store
   transitions, StatusBar aggregation; then full gate
   (`typecheck`, `lint`, `vitest`, `cargo test`).

---

## 2026-09: Language audit — English-only code & full i18n coverage

Two user requests, one audit:

1. **Code language audit.** Russian (or any non-English text) may live only in
   localization files (`src/lib/i18n.ts`, `README/` translations). Everything
   in `src/`, `src-tauri/src/`, `scripts/`, `electron/`, `landing/` must be
   English: identifiers, comments, string literals, commit-facing text.
   Method: `grep -rnI '[А-Яа-яЁё]' src/ src-tauri/src/ scripts/` (excluding
   `src/lib/i18n.ts`), translate every hit, re-run until clean.

2. **i18n completeness.** The dicts for uk, de, es, fr, pt, it, ja, hi, ar,
   bn, id, tr use `...en` spread + ~30 overrides, so ~137–147 UI strings per
   language silently render in English (menus, settings, picker, import/export,
   editor, files, help, voice, modes, oauth, error kinds…). zh has 30 such
   keys. Fix: replace every non-en/ru dict with a **flat, complete dictionary**
   (all 171 keys, no inherited English), keep en/ru as-is, keep the `t()`
   English fallback as a safety net for future keys.

Verification: node script compares key sets across `DICTS` (must be equal,
171 keys each) and flags values identical to English (allowed only for
proper nouns like "BuzzAgent"). Gate: `typecheck`, `lint`, `vitest`,
`cargo test` (nothing outside `i18n.ts` should change).

## 2026-09: Release engineering — distributable builds

Goal: user-facing installers for Linux, macOS, Windows.

**Linux (built locally, done).** `npm run build` (tauri build) produced the
deb; AppImage assembled with `appimagetool` (payload: buzzagent + pinned
opencode sidecar in `usr/bin`, AppRun exports PATH so `find_opencode_binary`
finds the sibling); rpm hand-built with `rpmbuild` (tauri's rpm bundler hangs
with rpm 4.20 — the bundler stages files then blocks; manual spec mirrors the
deb layout: /usr/bin/{buzzagent,opencode}, .desktop, hicolor icons). Artifacts
land in `releases/`. Verified: deb control + file list, rpm -qlp, AppImage
launches (exit 0).

**Windows/macOS (CI, already wired).** `.github/workflows/release.yml` builds
on `windows-latest` + `macos-latest` (aarch64 and x86_64 targets) and attaches
`.msi`/`.nsis` and `.dmg` to a GitHub Release on tag push. Local cross-build
is not possible here (no macOS SDK; wine/NSIS unavailable). Path: push the
repo (with all untracked src/**) to GitHub, then `git tag v0.1.0 &&
git push origin v0.1.0`.

## 2026-09-26: Hotfix 0.1.1 — webview cannot reach the core behind a proxy

**Symptom (external machine):** AppImage logs show `opencode` loading its
configs (the Rust health-check passed), then the UI reports
"Cannot reach the agent core at http://127.0.0.1:<port>".

**Root cause:** the webview's network stack (WebKitGTK/libsoup) reads proxy
settings from the environment / desktop session at startup. On machines with
`http_proxy` set (or a GNOME/KDE system proxy) the webview routed its
`fetch("http://127.0.0.1:<port>")` through the proxy. The Rust-side health
check is immune (reqwest built with `.no_proxy()`), which is exactly why the
core looked healthy while the UI could not connect.

**Fix:** `ensure_loopback_bypass()` in `src-tauri/src/main.rs` appends
`127.0.0.1`, `localhost`, `::1` to `NO_PROXY`/`no_proxy` **before** Tauri
initializes, so the webview inherits a correct bypass list. Unit test
`loopback_is_added_to_proxy_bypass` added (cargo: 25 tests).

**Rebuild:** version bumped to 0.1.1 (package.json, tauri.conf.json,
Cargo.toml/lock only — no dependency drift). Linux artifacts rebuilt and
replaced in `releases/` (deb via tauri bundler; rpm via rpmbuild with the
%files icon list extended; AppImage via appimagetool with a compliant
`Exec=AppRun` AppDir). Verified: AppImage survives 30s under Xvfb, sidecar
inside deb reports 1.18.30, SHA256SUMS.txt written.

**Status:** DONE for Linux. Windows/macOS remain CI-only
(.github/workflows/release.yml builds them on tag push).

## 2026-09-28: Hotfix 0.1.2 — all core traffic routed through Rust IPC

**Symptom:** 0.1.1 still failed on the external machine; the core log gained
`Failed to fetch models.dev … TimeoutError`, i.e. the box sits behind a
restrictive proxy/filtered network. The webview (WebKitGTK/libsoup) reads
proxies from the desktop session, not just the environment, so the 0.1.1
NO_PROXY env fix cannot cover every setup.

**Fix (structural):** the webview no longer talks to the core over the
network at all.
* `core_http` (Rust): proxies one request (method/path/body → status + base64
  body). reqwest built with `.no_proxy()`; auth attached in Rust, never sent
  per-call from JS.
* `core_events_start` / `core_events_stop`: an SSE pump task streams
  `/event` frames over a Tauri Channel (event/connected/dropped), with
  capped-backoff reconnect and per-attempt connection re-resolution, so a
  core restart on a new port is followed automatically.
* `CoreClient` uses the IPC path when `__TAURI_INTERNALS__` is present and
  keeps the direct-fetch path for plain-browser dev and the existing unit
  tests. `t()`-style fallback untouched.
* `wait_until_healthy` budget doubled to 480×250ms (2 min): a cold start on
  a filtered network stalls while the core fetches models.dev.
* Cargo: reqwest `stream` feature + `futures-util` (SSE byte stream).

**Gates:** typecheck ✅, eslint ✅, vitest 105/105 (4 new IPC tests:
proxy-through-Rust, error mapping, HTTP error surface, channel subscribe +
unsubscribe stop), cargo 25/25.

**Release 0.1.2:** deb (tauri), rpm (rpmbuild workaround), AppImage
(appimagetool, `Exec=AppRun`); all in `releases/` with SHA256SUMS.txt.
The whole flow is codified in `scripts/build-linux-release.sh`.

## 2026-09-28: 0.1.3 — UI zoom (Ctrl +/-/0, Ctrl+wheel, settings)

Confirmed working on the previously problematic machine after 0.1.2. Next
usability gap: WebKitGTK offers no Ctrl+Plus/Minus/0 or Ctrl+wheel zoom.

* `src/lib/zoom.ts`: 17-step zoom table (25%…500%), persisted index
  (`buzzagent.zoom`), `applyZoom` via Tauri v2 `getCurrentWebview().setZoom`,
  and a pure `zoomActionFromEvent` resolver (Ctrl/⌘ + `=`/`+`, `-`/`_`, `0`,
  wheel). Unit-tested (5 tests).
* Store: `zoomIndex` + `changeZoom(in|out|reset)` (persists, applies).
* `App.tsx`: applies the stored zoom on boot; global keydown + non-passive
  wheel listeners drive `changeZoom`.
* Settings → General: zoom stepper (−/%/+/reset), localized in all 15
  languages (`settings.zoom*`).
* Capability: `core:webview:allow-set-webview-zoom` added.
* `npm run build` now runs `tauri build --bundles deb` (the rpm bundler hangs
  on rpm 4.20; rpm is produced by scripts/build-linux-release.sh instead).

**Gates:** typecheck ✅, eslint ✅, vitest 110/110 (16 files), cargo 25/25.
**Artifacts:** releases/ 0.1.3 deb/rpm/AppImage + SHA256SUMS.txt.

## 2026-09-28: 0.1.4 — zoom settings section shows the shortcuts

The Settings → General zoom section now renders the shortcuts as keycaps
(Ctrl +, Ctrl −, Ctrl 0, Ctrl+wheel with a localized "wheel" label,
`settings.zoomWheel` in all 15 dicts); the descriptive hint became a plain
"adjust the size of the entire interface" line in all languages. Rebuilt and
published 0.1.4 artifacts + SHA256SUMS. Gates: typecheck/lint ✅, vitest
110/110, cargo 25/25.

## 2026-09-28: 0.1.5 — real app icon (branding)

The shipped icons were placeholder-looking; replaced with a proper logo:
Lucide "zap" bolt (ISC-licensed glyph, attribution kept in
branding/logo/lucide-ISC-LICENSE.txt) on a blue gradient app tile matching the
default theme accent. Source of truth: branding/logo/buzzagent-icon.svg;
full Tauri set regenerated (32/64/128/256 PNG + 512 icon.png + multi-size
icon.ico built with a small python/struct packer). Rebuilt and published 0.1.5
artifacts + SHA256SUMS in releases/; verified icons inside the deb and that
the AppImage still launches. Branding docs: branding/logo/README.md.

## 2026-09-28: 0.1.6 — bee logo (Twemoji) + on-screen brand mark

Replaced the bolt icon with the landing-page mascot: the Twemoji honeybee
(1f41d, MIT licensed — free to use as a logo) centered on the blue tile.
Source: branding/logo/buzzagent-icon.svg (full Twemoji paths embedded
verbatim); full Tauri icon set regenerated. The same SVG ships as
src/assets/app-icon.svg and is shown on the main screen above the greeting
(EmptyChat) and in the custom titlebar. Added src/vite-env.d.ts (vite client
types + *.svg module) for asset imports. Gates: typecheck/lint ✅, vitest
110/110. Published 0.1.6 artifacts + SHA256SUMS.

## 2026-09-28: 0.1.7 — standalone bee logo + global right-click menu

User feedback: the blue tile was rejected; the logo is the bee itself, plain.
* branding/logo/buzzagent-icon.svg is now the unmodified Twemoji honeybee
  (transparent background); full icon set regenerated, same SVG ships in the
  UI (titlebar + greeting).
* Right-click anywhere now opens a context menu (WebKitGTK has no native
  one): Copy / Cut / Paste / Select all with keycap hints, localized in all
  15 languages (ctx.*). Copy has a backend fallback via the new
  clipboard_write_text command (wl-copy/xclip). The file-tree menu keeps
  priority; elements can opt out with data-ctx="native".
* Fixed silent Cargo.lock corruption from earlier `sed` version bumps (hit
  alphabetically-earlier packages; android_system_properties was pinned to a
  nonexistent 0.1.7). Restored via cargo update; lock verified
  (cargo check --locked OK). Future bumps must target the buzzagent block.
Gates: typecheck/lint/vitest 110/110, cargo 25/25. Artifacts 0.1.7 published.

## 2026-09-28: 0.1.8 — bee with a face (Noto) as the logo

User rejected the top-down Twemoji bee (viewed from behind, face not
visible): the face must be
visible. Four free-license candidates were rendered side by side for the user
(Fluent Flat/Color — MIT, Noto — OFL, OpenMoji — CC BY-SA); the user picked
**Noto** (bright yellow, big eye, best silhouette at 16–32px).
* branding/logo/buzzagent-icon.svg = Noto honeybee standalone (transparent),
  full icon set regenerated; same SVG in the UI (titlebar + greeting).
* Added scripts/bump-version.sh: updates package.json, tauri.conf.json,
  Cargo.toml and ONLY the buzzagent block of Cargo.lock (the safe way to bump
  after the 0.1.7 lockfile corruption incident).
Gates: typecheck/lint/vitest 110/110, cargo 25/25. Artifacts 0.1.8 published.

## 2026-09-28: 0.1.9 — project switching fixes (new chat + file tree)

Two user-reported bugs, one root cause:
1. "New chat" after picking a project landed in a DIFFERENT project.
2. The Files tab showed nothing for any project.

Root cause: `CoreSupervisor::start()` returned the existing connection
whenever the core was Running/Starting, IGNORING the requested directory.
So `core_start(otherProject)` silently kept the old core (old directory):
sessions were created in the wrong project, and the file tree (driven by
the UI's projectDir) diverged from the core's cwd.

Fixes:
* Rust `core_start` now canonicalizes the requested directory and reuses the
  running core ONLY if its directory matches AND it is Running; otherwise it
  stops and starts the core in the requested project.
* ExplorerView resets levels/expanded/selection on projectDir change (stale
  cache between projects).
* SessionList: clicking a project row now OPENS that project (switches the
  core, first session or fresh), right-click toggles collapse — before,
  clicking a project only collapsed it, so "New session" had no way to
  target it.

Gates: typecheck/lint/vitest 110/110, cargo 25/25. Artifacts 0.1.9 published.

## 2026-09-28: 0.1.10 — "error decoding response body" + dead-model recovery

User hit `error decoding response body` on the first prompt. Live-core
reproduction: prompt_async returns 204 and streams fine over a fresh
connection — the failure is reqwest reusing a keep-alive socket that the
Bun-based core had already closed (its idle timeout is shorter than ours),
which surfaces as reqwest's opaque decode error on the NEXT request.

* AppState HTTP client: pool_idle_timeout(20s) + pool_max_idle_per_host(0) —
  no connection reuse, no stale sockets; cost is negligible next to a model
  call.
* core_http error mapping: decode failures now read "The core returned a
  malformed/truncated response for POST /path (…)"; connect/request failures
  name the core URL — no more bare reqwest strings.
* session.error handler: on ProviderModelNotFoundError (pinned model renamed
  or removed from the catalogue — the second failure seen live) the dead
  model selection is dropped so the composer picks a valid one instead of
  failing every turn. Covered by 2 new store tests (vitest 112).
Gates: typecheck/lint/vitest 112/112, cargo 25/25. Artifacts 0.1.10 published.

## 2026-09-28: 0.1.11 — errors were invisible (session.error data wrapper)

User: "the cursor blinks as if thinking, but the logs show AI_APICallError:
Forbidden — the user never sees it." Live-core capture of a failing turn
confirmed the sequence busy → session.error → idle → session.error, with the
real text nested as `error.data.message` (name is a generic "UnknownError").
Our extractMessage did not traverse `data`, so the UI showed nothing/unknown.

* errors.ts: extractMessage now traverses the `data` key — session.error with
  error.data.message surfaces verbatim ("AI_APICallError: Forbidden", "Model
  not found: …", provider payloads).
* session.error dead-model detection reads data.message too.
* busy is cleared by session.error and again by the core's own idle status
  (verified order in the capture), so the blinking "thinking" state ends with
  a visible error card instead of silence.
* New store test pins the data-wrapper shape (vitest 113).
Gates: typecheck/lint/vitest 113/113, cargo 25/25. Artifacts 0.1.11 published.

## 2026-09-29: 0.1.12 — live turn status (retry visibility)

User hit a hung turn: cursor blinked for an hour with zero feedback. Live-core
capture found the missing piece: `session.status {type:"retry", attempt, message}`
— the core retries a dead provider call every 5 minutes and the UI treated every
non-idle status as a bare `busy: true`. Now:

- store keeps `turnStatus {type, message?, attempt?, since}` (busy/retry/idle)
- chat shows "Thinking {s}s…" with a live per-second counter, and on retry the
  actual reason: "Retry {n} — Provider response headers timed out after 300000ms"
- status bar mirrors the retry state; idle/error/abort clear the status
- i18n keys `turn.thinking` / `turn.retry` in all 15 languages
- +3 event-projection tests (116 total); verified against a live core that the
  retry frame arrives with attempt counter and provider timeout message.

## 2026-09-29: 0.1.13 — crash-proof shell + cross-realm SSE fix

User hit a plain white window on opening a project. Root-cause work:

- **White screen could not speak.** No ErrorBoundary and no window error
  handlers existed: any render crash unmounted the tree to a blank window with
  zero text, and a packaged webview has no devtools open by default. Now a
  top-level boundary renders a recovery screen (message, stack, component
  stack; Reload / Reset UI data / Copy diagnostics), window.onerror and
  unhandledrejection show a dismissable overlay and persist a crash report
  (`buzzagent.lastCrash`, TTL 7d) that is surfaced on the next launch.
- **Diagnostics leave the webview.** New `ui_log` command appends frontend
  crash reports and UI phase breadcrumbs to `debug.log` next to the core data;
  `buzzagent.jsboot` localStorage stamp proves whether the bundle executed at
  all. `BUZZAGENT_AUTOPILOT_PROJECT` (unset by default) auto-opens a project
  for scripted headless runs, since native dialogs cannot be driven.
- **The actual white-screen crash (user-confirmed).** The boundary's first
  catch reported `d.includes is not a function` in ProjectsList:
  `buzzagent.hidden_projects` was written as an array by `removeProject`, but
  `loadJson` spread every stored value into the object-shaped fallback,
  reloading the array as `{0:…,1:…}` — `.includes` vanished and the projects
  panel crashed the whole render on the next launch. `loadJson` now validates
  against the fallback's shape (arrays load as arrays, garbage falls back),
  and ProjectsList tolerates a non-array `hiddenProjects` defensively.
  Regression tests: `src/store/persist.test.tsx` (5).
- **Overlay is copyable.** The runtime-error overlay first shipped without a
  way to get the text out (user rightly complained): the message is now
  selectable and a "Copy details" button copies the full formatted report —
  via the Tauri clipboard command in-app, web API in browser. The crash
  screen's Copy button uses the same helper. Tests:
  `src/components/ErrorBoundary.test.tsx` (4).
- **Stale crash reports nag once, not forever.** The previous run's report
  was shown at every launch for a week; now `surfacePreviousCrash()` shows it
  once and clears it (the full text already lives in debug.log). Verified on
  the packaged AppImage: injected stale report is absent from localStorage
  after the next launch.
- **Turn watchdog: a blind SSE channel can no longer hang a turn.** User
  report: sent a prompt, caret blinked forever, no "Thinking Ns" — the core
  log showed the turn completing (`exiting loop`) while the UI saw nothing,
  i.e. the event channel was dead while `busy` (set optimistically on send)
  could never clear. Now every SSE event feeds a liveness timestamp; a
  watchdog (5s tick, 20s staleness) detects "busy with no events", re-pulls
  the authoritative messages over HTTP, clears `busy` when the turn already
  ended (unfinished running tool part = still busy), logs both facts to
  debug.log (`watchdog: …`) and then processes the queue. Recovery covered
  by `src/store/watchdog.test.ts`; vitest 126/126.
- Live AppImage verification of this build: poisoned hidden_projects →
  boot → onboarding → ready, no crash report; stale-report cleared after one
  showing.
- **Real defect found and fixed (integration suite).** The browser SSE branch
  passed a jsdom AbortSignal straight to Node/undici `fetch`, which rejects a
  foreign-realm signal (`TypeError: Expected signal … to be an instance of
  AbortSignal`) — the stream then retried forever and no event ever arrived:
  "clears busy" and "streams events over SSE" failed against a live core.
  The client now falls back to a signal-less request and checks `aborted`
  per frame. Integration run: 10/10 (was 8/10); regression tests live in
  `src/tests/sse-probe.test.ts` (skipped without a live core).
- Ready-phase audit found no crash: layout/zoom/theme/recent-projects loaders
  normalise, ToolCard/StatusBar/MessageList/Explorer/Diff/Worktree panels are
  defensive. On the dev machine the WebKit webview does not execute JS under
  Xvfb at all, so the user's exact repro needs their environment — the new
  overlay/boundary will now show the cause there instead of a white window.
Gates: typecheck/lint, vitest 126/126, integration 10/10, cargo 25/25.
Release 0.1.13 verified live on the real display (AppImage run, autopilot
into the project, poisoned hidden_projects): boot → onboarding → ready, no
crash report, stale report cleared after one showing.
Artifacts 0.1.13 published (AppImage 4f3cb570…, deb 736cbd9a…, rpm 483e54f9…).

## 2026-09-30: 0.1.14 — visible build id + rebuild confusion kill

The 0.1.13 series was rebuilt several times under one file name, so "I still
see the bug" was unanswerable: the user could not tell which build ran, and
a stale crash report from the first build kept resurfacing. Fixes:
- **Per-build id in vite.config.ts** (package.json + App.tsx + timestamp →
  sha256, 8 hex chars, `__BUILD_ID__` define).
- **Status bar shows `b.<id>`** (selectable, tooltip asks to include it in
  bug reports); the crash screen header and the runtime-error overlay both
  show it; `formatCrash` now emits a `Build:` line so every copied report
  names the exact download.
- **releases/ holds only the current version**: old 0.1.13 artifacts moved
  to releases/old/ — downloading a stale rebuild is no longer possible.
Gates: typecheck/lint, vitest 126/126. Release verified live on the real
display (AppImage 0.1.14, autopilot into the project): boot → onboarding →
ready, process alive, no error output; build id `c29da6b2` confirmed in the
shipped bundle.
Artifacts 0.1.14 published (AppImage 4e3bdb2e…, deb b1f70bfe…, rpm 5bd4adad…).

## 2026-09-30: 0.1.15 — instant reasoning chip + message actions

**Reasoning chip took ~a minute to react.** toggleModelReasoning routed
through saveCustomProvider, whose step 3 is a full `core_restart`: every
click tore down the SSE stream, killed any running turn, reset the selected
model to the provider's first and left the chip dead until the restart
finished. The Rust command already writes the file and PATCHes the live
core's /config (4 s timeout), so the restart was pure cargo cult:
- flip `reasoning` optimistically in `customProviders` — the chip changes
  colour the same tick;
- persist via `core_save_custom_provider` only; on failure roll the flip
  back and surface the error (no silent failures);
- selected model is untouched.

**Message actions.** New `MessageActions` (hover row, top-right of a
message, invisible until hover/focus): copy (Tauri-clipboard helper, ✓
feedback), edit — user messages put the text back into the composer via
the new one-shot `composerDraft`, rerun — assistant messages re-send the
same prompt as a new turn (disabled while busy).
Gates: typecheck/lint, vitest 131/131 (5 new: optimistic flip, no
`core_restart` invoked, rollback+report, settings fallback, draft).
Release verified live (AppImage 0.1.15, autopilot): boot → onboarding →
ready, process alive, no errors; build id `871311f7` in the bundle.
Artifacts 0.1.15 published (AppImage ebe3b2df…, deb cc6978bb…, rpm 58b9915f…).

## 2026-09-30: 0.1.16 — reasoning effort levels + confirm-dialog crash fix

**No way to choose HOW MUCH the model thinks** — the reasoning chip was
on/off only. The core's prompt schema takes a top-level `variant: string`
next to model/agent/parts, and at request time merges
`model.variants[variant]` into the model's options (model → agent →
variant), which end up in the LLM call's providerOptions. For
@ai-sdk/openai-compatible providers the SDK maps `reasoningEffort` to the
wire field `reasoning_effort` (confirmed in the shipped binary:
`reasoning_effort:D.reasoningEffort`), and the core's own catalogue
generator emits exactly `{reasoningEffort: B}` per level for this provider
package. So:
- Rust `CustomModelEntry` gained `level: Option<String>`; when reasoning is
  on, `add_custom_provider` writes per-model `variants` =
  minimal/low/medium/high/xhigh/max, each `{reasoningEffort: <same>}`
  (verbatim from the core's own generator — proven keys, no guessing);
- `promptAsync`/`prompt` accept `variant` and send it TOP-LEVEL in the body
  (nesting under model would be ignored by the schema);
- store: `setModelReasoningLevel(level | "off")` and shared
  `setModelReasoningState` engine — same instant pattern as 0.1.15
  (optimistic update, `core_save_custom_provider` only, rollback + report,
  NO `core_restart`). Choosing a level turns reasoning ON; "off" clears
  flag AND level. `send()` passes the active model's level as `variant`;
  toggling the chip no longer wipes a chosen level;
- composer chip: click opens a menu (off/minimal/low/medium/high/xhigh/max;
  max/xhigh shown for completeness — strict endpoints may reject them),
  the active level is shown on the chip ("reasoning · high").

**Crash: "Command plugin:dialog|confirm not allowed by ACL"** (build
`c29da6b2`). Tauri v2 replaces window.confirm/alert with IPC-based versions
that return PROMISES. Two bugs: without the ACL entry the call rejects
(unhandledrejection → crash report), and with it `if (confirm(...))` is
always truthy (a Promise!) so "Remove provider?" deleted immediately.
Fixed both: added `dialog:allow-confirm`/`dialog:allow-ask` to
capabilities, and a main.tsx shim restores BROWSER semantics — a real
synchronous boolean dialog (webkitGenericprompt), IPC rejections swallowed.
Gates: typecheck/lint, vitest 137/137 (6 new: level persists optimistically
without restart, rollback+report, level⇒on / off clears, level survives
chip flip, toggle keeps level, top-level variant in prompt body), cargo
25/25, integration 10/10.
Release verified live (AppImage 0.1.16, autopilot): boot → onboarding →
ready, process alive, no errors; build id `cca7b11d` in the bundle.
Artifacts 0.1.16 published (AppImage e35cd11a…, deb 22833ce9…, rpm 7dd53aee…);
0.1.15 moved to releases/old/.

## 2026-09-30: 0.1.17 — sound-notification toggle in the chat toolbar

**Sound control buried in Settings.** The turn-completion sound
(notify.sound, WebAudio beep) could only be toggled through the settings
panel, far from where you notice it. Added a one-click bell to the composer
toolbar, next to reasoning/model: BellRing when on, BellOff (dimmed) when
off; flips notify.sound via the existing setNotify (localStorage-persisted,
shared with the Settings toggle). Reuses existing i18n labels — no new
dictionary keys.
Gates: typecheck/lint, vitest 137/137, cargo 25/25 (unchanged Rust).
Release verified live (AppImage 0.1.17, autopilot): boot → onboarding →
ready, process alive, no errors; build id `f798a328` in the bundle.
Artifacts 0.1.17 published (AppImage 958e74fd…, deb 516ac61c…, rpm b27814e4…);
0.1.16 moved to releases/old/.
