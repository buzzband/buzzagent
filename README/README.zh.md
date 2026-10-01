# BuzzAgent — 中文 (README.zh.md)

🌐 项目网站：**https://b4zz.com/agent**

开源的 AI 编码代理可视化工作台。代理核心是
[OpenCode](https://github.com/anomalyco/opencode)（MIT 协议）；BuzzAgent 是
围绕它的 GUI 客户端，而不是又一个代理运行时。

> **看清代理所做的一切。在本地控制模型、工具、浏览器、MCP 和推理——零遥测。**

## 为什么做这个

市场被分成两半：

**可视化但弱。** Cline、Kilo Code、Roo Code——界面可用，但锁死在 VS Code
里，带遥测，代理循环也更弱。

**强大但盲目。** OpenCode、Claude Code、Codex CLI、Oh My Pi——代理很强，
但只有终端。没有可视化差异对比，没有应用内浏览器，没有工作区编排。

市场缺的是一个既保留终端级代理能力、又提供可视化控制的产品——而且不带
遥测、不搞供应商锁定。

BuzzAgent 就是这个产品。它**不重新实现代理**。OpenCode 本身就是一个无头
HTTP 服务器（`opencode serve`），带 OpenAPI 规范、SSE 事件流和类型化的
JS SDK。他们的 TUI 是这个服务器的一个客户端；他们的 IDE 插件是另一个。
BuzzAgent 是第三个客户端：一个独立的桌面 GUI。

Kilo Code 的 CLI 是 OpenCode 的一个**分支**，再包装成 VS Code 扩展
（Cline 血统），加上账号和遥测。我们不抄这条路。分支意味着继承他们的维护
成本，并与上游断开。做客户端则能让核心随着 OpenCode 的持续发布保持最新。

### OpenCode 现在自带 GUI

从 1.18 起，OpenCode 仓库发布 `opencode-desktop-*` 构建（Electron +
SolidJS，约 120–150 MB）和浏览器模式（`opencode web`）。"OpenCode 的可视
化客户端"本身**不再是差异化卖点**——核心作者自己就有。

我们仍然拥有的：

- **零遥测是可验证的事实。** 他们的桌面版接入了 `@sentry/solid`，并在构建
  时设置 `VITE_SENTRY_DSN` 时初始化（`packages/desktop/src/renderer/index.tsx`），
  构建中还有 `sentryVitePlugin`。我们的进程没有任何崩溃报告器，也没有任何
  分析依赖。
- **代理循环中的浏览器**——写代码、打开结果、把截图作为工具结果返回、修
  复。不只是无头模式：还能通过 CDP 附加到正在运行的 Chrome，让代理在用户
  已登录的配置文件上工作（像 `shell_exec` 一样受权限控制）。
- **工作树编排**——多个代理在隔离分支上并行，带可视化监控。
- **无账号、无捆绑网关。** 没有 Zen/Go 默认路径。

后果是：我们的 GUI 会与他们的桌面版直接对比。这提高了质量标准，也是
里程碑 1 只做一个窄而可靠切片、不铺大摊子的原因。

他们的桌面版有个有用的先例：`packages/desktop/src/main/sidecar.ts` 用
`OPENCODE_SERVER_PASSWORD` 启动服务器，随机端口，CORS 限制在自己的
renderer 来源，回环地址强制加入 `NO_PROXY`，并加载系统 CA 证书。我们采用
同样的加固。

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  可视化层    ──HTTP + SSE──►  opencode serve             │
│  聊天 · 差异 · 文件 ·        （sidecar 二进制，          │
│  提供商 · 权限 ·              固定版本）                 │
│  工作树                                                  │
│                                                         │
│  Rust 层                                                 │
│  · 监管核心进程                                          │
│  · 内嵌浏览器 (CDP) ──注册为核心工具──                    │
│  · git worktree 编排                                     │
└─────────────────────────────────────────────────────────┘
```

- **核心 = OpenCode。** 工具循环、原生函数调用、流式传输、会话与恢复、压
  缩、权限、LSP、MCP、grep/glob/symbols、AGENTS.md、技能、斜杠命令、75+
  提供商、OAuth。这些我们一概不重写。
- **GUI = BuzzAgent。** 带工具调用卡片的聊天、可视化差异、文件树、权限收
  件箱、按角色的模型/推理强度控制、工作树监控。
- **核心没有的原生能力。** 代理循环中的内嵌浏览器；隔离 git worktree 中的
  并行代理。

前端通过 HTTP 和 SSE **直连**核心，使用从**固定**版本的 OpenAPI 规范
（`GET /doc`）生成的 `@opencode-ai/sdk`。Rust 不代理代理流量。Rust 只做：

1. 启动并监管 `opencode serve`（随机端口、密码、健康检查）。
2. 暴露核心自己做不到的原生工具（浏览器、worktree）。

这与 OpenCode 内部使用的拆分相同：TUI 是客户端，服务器是运行时。

## 为什么选 Tauri（以及代价）

热路径——流式 token、工具卡片、差异对比——从 webview 直接走 HTTP/SSE 到
本地核心，**不经过** Tauri IPC，因此外壳的 IPC 吞吐不在关键路径上。这让
桌面外壳成为打包与原生能力的决策，而不是性能决策。

选 Tauri，因为：

- 我们本来就需要原生层来做进程监管、CDP 浏览器控制和 git worktree；这些
  代码已经存在且测试通过。
- 换到 Electron 就等于用上 OpenCode 自家桌面（Electron + SolidJS +
  sidecar）的完全相同技术栈——核心作者在那里领先，我们将毫无差异化。
- 他们的 Electron 模板自带 Sentry 集成。在我们可控的技术栈上，"零遥测"
  的承诺更容易保持为真。
- 包体积在这里无论如何都不是决定性论据：仅核心二进制就约 57 MB，5 MB 对
  120 MB 的外壳之差并不关键。

实实在在的代价：

- **三种不同的 webview。** Windows 上是 WebView2（Chromium，自动更新），
  macOS 上是 WKWebView，Linux 上是 `webkit2gtk`。按 Tauri 自己的对照表，
  `webkit2gtk` 2.36 ≈ Safari 16，老发行版差得更远。Linux 是最弱目标，渲染
  bug 会最先出现在那里。缓解措施：保守的 CSS，不用前沿 Web API，在真实的
  `webkit2gtk` 上测试。
- **单窗口多 webview 藏在 Tauri 的 `unstable` 特性开关后面。** 这关系到浏
  览器面板：优先用 CDP + 截图/流式画面进 UI，而不是内嵌第二个活跃
  webview，或者接受一个独立窗口。
- Rust 构建时间长，插件生态比 Electron 小。

### 考虑过的替代方案

| 方案 | 结论 |
|---|---|
| **Electron** | 最可预期的 UX：处处一个 Chromium，生态最好，devtools 最顺。被否决为默认选择，因为它正是 OpenCode 桌面版的完全相同技术栈，而且我们仍需通过 node 插件写原生代码。如果 `webkit2gtk` 的 bug 不可收拾，这是诚实的退路。 |
| **Go + Wails** | 与 Tauri 相同的系统 webview 模型，因此继承同样的 `webkit2gtk` 问题，还丢掉已有的 Rust 代码。Go 在这里买不到任何东西：核心不是 Go 写的，我们的原生工作（CDP、worktree、进程监管）用 Go 也不会更简单。 |
| **纯 Rust GUI**（egui、Iced、GPUI、Dioxus native、Slint） | 消除 webview 这一整类 bug，带来真正的原生性能。但聊天、markdown、语法高亮、差异视图、文件树全都得手写——恰恰是代码代理 GUI 被评判的地方。那是多年的弯路，浏览器面板也会变得非常难做。v1 不可行。 |
| **纯 Web UI**（自己起前端，跑在浏览器里） | 最便宜，也确实是很好的次要目标——但 OpenCode 已经发布 `opencode web`，而且浏览器标签页无法拥有原生菜单、worktree 或内嵌浏览器。适合以后作为附加模式，不是产品本体。 |
| **Flutter / .NET / Qt** | 原生级控件，但无法复用 React，"渲染 markdown + 差异 + 代码"的生态比 Web 弱。大重写，无战略收益。 |
| **VS Code 扩展** | 熟悉且便宜，但这正是我们明确要对标的 Cline/Kilo 路线，而且会毁掉独立应用/零遥测的故事。 |

决策：**现在用 Tauri + React**，Electron 作为文档化的退路，仅当 Linux
webview 缺陷被证明不可管理时启用。让 UI 保持为核心的一个普通 HTTP/SSE
客户端，正是退路便宜的原因——外壳可替换，恰恰因为代理逻辑不在里面。

### 为什么不用 Oh My Pi 当核心

[oh-my-pi](https://github.com/can1357/oh-my-pi)（MIT，约 3 万星）是个强代
理——某些方面比 OpenCode 更深：循环内 LSP、DAP、hashline 编辑、庞大的原生
Rust 层、`pr://`/`issue://`/`agent://` URI 方案、模型回退链。但*对这个产品*
来说它仍是错误的核心：

- **没有 HTTP 服务器。** 它的四个表面是 TUI、一次性 prompt、进程内 Node
  SDK，以及走 **stdio** 的 `--mode rpc` / `acp`。浏览器说不了 stdio，Rust
  就得代理每一条消息——正是我们刻意移除的那一层——而且他们的 RPC 需要手
  动 1 MiB 分帧和协议协商。没有 OpenAPI 规范就无法生成客户端。
- **关不掉的遥测。** 持久的安装 UUID（`~/.omp/install-id`，见其
  `docs/install-id.md`）在清空代理状态后依然存在，并供给——其中包括——一
  个还携带主机名的鉴权代理用量报告，以及自动 QA 推送。去掉它就得分支他们
  的运行时，这与复用核心的初衷相悖。
- **生态位已被占据：** `gooey-pi`、`pi-desktop`、`ohmypi-craft`、`ompweb`
  已经是 OMP 的 GUI。

如果将来加第二个后端，会走 **ACP**——共享协议——放在适配器接口后面，且
只在 OpenCode 切片稳固之后。

## 界面质量就是产品

上面说的都是管道。用户选择 BuzzAgent 的理由是界面，所以界面按标准来验收，
而不是"能用就行"：不在网络上阻塞、流式时 60 fps、无布局跳动、键盘优先、
真正的并排差异对比加语法高亮、长会话虚拟化、精心设计的空/错误/离线状态、
深色**和**浅色主题，以及真正的无障碍（焦点、对比度、消息流的屏幕阅读器
支持）。

完整标准、选定前端技术栈（React 19、Tailwind 4、Radix、Shiki、
CodeMirror 6、TanStack Virtual、cmdk）以及新增依赖的规则见
PLAN.md。

## 一个设置如何到达核心

UI 从不保存核心状态的第二份副本。例子——用户粘贴 API key：

1. 模型面板调用 `GET /provider/auth`。表单按核心返回的 schema 渲染
   （API key、OAuth、设备流等）。
2. 保存时，UI 调用 `PUT /auth/:id`。核心写入
   `~/.local/share/opencode/auth.json`。key 不留在我们的 store 里，也不进
   `localStorage`。
3. Base URL、模型白名单、`share: "disabled"` 通过 `PATCH /config` 下发。
4. 模型选择器是 `GET /config/providers` / `GET /provider`。
5. 一轮对话用的模型是 `POST /session/:id/message` 的字段（`model`、
   `agent`）。"按角色路由"只是我们的 UI 在选这些字段——不是在 75 个提供
   商前面再加一个 HTTP 客户端。

OAuth 提供商（Claude Pro、Copilot、GitLab Duo、DigitalOcean）走
`POST /provider/{id}/oauth/authorize` → 系统浏览器 →
`POST /provider/{id}/oauth/callback`。我们这边没有任何特定提供商的代码。

如果两个 store 再度分叉，代理将无法启动。核心是配置、会话、差异和权限的
唯一所有者。

## 我们做什么、不做什么

**我们不写：** 提供商、OAuth、工具循环、流式传输、会话、压缩、权限引擎、
LSP、MCP、grep/glob/symbols、AGENTS.md、斜杠命令、技能、待办。

**我们写：** 整个可视化层；作为核心工具的内嵌浏览器；worktree 编排；权限
收件箱；可视化模型/推理强度路由；进程监管；打包。

**我们不分支 OpenCode**，除非某个垂直切片证明必须改变核心语义（系统提示
词、工具行为、差异暂存）。这个决定基于证据，在里程碑 1 之后做，不预先
决定。

## 定位

```
BuzzAgent = OpenCode 核心
          + Cline 级的可视化控制
          + Orca 级的 worktree 编排
          + 代理循环中的内嵌浏览器
          + 零遥测
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| 开源 | 是 | 是 | 否 | 否 | 是 |
| 零遥测 | 是（已审计——见下） | 否 | 否 | 否 | 接近（share/Zen 可选） |
| 可视化 GUI | 独立桌面 | VS Code | 是 | 否 | TUI / web |
| 循环内内嵌浏览器 | 是 | 否 | 否 | 否 | 否 |
| Worktree 编排 | 是 | 否 | 否 | 否 | 仅会话 |
| 子代理、LSP、MCP、权限 | 经核心 | 部分 | 部分 | 是 | 是 |
| 日后支持多代理后端 | 适配器接口，OpenCode 优先 | 否 | 否 | 否 | 不适用 |

Kilo Code 证明了 OpenCode 的核心能撑起一个产品，MIT 也允许。他们随后占了
IDE + 遥测 + 计费这个生态位。他们留下的空位正是这个：独立桌面、无账号、
零遥测、浏览器 + worktree。

## 零遥测——已验证

审计（里程碑 0）已完成并经实证验证。完整复现步骤见
[docs/telemetry-audit.md](./docs/telemetry-audit.md)。

- **零第三方遥测。** 核心二进制中没有 Sentry、PostHog、Segment、Mixpanel、
  Datadog 或任何分析 SDK。
- **强制关闭出站网络调用。** 会话分享（`"share": "disabled"`）、自更新
  （`"autoupdate": false`）和 Zen 小模型通过强制磁盘配置关闭。
- **隔离环境。** 所有状态、缓存、数据库和日志都隔离在应用数据目录内
  （`XDG_CONFIG_HOME`、`XDG_STATE_HOME`、`XDG_DATA_HOME`、
  `XDG_CACHE_HOME`）。
- **安全。** HTTP Basic 认证使用随机生成的 64 位密码，只绑定 `127.0.0.1`。

## 当前状态

BuzzAgent 已重建并完全可用：
- **核心监管器（Rust）**：自动进程管理、随机端口分配、密码生成、健康检查、
  环境隔离、回环 `NO_PROXY` 旁路、退出时干净关闭。
- **直连 HTTP + SSE 客户端**：直连 OpenCode 核心 API，事件流解析带帧边界
  韧性，会话管理，多轮消息处理，权限门控。
- **可视化工作台 UI**：实时流式聊天，markdown 不闪烁，代码块语法高亮
  （Shiki），可检视的工具卡片带执行状态/耗时/错误，权限弹窗。
- **可视化差异面板**：实时 git 变更查看器，词级差异标记（`+`/`−`），单击
  还原文件。
- **应用内浏览器面板**：无头 Chrome 自动化与实时 CDP 附加
  （`http://127.0.0.1:9222`），实时视口截图流，选择器交互（点击、输入），
  实时 CDP 控制台日志查看器。
- **Worktree 编排**：按分支创建和管理隔离的 git worktree，随时切换当前工
  作台项目。
- **命令面板（`⌘K`）**：键盘优先，在面板、会话与主题（深色、浅色、跟随系
  统）之间快速切换。

## 快速开始

### 1. 前置条件与安装

```bash
npm install
npm run setup:core   # 下载固定版本的 OpenCode 二进制到 src-tauri/bin
```

### 2. 运行桌面应用

```bash
npm run dev          # 启动 Tauri 桌面应用 + 自动监管核心
```

或 Web 预览：
```bash
npm run web          # 仅 Vite — http://localhost:1420
```

### 3. 构建安装包（Windows / macOS / Linux）

```bash
npm run dist         # 下载固定核心，然后构建发布安装包
```

产物在 `src-tauri/target/release/bundle/`：

| 系统 | 文件 |
|---|---|
| Windows | `.msi`、NSIS `.exe` |
| macOS | `.app`、`.dmg`（用 `--target aarch64-apple-darwin` / `x86_64-apple-darwin` 按架构构建） |
| Linux | `.deb`、`.rpm`、`.AppImage` |

固定版本的 OpenCode 核心**内嵌**在每个安装包里（`bundle.externalBin`），最
终用户安装一个文件，永远不碰终端。

不打包发布物的快速迭代：`npm run dist:debug`。

### 4. 发布给用户（一条命令覆盖三个系统）

推送版本标签时，CI 会构建所有系统的安装包：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions（`.github/workflows/release.yml`）构建 Windows `.msi`/`.exe`、
macOS `.dmg`（Apple Silicon + Intel）和 Linux `.deb`/`.rpm`/`.AppImage`，
并全部附到 GitHub Release 上。这是桌面应用最接近 `npm install -g` 的方式：
用户在 Releases 页面点一个链接。

> 注：`npm install -g` 是给 CLI 工具用的。BuzzAgent 是桌面 GUI 应用，通过
> 安装包分发；没有全局安装路径。

### 5. 验证与测试

```bash
npm run typecheck    # TypeScript 严格检查
npm run lint         # ESLint 9
npm test             # Vitest 单元测试（markdown、diff、client、store、UI）
cd src-tauri && cargo test   # Rust 监管器、git、浏览器测试
npm run test:integration     # 针对真实 OpenCode + mock 提供商的端到端测试
```

## 许可证

[MIT](./LICENSE) © BuzzAgent 贡献者。

OpenCode 同为 MIT（[anomalyco/opencode](https://github.com/anomalyco/opencode)）。
sidecar 二进制是依赖，不是分支。
