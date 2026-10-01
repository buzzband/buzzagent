# BuzzAgent — README translation template

Copy this file, rename it to `README.<lang>.md`, and translate **the entire
English README** — every section, same substance, no summaries. Keep the
links pointing at the English originals for deep detail. Do not translate
code identifiers, file paths, or command names. Keep the project-site line
(`🌐 … https://b4zz.com/agent`) at the top, translated into your language.

Every translation must be complete: the documentation hub declares all
language files equal, so a condensed version is a regression, not a
shortcut. Size reference: the English README is ~345 lines. Keep the project-site line
(`🌐 … https://b4zz.com/agent`) at the top, translated into your language.

---

**BuzzAgent** is an open-source visual workbench for AI coding agents. The
agent core is [OpenCode](https://github.com/anomalyco/opencode) (MIT);
BuzzAgent is the GUI client around it — not another agent runtime.

> **See everything the agent does. Control models, tools, browser, MCP, and
> reasoning — locally, with zero telemetry.**

## Why this exists

Visual agent tools are locked to an IDE and ship telemetry; terminal agents
are powerful but blind. BuzzAgent keeps the terminal agent's power (the
pinned [OpenCode](https://github.com/anomalyco/opencode) core) and adds a
visual desktop layer: chat with tool cards, visual diffs, an in-app browser
in the agent loop, git worktree orchestration, a permission inbox — with
zero telemetry and no account.

## Quick start

```bash
npm install
npm run setup:core   # downloads the pinned OpenCode core binary
npm run dev          # runs the desktop app
npm run dist         # builds installers (built with the core inside)
```

## What it does

- **Streaming chat** with tool-call cards, per-role reasoning and model
  routing; slash commands: `/init` (write AGENTS.md), `/compact`, `/export`,
  `/copy`, `/undo`, `/redo`, `/help`; `@file` references; `!command` shell
  passthrough.
- **Built-in command registry** merged with each project's own commands
  (project commands win).
- **Visual diffs** with word-level highlights and single-file revert;
  worktree-per-branch parallel agents.
- **Providers**: 75+ via the core; API key or OAuth; a model picker with
  inline "connect" for unconnected catalogue providers; two-way sync of keys
  and custom providers with your personal opencode CLI state.
- **Session insight**: token/cost totals and a context-window meter in the
  status bar.
- **Desktop shell**: custom or system window frame, tray icon, 15 interface
  languages.

## Zero telemetry

The core runs sandboxed (random port, per-run password, `share: disabled`,
`autoupdate: false`); no analytics, no crash reporting anywhere. Verified:
[docs/telemetry-audit.md](../docs/telemetry-audit.md).

## More

Full details, positioning, architecture and the honest costs (three webviews,
the Electron fallback): the English
[README](../README.md) · [PLAN](../PLAN.md) ·
[core API notes](../docs/core-api-notes.md). Questions about a specific
feature — check [PLAN.md](../PLAN.md) first; each decision is recorded with
its rationale.

License: [MIT](../LICENSE).
