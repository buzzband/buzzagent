# BuzzAgent — Deutsch (README.de.md)

🌐 Projekt-Website: **https://b4zz.com/agent**

⬇️ **Herunterladen:** [https://b4zz.com/agent/#download](https://b4zz.com/agent/#download)

Open-Source-Visual-Workbench für KI-Coding-Agenten. Der Agentenkern ist
[OpenCode](https://github.com/anomalyco/opencode) (MIT); BuzzAgent ist der
GUI-Client drumherum — keine weitere Agent-Runtime.

> **Sehen Sie alles, was der Agent tut. Steuern Sie Modelle, Tools, Browser,
> MCP und Reasoning — lokal, mit null Telemetrie.**

## Warum es das gibt

Der Markt ist in zwei Lager gespalten:

**Visuell, aber schwach.** Cline, Kilo Code, Roo Code — brauchbare UI, aber
in VS Code eingesperrt, mit Telemetrie und einer schwächeren Agentenschleife.

**Mächtig, aber blind.** OpenCode, Claude Code, Codex CLI, Oh My Pi — ein
starker Agent, aber ein Terminal. Keine visuellen Diffs, kein eingebetteter
Browser, keine Workspace-Orchestrierung.

Die Lücke ist ein Produkt, das die Kraft von Terminal-Agenten bewahrt **und**
visuelle Kontrolle bietet — ohne Telemetrie, ohne Vendor-Lock-in.

BuzzAgent ist dieses Produkt. Es **implementiert den Agenten nicht neu**.
OpenCode ist bereits ein headless-HTTP-Server (`opencode serve`) mit
OpenAPI-Spezifikation, SSE-Event-Stream und typisiertem JS SDK. Deren TUI ist
ein Client dieses Servers; ihre IDE-Plugins ein anderer. BuzzAgent ist der
dritte Client: eine eigenständige Desktop-GUI.

Kilo Codes CLI ist ein **Fork** von OpenCode, danach als VS-Code-Erweiterung
verpackt (Cline-Linie), mit Accounts und Telemetrie. Das kopieren wir nicht.
Ein Fork erbt ihren Wartungsaufwand und schneidet uns vom Upstream ab. Ein
Client hält den Kern aktuell, solange OpenCode ständig veröffentlicht.

### OpenCode liefert jetzt eine eigene GUI

Seit 1.18 veröffentlicht das OpenCode-Repo `opencode-desktop-*`-Builds
(Electron + SolidJS, ~120–150 MB) und einen Browsermodus (`opencode web`).
„Ein visueller Client für OpenCode" ist damit **für sich kein
Differenzierungsmerkmal mehr** — die Kernautoren haben einen.

Was trotzdem unser ist:

- **Null Telemetrie als überprüfbare Tatsache.** Ihr Desktop bindet
  `@sentry/solid` ein und initialisiert es, wenn `VITE_SENTRY_DSN` zur
  Buildzeit gesetzt ist (`packages/desktop/src/renderer/index.tsx`), dazu
  `sentryVitePlugin` im Build. Unser Prozess hat keinen Crash-Reporter und
  keinerlei Analytics-Abhängigkeit.
- **Ein Browser in der Agentenschleife** — Code schreiben, Ergebnis öffnen,
  der Screenshot kommt als Tool-Ergebnis zurück, korrigieren. Nicht nur
  headless: auch an einen laufenden Chrome per CDP anhängen, damit der Agent
  in einem Profil arbeitet, in dem der Nutzer bereits eingeloggt ist (wie
  `shell_exec` hinter Berechtigungen).
- **Worktree-Orchestrierung** — mehrere Agenten parallel auf isolierten
  Branches, mit visuellem Monitor.
- **Kein Konto, keine eingebaute Gateway.** Kein Zen/Go-Standardpfad.

Die Folge: Unsere GUI wird direkt mit ihrer verglichen. Das hebt die Messlatte
und ist der Grund, warum Meilenstein 1 ein schmaler, verlässlicher Schnitt
ist statt einer breiten Feature-Schwemme.

Ein nützlicher Präzedenzfall von ihrem Desktop: `packages/desktop/src/main/sidecar.ts`
startet den Server mit `OPENCODE_SERVER_PASSWORD`, zufälligem Port, CORS auf
die eigene Origin beschränkt, Loopback erzwungen in `NO_PROXY` und geladenen
System-CA-Zertifikaten. Wir übernehmen dieselbe Härtung.

## Architektur

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Visuelle Schicht ──HTTP + SSE──►  opencode serve        │
│  Chat · Diffs · Dateien ·       (Sidecar-Binärdatei,     │
│  Provider · Berechtigungen ·     angeheftete Version)    │
│  Worktrees                                              │
│                                                         │
│  Rust-Schicht                                            │
│  · überwacht den Kernprozess                             │
│  · eingebetteter Browser (CDP) ──als Kern-Tool registriert│
│  · Git-Worktree-Orchestrierung                           │
└─────────────────────────────────────────────────────────┘
```

- **Kern = OpenCode.** Tool-Schleife, natives Function Calling, Streaming,
  Sessions und Wiederaufnahme, Kompaktierung, Berechtigungen, LSP, MCP,
  grep/glob/symbols, AGENTS.md, Skills, Slash-Commands, 75+ Provider, OAuth.
  Wir schreiben nichts davon neu.
- **GUI = BuzzAgent.** Chat mit Tool-Call-Karten, visuelle Diffs, Dateibaum,
  Berechtigungs-Posteingang, Modell/Aufwand-Steuerung pro Rolle,
  Worktree-Monitor.
- **Native Extras, die der Kern nicht hat.** Eingebetteter Browser in der
  Agentenschleife; parallele Agenten in isolierten Git-Worktrees.

Das Frontend spricht **direkt** per HTTP und SSE mit dem Kern, über
`@opencode-ai/sdk`, generiert aus der OpenAPI-Spezifikation einer
**anghefteten** Version (`GET /doc`). Rust proxyt keinen Agenten-Traffic.
Rust macht nur:

1. Startet und überwacht `opencode serve` (zufälliger Port, Passwort,
   Health-Check).
2. Stellt native Tools bereit, die der Kern nicht selbst kann (Browser,
   Worktrees).

Das ist dieselbe Aufteilung, die OpenCode intern nutzt: Die TUI ist ein
Client, der Server ist die Runtime.

## Warum Tauri (und was es kostet)

Der Hot Path — Streaming-Tokens, Tool-Karten, Diffs — läuft direkt vom Webview
zum lokalen Kern über HTTP/SSE. Er geht **nicht** durch Tauris IPC, deshalb ist
der IPC-Durchsatz des Shells nicht auf dem kritischen Weg. Der Desktop-Shell
ist damit eine Entscheidung über Paketierung und native Fähigkeiten, nicht
über Performance.

Tauri, weil:

- Wir sowieso eine native Schicht brauchen — für Prozessüberwachung,
  Browser-Steuerung per CDP und Git-Worktrees; dieser Code existiert, und
  seine Tests laufen durch.
- Ein Wechsel zu Electron bedeutete: exakt der Stack des OpenCode-Desktops
  (Electron + SolidJS + Sidecar), wo die Kernautoren im Vorteil sind und wir
  uns in nichts unterscheiden würden.
- Ihr Electron-Template bringt eine Sentry-Integration mit. Unser Versprechen
  „keine Telemetrie" lässt sich auf einem Stack, den wir kontrollieren,
  leichter wahr halten.
- Die Bundle-Größe ist hier ein schwaches Argument: Der Kern-Binärdatei allein
  wiegt ~57 MB, also entscheidet 5 MB gegen 120 MB Shell nichts.

Der echte Preis, ungeschönt:

- **Drei verschiedene Webviews.** WebView2 (Chromium, selbstaktualisierend)
  auf Windows, WKWebView auf macOS, `webkit2gtk` auf Linux. Nach Tauris
  eigener Tabelle ist `webkit2gtk` 2.36 ≈ Safari 16, und alte Distributionen
  liegen weiter zurück. Linux ist das schwächste Ziel und dort sehen wir
  Rendering-Bugs zuerst. Abhilfe: konservatives CSS, keine neumodischen
  Web-APIs, Tests auf echtem `webkit2gtk`.
- **Mehrere Webviews in einem Fenster liegen hinter Tauris `unstable`-Flag.**
  Wichtig fürs Browser-Panel: lieber CDP + Screenshots/Stream in die UI als
  ein zweites lebendes Webview einbetten — oder ein separates Fenster
  akzeptieren.
- Rust-Buildzeiten und ein kleineres Plugin-Ökosystem als bei Electron.

### Geprüfte Alternativen

| Option | Urteil |
|---|---|
| **Electron** | Die berechenbarste UX: ein Chromium überall, das beste Ökosystem, unkompliziertes Devtools. Als Standard abgelehnt, weil es exakt der Stack des OpenCode-Desktops ist und natives Code trotzdem über Node-Addons käme. Der ehrliche Rückfallweg, falls `webkit2gtk`-Bugs unbeherrschbar werden. |
| **Go + Wails** | Dasselbe System-Webview-Modell wie Tauri, also dasselbe `webkit2gtk`-Problem, bei Verzicht auf unseren vorhandenen Rust-Code. Go kauft hier nichts: Der Kern ist nicht Go, und unsere Native-Arbeit (CDP, Worktrees, Überwachung) wird in Go nicht einfacher. |
| **Reines Rust-GUI** (egui, Iced, GPUI, Dioxus native, Slint) | Eliminiert die ganze Webview-Bug-Klasse und liefert echte native Performance. Aber Chat, Markdown, Syntax-Highlighting, Diff-Ansichten und Dateibaum müssten von Hand gebaut werden — genau die Fläche, an der eine Coding-Agent-GUI gemessen wird. Ein Umweg über Jahre, und ein Browser-Panel wird sehr schwer. Für v1 nicht tragfähig. |
| **Nur Web-UI** (eigenes Frontend im Browser ausliefern) | Am billigsten, und ein wirklich nützliches Sekundärziel — aber OpenCode liefert bereits `opencode web`, und ein Browser-Tab kann keine nativen Menüs, Worktrees oder einen eingebetteten Browser besitzen. Gut als Zusatzmodus später, nicht als Produkt. |
| **Flutter / .NET / Qt** | Native Qualität bei Widgets, aber keine React-Wiederverwendung, und das Ökosystem für „Markdown + Diffs + Code rendern" ist schwächer als das des Webs. Große Neuschreibung ohne strategischen Gewinn. |
| **VS-Code-Erweiterung** | Sofort vertraut und billig, aber das ist die Cline/Kilo-Schachtel, gegen die wir uns explizit positionieren, und sie tötet die Geschichte vom eigenständigen, telemetriefreien App. |

Entscheidung: **jetzt Tauri + React**, Electron als dokumentierter Rückfallweg,
falls sich Linux-Webview-Defekte als unbeherrschbar erweisen. Die UI als
schlichten HTTP/SSE-Client des Kerns zu halten, ist genau das, was diesen
Rückfallweg billig macht — der Shell ist austauschbar, weil keine Agentenlogik
in ihm wohnt.

### Warum nicht Oh My Pi als Kern

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30k Sterne) ist ein
starker Agent — stellenweise tiefer als OpenCode: LSP in der Schleife, DAP,
Hashline-Edits, eine große native Rust-Schicht, `pr://`/`issue://`/`agent://`-URI-Schemata,
Modell-Fallback-Ketten. Trotzdem ist es der falsche Kern *für dieses Produkt*:

- **Kein HTTP-Server.** Seine vier Oberflächen: TUI, One-Shot-Prompt,
  In-Process-Node-SDK und `--mode rpc` / `acp` über **stdio**. Ein Browser
  spricht kein stdio, also müsste Rust jede Nachricht proxen — die Schicht,
  die wir bewusst entfernt haben —, und ihr RPC verlangt manuelles Framing in
  1-MiB-Stücken und Protokollverhandlung. Keine OpenAPI-Spec, kein generierter
  Client.
- **Telemetrie, die sich nicht abschalten lässt.** Eine dauerhafte
  Installations-UUID (`~/.omp/install-id`, dokumentiert in ihrer
  `docs/install-id.md`) überlebt das Löschen des Agentenzustands und füttert —
  unter anderem — einen Auth-Broker-Nutzungsbericht, der auch den Hostnamen
  sendet, dazu Auto-QA-Pushes. Das zu entfernen hieße, ihre Runtime zu forken —
  was den Sinn eines Fremden Kerns zunichtemacht.
- **Die Nische ist besetzt:** `gooey-pi`, `pi-desktop`, `ohmypi-craft`,
  `ompweb` sind bereits OMP-GUIs.

Falls wir jemals einen zweiten Backend hinzufügen, dann über **ACP** — ein
gemeinsames Protokoll — hinter einer Adapter-Schnittstelle, und erst wenn der
OpenCode-Schnitt stabil ist.

## Schnittstellenqualität ist das Produkt

Das ganze Obige ist Sanitärinstallation. Der Grund, BuzzAgent zu nutzen, ist
die Oberfläche, also wird sie an einem Standard gemessen, nicht an „läuft
irgendwie": nichts blockiert am Netz, 60 fps beim Streaming, kein Layout-
Springen, Tastatur zuerst, echte Side-by-Side-Diffs mit Syntax-Highlighting,
lange Sessions virtualisiert, gestaltete Leer-/Fehler-/Offline-Zustände,
dunkles **und** helles Theme, und echte Barrierefreiheit (Fokus, Kontrast,
Screenreader-Unterstützung für den Nachrichtenstrom).

Die volle Messlatte, der gewählte Frontend-Stack (React 19, Tailwind 4,
Radix, Shiki, CodeMirror 6, TanStack Virtual, cmdk) und die Regeln für neue
Abhängigkeiten stehen in PLAN.md.

## Wie eine Einstellung zum Kern gelangt

Die UI hält nie eine zweite Kopie des Kernzustands. Beispiel — der Nutzer
fügt einen API-Key ein:

1. Das Modelle-Panel ruft `GET /provider/auth` auf. Das Formular wird aus dem
   Schema gerendert, das der Kern liefert (API-Key, OAuth, Device-Flow, …).
2. Beim Speichern ruft die UI `PUT /auth/:id` auf. Der Kern schreibt
   `~/.local/share/opencode/auth.json`. Der Key liegt weder in unserem Store
   noch im `localStorage`.
3. Base URL, Modell-Whitelist, `share: "disabled"` laufen über `PATCH /config`.
4. Der Modell-Picker ist `GET /config/providers` / `GET /provider`.
5. Das Modell eines Zugs ist ein Feld in `POST /session/:id/message`
   (`model`, `agent`). Ein „Router nach Rolle" ist unsere UI, die diese Felder
   wählt — kein zweiter HTTP-Client vor 75 Providern.

OAuth-Provider (Claude Pro, Copilot, GitLab Duo, DigitalOcean) nutzen
`POST /provider/{id}/oauth/authorize` → Systembrowser →
`POST /provider/{id}/oauth/callback`. Kein providerspezifischer Code bei uns.

Wenn zwei Stores wieder auseinanderlaufen, startet der Agent nicht. Der Kern
ist der alleinige Besitzer von Konfiguration, Sessions, Diffs und
Berechtigungen.

## Was wir liefern und was nicht

**Wir schreiben nicht:** Provider, OAuth, die Tool-Schleife, Streaming,
Sessions, Kompaktierung, die Berechtigungs-Engine, LSP, MCP,
grep/glob/symbols, AGENTS.md, Slash-Commands, Skills, Todos.

**Wir schreiben:** die gesamte visuelle Schicht; den eingebetteten Browser
als Kern-Tool; Worktree-Orchestrierung; den Berechtigungs-Posteingang; den
visuellen Modell/Aufwand-Router; Prozessüberwachung; die Paketierung.

**Wir forken OpenCode nicht**, bis ein vertikaler Schnitt beweist, dass wir
Kernsemantik ändern müssen (System-Prompts, Tool-Verhalten, Diff-Staging).
Diese Entscheidung fällt auf Beweise hin, nach Meilenstein 1 — nicht im
Voraus.

## Positionierung

```
BuzzAgent = OpenCode-Kern
          + visuelle Kontrolle auf Cline-Niveau
          + Worktree-Orchestrierung auf Orca-Niveau
          + ein eingebetteter Browser in der Agentenschleife
          + null Telemetrie
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Open Source | ja | ja | nein | nein | ja |
| Null Telemetrie | ja (auditiert — siehe unten) | nein | nein | nein | fast (share/Zen optional) |
| Visuelle GUI | eigenständiger Desktop | VS Code | ja | nein | TUI / web |
| Eingebetteter Browser in der Schleife | ja | nein | nein | nein | nein |
| Worktree-Orchestrierung | ja | nein | nein | nein | nur Sessions |
| Subagenten, LSP, MCP, Berechtigungen | über den Kern | teilweise | teilweise | ja | ja |
| Später agentenagnostisch | Adapter-Schnittstelle, OpenCode zuerst | nein | nein | nein | n/a |

Kilo Code hat bewiesen, dass OpenCodes Kern ein Produkt trägt, und MIT
erlaubt es. Danach haben sie die Nische IDE + Telemetrie + Abrechnung besetzt.
Die Nische, die sie offen ließen, ist genau diese: eigenständiger Desktop,
kein Konto, keine Telemetrie, Browser + Worktrees.

## Null Telemetrie — verifiziert

Das Audit (Meilenstein 0) ist abgeschlossen und empirisch verifiziert. Die
vollen Reproduktionsschritte stehen in
[docs/telemetry-audit.md](./docs/telemetry-audit.md).

- **Null Telemetrie von Dritten.** Weder Sentry, PostHog, Segment, Mixpanel,
  Datadog noch irgendein Analytics-SDK in der Kern-Binärdatei.
- **Ausgehende Netzwerkaufrufe erzwungen aus.** Konversations-Sharing
  (`"share": "disabled"`), Selbst-Updates (`"autoupdate": false`) und
  Zen-Kleinmodelle sind per erzwungener On-Disk-Konfiguration abgeschaltet.
- **Isolierte Umgebung.** Gesamter Zustand, Cache, DB und Logs liegen
  isoliert im Anwendungsdatenverzeichnis (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`,
  `XDG_DATA_HOME`, `XDG_CACHE_HOME`).
- **Sicherheit.** HTTP Basic mit zufällig generierten 64-Zeichen-Passwörtern,
  Bindung nur an `127.0.0.1`.

## Aktueller Stand

BuzzAgent ist neu gebaut und voll funktionsfähig:
- **Kern-Supervisor (Rust)**: automatisierte Prozessverwaltung, zufällige
  Portzuweisung, Passwort-Generierung, Health-Checks, Umgebungsisolierung,
  `NO_PROXY`-Umgehung für Loopback, sauberes Herunterfahren beim Beenden.
- **Direkter HTTP + SSE-Client**: direkte Verbindung zur OpenCode-Kern-API,
  Event-Stream-Parsing mit Widerstandsfähigkeit an Rahmengrenzen,
  Sitzungsverwaltung, Multi-Turn-Nachrichten, Berechtigungs-Gate.
- **Visual-Workbench-UI**: Echtzeit-Streaming-Chat mit nicht flackerndem
  Markdown, syntaxhervorgehobenen Codeblöcken (Shiki), inspizierbaren
  Tool-Karten mit Zuständen/Dauern/Fehlern, Berechtigungsdialogen.
- **Visuelles Diff-Panel**: Echtzeit-Ansicht der Git-Änderungen mit Marken auf
  Wortebene (`+`/`−`) und Datei-Rückgängigmachung per Klick.
- **In-App-Browser-Panel**: Headless-Chrome-Automatisierung und Live-CDP-Attach
  (`http://127.0.0.1:9222`), Live-Viewport-Screenshot-Streaming,
  Selektor-Interaktion (Klick, Eingabe) und Echtzeit-CDP-Konsolanzeige.
- **Worktree-Orchestrierung**: isolierte Git-Worktrees pro Branch anlegen und
  verwalten, aktives Projekt im Flug wechseln.
- **Befehlspalette (`⌘K`)**: schnelle Tastaturnavigation zwischen Panels,
  Sessions und Themes (Dunkel, Hell, System).

## Schnellstart

### 1. Voraussetzungen und Setup

```bash
npm install
npm run setup:core   # Lädt den angehefteten OpenCode-Binärdatei nach src-tauri/bin
```

### 2. Desktop-App starten

```bash
npm run dev          # Tauri-Desktop-App + automatische Kern-Überwachung
```

Oder Web-Vorschau:
```bash
npm run web          # Nur Vite — http://localhost:1420
```

### 3. Installer bauen (Windows / macOS / Linux)

```bash
npm run dist         # Lädt den angehefteten Kern, baut dann Release-Installer
```

Die Artefakte landen in `src-tauri/target/release/bundle/`:

| OS | Dateien |
|---|---|
| Windows | `.msi`, NSIS-`.exe` |
| macOS | `.app`, `.dmg` (pro Architektur mit `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Der angeheftete OpenCode-Kern reist **in** jedem Installer mit
(`bundle.externalBin`): Endnutzer installieren eine Datei und fassen nie ein
Terminal an.

Schnelle Iteration ohne Release-Bundling: `npm run dist:debug`.

### 4. Für Nutzer veröffentlichen (ein Befehl für alle drei OS)

Die Installer für jedes OS baut die CI, wenn ein Versions-Tag gepusht wird:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions (`.github/workflows/release.yml`) baut Windows-`.msi`/`.exe`,
macOS-`.dmg` (Apple Silicon + Intel) und Linux-`.deb`/`.rpm`/`.AppImage` und
hängt alle an den GitHub Release an. Das ist das nächste Äquivalent zu
`npm install -g` für eine Desktop-App: Nutzer klicken einen Link auf der
Releases-Seite.

> Hinweis: `npm install -g` ist für CLI-Tools. BuzzAgent ist eine
> Desktop-GUI-App; die Verteilung läuft über Installer; einen
> Global-Install-Pfad gibt es nicht.

### 5. Verifikation und Tests

```bash
npm run typecheck    # Strikte TypeScript-Prüfung
npm run lint         # ESLint 9
npm test             # Vitest-Unit-Suite (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Rust-Tests: Supervisor, git, Browser
npm run test:integration     # End-to-End gegen echtes OpenCode + Mock-Provider
```

## Lizenz

[MIT](../LICENSE) © BuzzAgent-Mitwirkende.

OpenCode ist ebenfalls MIT
([anomalyco/opencode](https://github.com/anomalyco/opencode)). Die
Sidecar-Binärdatei ist eine Abhängigkeit, kein Fork.
