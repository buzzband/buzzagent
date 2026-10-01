# BuzzAgent — Español (README.es.md)

> This file is a summary in a condensed form; the full documentation is in the
> English [README](../README.md) and [PLAN](../PLAN.md). / Полная версия — в
> главном README (en/ru). The app interface itself is fully translated into
> Español — see Settings → General → Language.

**BuzzAgent** is an open-source visual workbench for AI coding agents. The
agent core is [OpenCode](https://github.com/anomalyco/opencode) (MIT);
BuzzAgent is the GUI client around it — not another agent runtime.

> **See everything the agent does. Control models, tools, browser, MCP, and
> reasoning — locally, with zero telemetry.**

## Why this exists

Visual agent tools are locked to an IDE and ship telemetry; terminal agents
are powerful but blind. BuzzAgent keeps the terminal agent's power (the
pinned OpenCode core) and adds a visual desktop layer — with zero telemetry
and no account.

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
- **Visual diffs** with word-level highlights and single-file revert;
  worktree-per-branch parallel agents.
- **Providers**: 75+ via the core; API key or OAuth; inline "connect" in the
  model picker; two-way sync with your personal opencode CLI state.
- **Session insight**: token/cost totals and a context-window meter.
- **Desktop shell**: custom or system window frame, tray icon, 15 interface
  languages (including Español).

## Zero telemetry

The core runs sandboxed (random port, per-run password, `share: disabled`,
`autoupdate: false`); no analytics, no crash reporting anywhere. Verified:
[docs/telemetry-audit.md](../docs/telemetry-audit.md).

## More

English [README](../README.md) · [PLAN](../PLAN.md) ·
[translations index](./README.md) · License: [MIT](../LICENSE).
