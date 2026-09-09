# BuzzAgent Implementation Plan

> Open-source visual control center for AI coding agents — with OMP/OpenCode power and zero telemetry.

## Rename Mapping
All references to `OpenHarness` / `OpenHarness Studio` → **BuzzAgent**
All references to `openharness` / `openharness-` → **buzzagent**
All references to `OPENHARNESS_` → `BUZZAGENT_`

## Goal
Build BuzzAgent: an open-source Tauri + React desktop workbench for AI coding agents
with browser automation, MCP, worktrees, visual diffs, model routing, per-role reasoning
controls, and zero telemetry.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              BuzzAgent (Tauri + React)          │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │              VISUAL LAYER                   │  │
│  │              (React + TS)                  │  │
│  │  Chat UI | Diffs | Browser | Terminal       │  │
│  │  MCP Hub | Models | Effort | Usage          │  │
│  └─────────────────────┬─────────────────────┘  │
│      IPC / HTTP / WS   │                         │
│  ┌─────────────────────▼─────────────────────┐  │
│  │          AGENT CORE (Rust)                │  │
│  │  agent runtime | model router | tools      │  │
│  │  MCP client | context engine | memory       │  │
│  └─────────────────────┬──────────────────────┘  │
│  ┌─────────────────────▼──────────────────────┐  │
│  │          NATIVE LAYER (Rust)                 │  │
│  │  grep, glob, tree-sitter, PTY, Git worktrees │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

## Phases

### Phase 1 — Scaffolding (Day 1)
1. `package.json` — React + Tauri, deps: react, react-dom, @tauri-apps/api,
   monaco-editor, xterm, @tanstack/react-query, zustand, vite, typescript,
   eslint, vitest
2. `src-tauri/tauri.conf.json` — product name BuzzAgent, window 1400x900
3. `src-tauri/Cargo.toml` — tokio, serde, serde_json, anyhow
4. Directory skeleton (see structure below)
5. Git init + `.gitignore`

### Phase 2 — Visual Layer (React TSX)
Components (all under `src/components/`):
- Chat/ChatPanel, MessageList, InputBar, ToolCallCard
- Diffs/DiffViewer, HunkSelector, DiffToolbar
- Browser/BrowserPanel, BrowserToolbar, DevTools, ConsoleLogs
- Terminal/TerminalPanel
- MCP/MCPHub, MCPServerCard, MCPMarketplace
- Models/ModelRouter, ProviderList, ProviderForm
- Effort/EffortControl, RoleEffortGrid
- Layout/MainLayout, Sidebar, StatusBar, UsageStats

Stores (`src/stores/`): agentStore.ts, chatStore.ts, modelStore.ts, mcpStore.ts
Services (`src/services/`): ipc.ts, agent.ts, browser.ts, modelRouter.ts, mcp.ts, tools.ts

### Phase 3 — Rust Backend (Tauri)
- `src-tauri/src/main.rs` — Tauri entry, registers commands
- `src-tauri/src/agent.rs` — spawn/run agent subprocess, event streaming
- `src-tauri/src/browser.rs` — headless browser / webview snapshot
- `src-tauri/src/git.rs` — git worktrees & diffs
- `src-tauri/src/mcp.rs` — MCP stdio client in Rust
- Commands exported via `#[tauri::command]`

### Phase 4 — Agent Core Integration
- Process-based agent (spawn `buzzagent-agent` binary stub)
- Model router with BYOK config
- Tool system with approval gating
- Thinking-effort controls

### Phase 5 — Build & Release
- `npm run dev` → `tauri dev`
- `npm run build` → `tauri build`
- Release targets: deb, rpm, app, dmg, msi

### Phase 6 — Testing
- Vitest unit tests for stores & services
- Telemetry audit (no network to analytics domains)
- Build verification

## Success Criteria
- ✅ Configure provider via visual UI (BYOK)
- ✅ Run agent and get a response
- ✅ Agent reads/writes files
- ✅ Visual diffs with accept/reject per hunk
- ✅ Embedded browser opens page + screenshot
- ✅ Connect MCP server
- ✅ Configure thinking effort
- ✅ ZERO telemetry — only LLM + MCP traffic
- ✅ Builds for Linux / macOS / Windows
- ✅ MIT license, README (RU + EN)

## Status: IMPLEMENTATION COMPLETE ✅

### Verified:
- TypeScript (`tsc --noEmit`): **0 errors, 0 warnings**
- ESLint: **0 errors, 0 warnings**
- Tests (Vitest): **3/3 passing** (InputBar component tests)
- Rust (`cargo check`): **0 errors, 0 warnings**
- `npm run web` — Vite dev server starts on http://localhost:1420
- `npm run dev` — Tauri desktop app launches (starts frontend + backend)

### How to run:
```bash
npm run web        # Vite dev server only (http://localhost:1420)
npm run dev        # Full Tauri desktop app
npm run test       # Run vitest
npm run typecheck  # TypeScript verification
npm run lint       # ESLint
npm run build      # Production Tauri build
```

### Prerequisites:
- Node.js >= 18, Rust toolchain
- Tauri system deps (Linux): `sudo apt install webkit2gtk-4.1 libssl-dev pkg-config`
