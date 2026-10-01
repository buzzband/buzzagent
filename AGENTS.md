# AGENTS.md — Guidelines for coding agents working on BuzzAgent

## Project overview

BuzzAgent is an open-source desktop workbench for AI coding agents
(Tauri + React). The agent runtime is **not** in this repo: it is a local
`opencode serve` process (MIT, [anomalyco/opencode](https://github.com/anomalyco/opencode)).
BuzzAgent is the GUI client. Zero telemetry is a hard requirement.

Read `README.md` (concept) and `PLAN.md` (milestones) before changing
architecture.

## Non-negotiable rules

1. **No telemetry. Ever.** Never add analytics, tracking, crash reporting or
   any network call other than: the local OpenCode core, the user-configured
   LLM provider, and user-added MCP servers. If a dependency phones home,
   remove the dependency.
2. **No in-house agent loop.** Do not reintroduce `agent.rs`, a custom tool
   runner, or a parallel LLM client. The core owns the tool loop, sessions,
   diffs, permissions, MCP, and providers.
3. **Frontend talks to the core directly** over HTTP and SSE
   (`@opencode-ai/sdk`). Rust does not proxy session/message/event traffic.
   Rust only supervises the sidecar and exposes native extras (browser,
   git worktrees).
4. **No temp config files for the core.** Pass configuration through the SDK
   `createOpencode({ config })` argument and environment variables
   (`OPENCODE_SERVER_PASSWORD`, port). Forced sidecar config must include
   `share: "disabled"` and must not default `small_model` to OpenCode Zen.
5. **Core is the single owner of state.** Do not keep a second Zustand copy
   of auth, session history, or diffs that can diverge from the server.
6. **No Electron.** Tauri is the only desktop shell.
7. **Modular extras.** Browser and worktree modules must stay replaceable
   and must not leak into the core client layer.

## Stack

- Frontend: React 18, TypeScript (strict), Zustand, Vite
- Desktop: Tauri 2
- Agent core: OpenCode sidecar (`opencode serve`), pinned version, client
  generated from that version's OpenAPI spec (`GET /doc`)
- Native extras: Rust (`src-tauri/src/browser.rs`, later worktrees)
- Tests: Vitest (frontend), `cargo test` (Rust)

## Commands

```bash
npm run typecheck        # tsc --noEmit — must pass with 0 errors
npm run lint             # eslint — must pass with 0 errors
npm test                 # vitest — all tests must pass
npm run web              # vite dev server on :1420
cd src-tauri && cargo check && cargo test
```

Verify all of the above before finishing any change.

## Conventions

- Code comments in English. Shared docs (README.md,
  README/README.md hub, AGENTS.md, PLAN.md) are English-only; per-language
  files (README/README.<lang>.md) are written entirely in their own language
  — no mixing. Language self-names as link labels are the only exception.
- Do not invent event types. Render `Message` / `Part[]` and `/event`
  payloads as defined by the pinned OpenCode spec.
- File edits go through the core. Do not add a Tauri `write_file` that
  bypasses the core's permission and diff flow.
- `shell_exec` (and any destructive core tool) requires an explicit user
  permission response. Do not auto-approve.

## Danger zones

- `opencode serve` binds `127.0.0.1` and can run shell + write files.
  Always set `OPENCODE_SERVER_PASSWORD`, use a random port, and do not
  widen `--cors`.
- Sidecar version drift: bump the pin and regenerate the SDK together.
- Telemetry audit (PLAN.md Milestone 0) is a gate. Do not claim “zero
  telemetry” in user-facing copy until that audit is done and the forced
  config is in the supervisor.
