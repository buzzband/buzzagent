# BuzzAgent

**EN** | [Русский ниже](#полное-описание-на-русском)

Open-source visual control center for AI coding agents — with OMP/OpenCode power and zero telemetry.

> **Run any coding agent. See everything it does. Control models, tools, browser, MCP, and reasoning — locally.**

## Overview

BuzzAgent is a desktop workbench for AI coding agents. It combines the power of
terminal agents with a visual layer: chat, visual diffs, an embedded browser,
terminal, MCP hub, model routing and per-role reasoning controls.

- **BYOK** — bring your own key. Keys stay on your machine.
- **Zero telemetry** — no analytics, no tracking, no phone-home. Ever.
- **Visual everything** — diffs you can accept/reject, browser screenshots, tool-call cards.

## Features

- 💬 **Chat with the agent** — streaming responses, tool-call cards, stop control
- 🔍 **Visual diffs** — per-hunk accept, reject whole files, live `git diff` view
- 🌐 **Embedded browser** — headless Chrome navigation + screenshots
- ⌨ **Terminal** — run shell commands in the project directory
- 🔌 **MCP Hub** — connect any MCP (Model Context Protocol) server over stdio, browse and call its tools
- 🤖 **Model router** — OpenAI, Anthropic, DeepSeek, Google, Ollama, OpenRouter, custom (any OpenAI-compatible endpoint)
- ⚙ **Thinking effort** — Low / Medium / High / Max, mapped to `reasoning_effort`
- 📊 **Usage stats** — tokens and cost, computed locally

## Quick start

```bash
npm install
npm run web            # web-only dev server (http://localhost:1420)
npm run electron:dev   # full desktop app in dev mode (Electron)
npm run dev            # full desktop app in dev mode (Tauri, needs Rust)
```

### Production builds

```bash
# Tauri (recommended, smallest binaries): requires Rust toolchain
npm run build          # bundles: .app/.dmg, .msi/.nsis, .deb/.rpm/.appimage

# Electron alternative
npm run electron:build # AppImage/deb (Linux), dmg/zip (macOS), nsis (Windows)
```

Cross-platform targets are configured for **Linux, macOS and Windows**.

## How to use

1. Open the **Models** panel → **+ Add Provider** → pick a provider, paste your API key.
2. Select a model (defaults are populated per provider; Ollama needs no key).
3. *(Optional)* Set **Thinking Effort** in the Effort panel.
4. *(Optional)* Add MCP servers in the **MCP Hub** panel.
5. Go to **Chat**, type a task and send it — the agent reads/writes files in your project.
6. Review staged changes in **Diffs** → accept or reject per file/hunk.

The agent can: `read_file`, `list_files`, `write_file` (staged for your review), `shell_exec`.
File tools are restricted to the project directory; path traversal is rejected.

## Architecture

```
┌──────────────────────────────────────────────┐
│  Visual layer (React + TypeScript + Zustand) │
│  Chat │ Diffs │ Browser │ Terminal │ MCP │   │
│  Models │ Effort │ Usage                     │
├──────────────────────────────────────────────┤
│  Desktop shell: Tauri (Rust) / Electron      │
│  IPC commands + agent-event stream           │
├──────────────────────────────────────────────┤
│  Agent core (Rust)                           │
│  • OpenAI-compatible chat client             │
│  • Tool system + staged writes (diffs)       │
│  • Headless Chrome (browser screenshots)     │
│  • MCP stdio client (JSON-RPC 2.0)           │
│  • Git diff parser + worktrees               │
└──────────────────────────────────────────────┘
```

Key sources:
- `src-tauri/src/agent.rs` — agent loop, tools, staged diffs
- `src-tauri/src/mcp.rs` — MCP client (initialize → tools/list → tools/call)
- `src-tauri/src/browser.rs` — headless Chrome navigation/screenshots
- `src-tauri/src/git.rs` — unified-diff parsing with tests
- `src/stores/` — Zustand state; `src/services/` — IPC + agent services

## Telemetry guarantee

There is **no** telemetry, analytics or tracking in BuzzAgent. No network calls
are made except to the LLM provider you configure and the MCP servers you add.
You can verify: build from source and inspect outbound connections.

## Testing

```bash
npm test            # frontend unit tests (Vitest)
npm run typecheck   # TypeScript
npm run lint        # ESLint
cd src-tauri && cargo test   # Rust unit tests
```

## License

[MIT](./LICENSE) © BuzzAgent Contributors

---

## Полное описание на русском

BuzzAgent — open-source визуальный центр управления AI-кодинг-агентами: мощь
терминальных агентов + визуальный интерфейс, без какой-либо телеметрии.

### Возможности

- 💬 **Чат с агентом** — потоковые ответы, карточки вызовов инструментов, кнопка «Стоп»
- 🔍 **Визуальные диффы** — принятие/отклонение изменений по файлам и хункам, живой `git diff`
- 🌐 **Встроенный браузер** — навигация и скриншоты через headless Chrome
- ⌨ **Терминал** — выполнение команд в директории проекта
- 🔌 **MCP Hub** — подключение любых MCP-серверов (stdio, JSON-RPC), просмотр и вызов их инструментов
- 🤖 **Маршрутизатор моделей** — OpenAI, Anthropic, DeepSeek, Google, Ollama, OpenRouter, любой OpenAI-совместимый endpoint
- ⚙ **Thinking effort** — Low / Medium / High / Max (передаётся как `reasoning_effort`)
- 📊 **Статистика** — токены и стоимость, считается локально

### Быстрый старт

```bash
npm install
npm run web            # только веб-режим (http://localhost:1420)
npm run electron:dev   # десктоп-режим разработки (Electron)
npm run dev            # десктоп-режим разработки (Tauri, нужен Rust)
```

### Сборка релизов

```bash
npm run build          # Tauri: .app/.dmg (macOS), .msi/.nsis (Windows), .deb/.rpm/.appimage (Linux)
npm run electron:build # Electron-альтернатива для всех трёх ОС
```

Сборка настроена для **Linux, macOS и Windows**.

### Как пользоваться

1. Панель **Models** → **+ Add Provider** → выберите провайдера и вставьте API-ключ.
2. Выберите модель (списки по умолчанию подставляются автоматически; для Ollama ключ не нужен).
3. *(Опционально)* Задайте **Thinking Effort** в панели Effort.
4. *(Опционально)* Подключите MCP-серверы в панели **MCP Hub**.
5. В панели **Chat** напишите задачу — агент читает и пишет файлы проекта.
6. Изменения смотрите в панели **Diffs** → принимайте или отклоняйте.

Инструменты агента: `read_file`, `list_files`, `write_file` (только после вашего подтверждения), `shell_exec`.
Файловые инструменты ограничены директорией проекта; выход за её пределы блокируется.

### Гарантия отсутствия телеметрии

В BuzzAgent **нет** телеметрии, аналитики и трекинга. Сетевые запросы идут только
к выбранному вами LLM-провайдеру и добавленным вами MCP-серверам. Это можно
проверить: соберите проект из исходников и просмотрите исходящие соединения.

### Лицензия

[MIT](./LICENSE) © BuzzAgent Contributors
