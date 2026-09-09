# AGENTS.md — Guidelines for coding agents working on BuzzAgent

## Project overview

BuzzAgent is an open-source desktop workbench for AI coding agents
(Tauri/Electron + React + Rust). Zero telemetry is a hard requirement.

## Non-negotiable rules

1. **No telemetry. Ever.** Never add analytics, tracking, crash reporting or any
   network call other than: the user-configured LLM provider and user-added MCP
   servers. If a dependency phones home, remove the dependency.
2. **No terminal wrapper for the agent.** The visual layer talks to the agent
   core via IPC commands and the `agent-event` event stream — not by scraping a
   terminal.
3. **No temp config files.** Pass agent configuration through IPC arguments and
   environment variables only.
4. **Modular architecture.** Each component (agent core, browser, MCP, git,
   stores) must remain replaceable. Keep modules decoupled.

## Stack

- Frontend: React 18, TypeScript (strict), Zustand, xterm.js, Vite
- Desktop: Tauri 2 (primary), Electron (fallback shell)
- Agent core: Rust (`src-tauri/src/agent.rs`) — OpenAI-compatible chat,
  tool loop, staged writes
- Tests: Vitest (frontend), built-in `cargo test` (Rust)

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

- Code comments in English; README is bilingual (English + Russian).
- Backend events: `AgentEvent` in `src-tauri/src/agent.rs` is serialized with
  `serde(tag = "type", snake_case)` and must stay in sync with the `AgentEvent`
  interface in `src/types.ts`. If you change one, change both.
- File tools accept relative paths only; `..` traversal and absolute paths are
  rejected in `arg_rel_path`. Never relax this.
- Writes go through the staged-diff flow (`PendingWrite` → accept/reject);
  never write files directly from the agent loop.
- Hunk indices restart at 0 per file in `parse_git_diff` — the UI relies on it.

## Danger zones

- `shell_exec` runs with the user's privileges. Do not add auto-approval.
- MCP servers execute arbitrary local commands from their config — that is the
  user's choice; do not expand env inheritance beyond what is configured.
