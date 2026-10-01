# BuzzAgent — Português (README.pt.md)

🌐 Site do projeto: **https://b4zz.com/agent**

Bancada de trabalho visual de código aberto para agentes de programação com
IA. O núcleo do agente é o [OpenCode](https://github.com/anomalyco/opencode)
(MIT); o BuzzAgent é o cliente GUI em volta — não outro runtime de agente.

> **Veja tudo o que o agente faz. Controle modelos, ferramentas, navegador,
> MCP e raciocínio — localmente, com zero telemetria.**

## Por que isso existe

O mercado está dividido em dois:

**Visual, mas fraco.** Cline, Kilo Code, Roo Code — uma UI utilizável, mas
preso ao VS Code, com telemetria e um laço de agente mais fraco.

**Poderoso, mas cego.** OpenCode, Claude Code, Codex CLI, Oh My Pi — um
agente forte, mas um terminal. Sem diffs visuais, sem navegador integrado,
sem orquestração de espaços de trabalho.

A lacuna é um produto que mantém a potência dos agentes de terminal **e**
oferece controle visual, sem telemetria e sem aprisionamento a fornecedor.

O BuzzAgent é esse produto. Ele **não reimplementa o agente**. O OpenCode já
é um servidor HTTP headless (`opencode serve`) com especificação OpenAPI,
fluxo de eventos SSE e um SDK JS tipado. A TUI deles é um cliente desse
servidor; os plugins de IDE deles são outro. O BuzzAgent é o terceiro
cliente: uma GUI de desktop independente.

A CLI do Kilo Code é um **fork** do OpenCode, depois embrulhado como
extensão de VS Code (linhagem Cline) com contas e telemetria. Nós não
copiamos isso. Um fork herda o custo de manutenção deles e nos corta do
upstream. Um cliente mantém o núcleo atualizado conforme o OpenCode publica
versões, o que faz o tempo todo.

### O OpenCode agora tem GUI própria

Desde a 1.18 o repositório do OpenCode publica builds `opencode-desktop-*`
(Electron + SolidJS, ~120–150 MB) e um modo navegador (`opencode web`). "Um
cliente visual para o OpenCode" portanto **não é mais um diferencial em si**
— os autores do núcleo têm o deles.

O que ainda é nosso:

- **Zero telemetria como fato verificável.** O desktop deles integra
  `@sentry/solid` e o inicializa quando `VITE_SENTRY_DSN` é definido em tempo
  de compilação (`packages/desktop/src/renderer/index.tsx`), além de
  `sentryVitePlugin` no build. Nosso processo não tem crash reporter nem
  nenhuma dependência de analytics.
- **Um navegador dentro do laço do agente** — escreve código, abre o
  resultado, a captura volta como resultado de ferramenta, corrige. Não só
  headless: também se conecta a um Chrome em execução via CDP, para que o
  agente trabalhe num perfil em que o usuário já está logado (gated por
  permissão, como `shell_exec`).
- **Orquestração de worktrees** — vários agentes em paralelo em branches
  isolados, com monitor visual.
- **Sem conta, sem gateway embutida.** Sem o caminho padrão Zen/Go.

A consequência: nossa GUI será comparada diretamente com a deles. Isso eleva
o padrão de qualidade, e é por isso que o Marco 1 é uma fatia estreita e
confiável, não uma varredura ampla de recursos.

Precedente útil do desktop deles: `packages/desktop/src/main/sidecar.ts`
inicia o servidor com `OPENCODE_SERVER_PASSWORD`, porta aleatória, CORS
restrito à própria origem, loopback forçado no `NO_PROXY` e certificados CA
do sistema carregados. Adotamos o mesmo endurecimento.

## Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Camada visual  ──HTTP + SSE──►  opencode serve          │
│  chat · diffs · arquivos ·       (binário sidecar,       │
│  provedores · permissões ·        versão fixada)         │
│  worktrees                                              │
│                                                         │
│  Camada Rust                                            │
│  · supervisiona o processo do núcleo                     │
│  · navegador embutido (CDP) ──registrado como ferramenta─│
│  · orquestração de git worktrees                         │
└─────────────────────────────────────────────────────────┘
```

- **Núcleo = OpenCode.** Laço de ferramentas, function calling nativo,
  streaming, sessões e retomada, compactação, permissões, LSP, MCP,
  grep/glob/symbols, AGENTS.md, skills, slash commands, 75+ provedores,
  OAuth. Não reescrevemos nada disso.
- **GUI = BuzzAgent.** Chat com cartões de tool-calls, diffs visuais, árvore
  de arquivos, caixa de entrada de permissões, controles de modelo/esforço
  por papel, monitor de worktrees.
- **Extras nativos que o núcleo não tem.** Navegador embutido no laço do
  agente; agentes paralelos em git worktrees isolados.

O frontend fala com o núcleo **diretamente** por HTTP e SSE, usando
`@opencode-ai/sdk` gerado da especificação OpenAPI de uma versão **fixada**
(`GET /doc`). O Rust não faz proxy do tráfego do agente. O Rust só:

1. Inicia e supervisiona `opencode serve` (porta aleatória, senha, saúde).
2. Expõe ferramentas nativas que o núcleo não consegue fazer sozinho
   (navegador, worktrees).

É a mesma divisão que o OpenCode usa internamente: a TUI é um cliente, o
servidor é o runtime.

## Por que Tauri (e quanto custa)

O caminho quente — tokens em streaming, cartões de ferramentas, diffs — vai
do webview direto ao núcleo local por HTTP/SSE. Ele **não** passa pelo IPC do
Tauri, então o throughput de IPC do shell não está no caminho crítico. Isso
faz do shell de desktop uma decisão de empacotamento e capacidades nativas,
não de desempenho.

Tauri, porque:

- Já precisamos de uma camada nativa para supervisão de processos, controle
  de navegador via CDP e git worktrees; esse código existe e os testes
  passam.
- Migrar para Electron nos colocaria exatamente na stack do desktop do
  OpenCode (Electron + SolidJS + sidecar), onde os autores do núcleo têm
  vantagem e não diferenciaríamos em nada.
- O template Electron deles traz integração com Sentry. Nossa promessa de
  "zero telemetria" é mais fácil de manter verdadeira numa stack que
  controlamos.
- O tamanho do bundle é um argumento fraco aqui: o binário do núcleo sozinho
  tem ~57 MB, então 5 MB contra 120 MB de shell não decide nada.

O custo real, dito sem rodeios:

- **Três webviews diferentes.** WebView2 (Chromium, auto-atualizável) no
  Windows, WKWebView no macOS, `webkit2gtk` no Linux. Segundo a própria
  tabela do Tauri, `webkit2gtk` 2.36 ≈ Safari 16, e distros antigas estão
  bem atrás. Linux é o alvo mais fraco e onde veremos bugs de renderização
  primeiro. Mitigação: CSS conservador, sem APIs web de ponta, testar num
  `webkit2gtk` real.
- **Vários webviews numa janela ficam atrás do flag `unstable` do Tauri.**
  Importa para o painel do navegador: preferimos CDP + capturas/streaming
  para a UI em vez de embutir um segundo webview vivo, ou aceitar uma janela
  separada.
- Tempos de compilação de Rust e um ecossistema de plugins menor que o do
  Electron.

### Alternativas consideradas

| Opção | Veredito |
|---|---|
| **Electron** | UX mais previsível: um Chromium em todo lugar, o melhor ecossistema, o devtools mais fácil. Rejeitado como padrão porque é exatamente a stack do desktop do OpenCode, e ainda precisaríamos de código nativo via addons de node. O fallback honesto se os bugs de `webkit2gtk` ficarem inadministráveis. |
| **Go + Wails** | O mesmo modelo de webview do sistema do Tauri, então herda o idêntico problema do `webkit2gtk` abrindo mão do código Rust que já temos. Go não compra nada aqui: o núcleo não é Go, e nosso trabalho nativo (CDP, worktrees, supervisão) não fica mais fácil em Go. |
| **GUI pura em Rust** (egui, Iced, GPUI, Dioxus native, Slint) | Elimina a classe de bugs de webview e dá desempenho nativo de verdade. Mas construiríamos à mão chat, markdown, realce de sintaxe, visões de diff e árvore de arquivos — exatamente a superfície pela qual se julga uma GUI de agente de código. Um desvio de anos, e um painel de navegador fica muito difícil. Não é viável para a v1. |
| **UI só web** (servir nosso frontend num navegador) | A mais barata, e um alvo secundário genuinamente útil — mas o OpenCode já publica `opencode web`, e uma aba não pode ter menus nativos, worktrees ou navegador embutido. Bom como modo extra depois, não como produto. |
| **Flutter / .NET / Qt** | Widgets de qualidade nativa, mas sem reuso de React, e o ecossistema para "renderizar markdown + diffs + código" é mais fraco que o da web. Reescrita grande sem ganho estratégico. |
| **Extensão VS Code** | Familiar e barata, mas é a caixa do Cline/Kilo contra a qual nos posicionamos explicitamente, e mata a história de app independente/sem telemetria. |

Decisão: **Tauri + React agora**, com Electron como fallback documentado se
os defeitos de webview no Linux provarem inadministráveis. Manter a UI como
cliente HTTP/SSE simples do núcleo é o que torna esse fallback barato — o
shell é substituível precisamente porque nenhuma lógica de agente vive nele.

### Por que não Oh My Pi como núcleo

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30 mil estrelas) é um
agente forte — em alguns pontos mais profundo que o OpenCode: LSP no laço,
DAP, edições hashline, uma grande camada nativa em Rust, esquemas de URI
`pr://`/`issue://`/`agent://`, cadeias de fallback de modelos. Ainda assim é
o núcleo errado *para este produto*:

- **Sem servidor HTTP.** Suas quatro superfícies são a TUI, um prompt
  one-shot, um SDK Node in-process, e `--mode rpc` / `acp` sobre **stdio**.
  Um navegador não fala stdio, então o Rust teria que fazer proxy de cada
  mensagem — a camada que removemos de propósito — e o RPC deles exige
  fatiamento manual de quadros de 1 MiB e negociação de protocolo. Sem spec
  OpenAPI não há cliente gerado.
- **Telemetria que não dá para desligar.** Um UUID de instalação persistente
  (`~/.omp/install-id`, documentado no `docs/install-id.md` deles) sobrevive
  a limpar o estado do agente e alimenta, entre outros, um relatório de uso
  de um auth-broker que também envia o hostname, além de pushes de auto-QA.
  Removê-lo significa fazer fork do runtime deles, o que anula o sentido de
  reusar um núcleo.
- **O nicho está tomado:** `gooey-pi`, `pi-desktop`, `ohmypi-craft`,
  `ompweb` já são GUIs para OMP.

Se um dia adicionarmos um segundo backend, será via **ACP** — protocolo
compartilhado — atrás de uma interface adaptadora, e só quando a fatia do
OpenCode estiver sólida.

## A qualidade da interface é o produto

Tudo acima é encanamento. A razão de usar o BuzzAgent é a interface, então
ela é cobrada por um padrão, não por "funciona": nada trava na rede, 60 fps
durante o streaming, sem deslocamento de layout, teclado primeiro, diffs
reais lado a lado com realce de sintaxe, sessões longas virtualizadas,
estados vazio/erro/offline desenhados, temas escuro **e** claro, e
acessibilidade genuína (foco, contraste, suporte a leitor de tela para o
fluxo de mensagens).

A régua completa, a stack frontend escolhida (React 19, Tailwind 4, Radix,
Shiki, CodeMirror 6, TanStack Virtual, cmdk) e as regras para adicionar
dependências estão no [PLAN.md](./PLAN.md#ui-quality-bar).

## Como um ajuste chega ao núcleo

A UI nunca guarda uma segunda cópia do estado do núcleo. Exemplo — o usuário
cola uma API key:

1. O painel de modelos chama `GET /provider/auth`. O formulário é renderizado
   do schema que o núcleo devolve (API key, OAuth, device flow, …).
2. Ao salvar, a UI chama `PUT /auth/:id`. O núcleo escreve
   `~/.local/share/opencode/auth.json`. A chave não fica no nosso store nem
   no `localStorage`.
3. Base URL, lista de permissão de modelos, `share: "disabled"` vão por
   `PATCH /config`.
4. O seletor de modelos é `GET /config/providers` / `GET /provider`.
5. O modelo de um turno é um campo de `POST /session/:id/message` (`model`,
   `agent`). Um "roteador por papel" é a nossa UI escolhendo esses campos —
   não um segundo cliente HTTP na frente de 75 provedores.

Provedores OAuth (Claude Pro, Copilot, GitLab Duo, DigitalOcean) usam
`POST /provider/{id}/oauth/authorize` → navegador do sistema →
`POST /provider/{id}/oauth/callback`. Nenhum código específico de provedor
no nosso lado.

Se dois stores divergirem de novo, o agente não inicia. O núcleo é o único
dono de configuração, sessões, diffs e permissões.

## O que entregamos e o que não

**Não escrevemos:** provedores, OAuth, o laço de ferramentas, streaming,
sessões, compactação, o motor de permissões, LSP, MCP, grep/glob/symbols,
AGENTS.md, slash commands, skills, todos.

**Escrevemos:** toda a camada visual; o navegador embutido como ferramenta do
núcleo; orquestração de worktrees; a caixa de entrada de permissões; o
roteador visual de modelo/esforço; supervisão de processos; empacotamento.

**Não fazemos fork do OpenCode** a menos que uma fatia vertical prove que
precisamos mudar a semântica do núcleo (system prompts, comportamento de
ferramentas, staging de diffs). Essa decisão se toma com evidência, depois
do Marco 1, não de antemão.

## Posicionamento

```
BuzzAgent = núcleo OpenCode
          + controle visual de nível Cline
          + orquestração de worktrees de nível Orca
          + um navegador integrado no laço do agente
          + zero telemetria
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Código aberto | sim | sim | não | não | sim |
| Zero telemetria | sim (auditada — veja abaixo) | não | não | não | quase (share/Zen opcionais) |
| GUI visual | desktop independente | VS Code | sim | não | TUI / web |
| Navegador integrado no laço | sim | não | não | não | não |
| Orquestração de worktrees | sim | não | não | não | só sessões |
| Subagentes, LSP, MCP, permissões | via núcleo | parcial | parcial | sim | sim |
| Agnóstico de agente depois | interface adaptadora, OpenCode primeiro | não | não | não | n/a |

O Kilo Code provou que o núcleo do OpenCode carrega um produto, e o MIT
permite. Depois ocuparam o nicho de IDE + telemetria + cobrança. O nicho que
deixaram aberto é exatamente este: desktop independente, sem conta, sem
telemetria, navegador + worktrees.

## Zero telemetria — verificado

A auditoria (Marco 0) está completa e verificada empiricamente. Os passos de
reprodução completos estão em
[docs/telemetry-audit.md](./docs/telemetry-audit.md).

- **Zero telemetria de terceiros.** Nem Sentry, PostHog, Segment, Mixpanel,
  Datadog ou SDKs de analytics no binário do núcleo.
- **Chamadas de rede de saída forçadas para off.** Compartilhamento de
  conversas (`"share": "disabled"`), auto-atualizações (`"autoupdate":
  false`) e modelos pequenos Zen são desligados via configuração forçada em
  disco.
- **Ambiente isolado.** Todo estado, cache, banco de dados e logs ficam
  isolados no diretório de dados do aplicativo (`XDG_CONFIG_HOME`,
  `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`).
- **Segurança.** Autenticação HTTP Basic com senhas aleatórias de 64
  caracteres, vinculada apenas a `127.0.0.1`.

## Estado atual

O BuzzAgent foi reconstruído e está totalmente funcional:
- **Supervisor do núcleo (Rust)**: gestão automática do processo, alocação de
  porta aleatória, geração de senha, health checks, isolamento de ambiente,
  bypass de `NO_PROXY` para loopback, teardown limpo ao sair.
- **Cliente direto HTTP + SSE**: conexão direta à API do núcleo OpenCode,
  parsing do fluxo de eventos com resiliência a fronteiras de quadro, gestão
  de sessões, mensagens multiturno, gate de permissões.
- **UI da bancada visual**: chat em streaming em tempo real com markdown sem
  cintilação, blocos de código com realce (Shiki), cartões de ferramentas
  inspecionáveis com estados/durações/erros, diálogos de permissão.
- **Painel de diffs visuais**: visualizador de mudanças git em tempo real com
  marcas no nível da palavra (`+`/`−`) e reversão de arquivo em um clique.
- **Painel de navegador integrado**: automação de Chrome headless e anexação
  CDP ao vivo (`http://127.0.0.1:9222`), streaming de capturas do viewport,
  interação por seletores (clicar, digitar) e visualizador de logs de console
  CDP em tempo real.
- **Orquestração de worktrees**: criar e gerenciar git worktrees isolados por
  branch, trocar o projeto ativo na hora.
- **Paleta de comandos (`⌘K`)**: navegação rápida por teclado entre painéis,
  sessões e temas (Escuro, Claro, Sistema).

## Início rápido

### 1. Pré-requisitos e configuração

```bash
npm install
npm run setup:core   # Baixa o binário do OpenCode fixado em src-tauri/bin
```

### 2. Rodar o app de desktop

```bash
npm run dev          # App desktop Tauri + supervisão automática do núcleo
```

Ou pré-visualização web:
```bash
npm run web          # Só Vite — http://localhost:1420
```

### 3. Compilar instaladores (Windows / macOS / Linux)

```bash
npm run dist         # Baixa o núcleo fixado e compila os instaladores de release
```

Os artefatos ficam em `src-tauri/target/release/bundle/`:

| SO | Arquivos |
|---|---|
| Windows | `.msi`, `.exe` NSIS |
| macOS | `.app`, `.dmg` (por arquitetura com `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

O núcleo OpenCode fixado vai **dentro** de cada instalador
(`bundle.externalBin`): o usuário final instala um arquivo e nunca toca num
terminal.

Iteração rápida sem empacotamento de release: `npm run dist:debug`.

### 4. Publicar para os usuários (um comando para os três SOs)

Os instaladores de cada SO são compilados pelo CI quando uma tag de versão é
enviada:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

O GitHub Actions (`.github/workflows/release.yml`) compila `.msi`/`.exe` de
Windows, `.dmg` de macOS (Apple Silicon + Intel) e `.deb`/`.rpm`/`.AppImage`
de Linux, e anexa todos ao GitHub Release. É o equivalente mais próximo de
`npm install -g` para um app de desktop: o usuário clica num link na página
de Releases.

> Nota: `npm install -g` é para ferramentas de CLI. O BuzzAgent é um app GUI
> de desktop; a distribuição é por instaladores; não há instalação global.

### 5. Verificação e testes

```bash
npm run typecheck    # Verificação estrita de TypeScript
npm run lint         # ESLint 9
npm test             # Suíte de testes unitários Vitest (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Testes Rust do supervisor, git, navegador
npm run test:integration     # Ponta a ponta contra OpenCode real + provedor mock
```

## Licença

[MIT](./LICENSE) © Colaboradores do BuzzAgent.

O OpenCode também é MIT
([anomalyco/opencode](https://github.com/anomalyco/opencode)). O binário
sidecar é uma dependência, não um fork.
