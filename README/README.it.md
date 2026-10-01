# BuzzAgent — Italiano (README.it.md)

🌐 Sito web del progetto: **https://b4zz.com/agent**

⬇️ **Scarica:** [https://b4zz.com/agent/#download](https://b4zz.com/agent/#download)

Banco di lavoro visuale open source per agenti di programmazione IA. Il
nucleo dell'agente è [OpenCode](https://github.com/anomalyco/opencode) (MIT);
BuzzAgent è il client GUI attorno — non un altro runtime di agente.

> **Vedi tutto ciò che l'agente fa. Controlla modelli, strumenti, browser,
> MCP e ragionamento — in locale, con telemetria zero.**

## Perché esiste

Il mercato è spaccato in due:

**Visuale ma debole.** Cline, Kilo Code, Roo Code — un'UI utilizzabile, ma
sepolta in VS Code, con telemetria e un loop d'agente più fiacco.

**Potente ma cieco.** OpenCode, Claude Code, Codex CLI, Oh My Pi — un agente
forte, ma un terminale. Niente diff visivi, niente browser integrato, niente
orchestrazione degli spazi di lavoro.

Il vuoto è un prodotto che conserva la potenza degli agenti da terminale
**e** offre il controllo visivo, senza telemetria e senza prigionia del
fornitore.

BuzzAgent è quel prodotto. **Non reimplementa l'agente.** OpenCode è già
un server HTTP headless (`opencode serve`) con specifica OpenAPI, flusso di
eventi SSE e un SDK JS tipizzato. La loro TUI è un client di quel server; i
loro plugin IDE sono un altro. BuzzAgent è il terzo client: una GUI desktop
autonoma.

La CLI di Kilo Code è un **fork** di OpenCode, poi confezionato come
estensione VS Code (linea Cline) con account e telemetria. Non copiamo
questo. Un fork eredita il loro costo di manutenzione e ci taglia fuori
dall'upstream. Un client mantiene il nucleo aggiornato finché OpenCode
pubblica, cosa che fa di continuo.

### OpenCode ora spedisce anche la sua GUI

Dalla 1.18 il repository di OpenCode pubblica build `opencode-desktop-*`
(Electron + SolidJS, ~120–150 MB) e una modalità browser (`opencode web`).
"Un client visuale per OpenCode" quindi **non è più un elemento
differenziante di per sé** — gli autori del nucleo hanno il loro.

Che cosa resta nostro:

- **Telemetria zero come fatto verificabile.** Il loro desktop integra
  `@sentry/solid` e lo inizializza quando `VITE_SENTRY_DSN` è impostato in
  fase di build (`packages/desktop/src/renderer/index.tsx`), più
  `sentryVitePlugin` nella build. Il nostro processo non ha crash reporter né
  alcuna dipendenza di analytics.
- **Un browser nel loop dell'agente** — scrive codice, apre il risultato, lo
  screenshot torna come risultato di strumento, corregge. Non solo headless:
  si aggancia anche a un Chrome in esecuzione via CDP, così l'agente lavora
  su un profilo in cui l'utente ha già effettuato l'accesso (sorvegliato da
  permessi, come `shell_exec`).
- **Orchestrazione di worktree** — più agenti in parallelo su rami isolati,
  con monitor visivo.
- **Nessun account, nessuna gateway integrata.** Niente percorso predefinito
  via Zen/Go.

La conseguenza: la nostra GUI sarà confrontata direttamente con la loro. Questo
alza l'asticella ed è il motivo per cui il Milestone 1 è una fetta stretta e
affidabile, non una piallata larga di funzionalità.

Un precedente utile dal loro desktop: `packages/desktop/src/main/sidecar.ts`
avvia il server con `OPENCODE_SERVER_PASSWORD`, porta casuale, CORS limitato
alla sola origine propria, loopback forzato dentro `NO_PROXY` e certificati CA
di sistema caricati. Adottiamo lo stesso indurimento.

## Architettura

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Livello visivo  ──HTTP + SSE──►  opencode serve         │
│  chat · diff · file ·           (binario sidecar,        │
│  provider · permessi ·           versione bloccata)      │
│  worktree                                                │
│                                                         │
│  Livello Rust                                            │
│  · sorveglia il processo del nucleo                       │
│  · browser integrato (CDP) ──registrato come strumento── │
│  · orchestrazione di git worktree                         │
└─────────────────────────────────────────────────────────┘
```

- **Nucleo = OpenCode.** Loop di strumenti, function calling nativo,
  streaming, sessioni e ripresa, compattazione, permessi, LSP, MCP,
  grep/glob/symbols, AGENTS.md, skill, slash command, 75+ provider, OAuth.
  Non riscriviamo nulla di tutto ciò.
- **GUI = BuzzAgent.** Chat con schede di tool-call, diff visivi, albero
  file, casella in arrivo dei permessi, controlli modello/sforzo per ruolo,
  monitor dei worktree.
- **Extra nativi che il nucleo non ha.** Browser integrato nel loop
  dell'agente; agenti paralleli in git worktree isolati.

Il frontend parla col nucleo **direttamente** via HTTP e SSE, usando
`@opencode-ai/sdk` generato dalla specifica OpenAPI di una versione
**bloccata** (`GET /doc`). Il Rust non fa da proxy al traffico dell'agente.
Il Rust fa solo:

1. Avvia e sorveglia `opencode serve` (porta casuale, password, health check).
2. Espone gli strumenti nativi che il nucleo non sa fare da sé (browser,
   worktree).

È la stessa divisione che OpenCode usa internamente: la TUI è un client, il
server è il runtime.

## Perché Tauri (e cosa costa)

Il percorso caldo — token in streaming, schede strumento, diff — va dal
webview al nucleo locale direttamente via HTTP/SSE. **Non** passa per l'IPC di
Tauri, quindi la velocità IPC della shell non sta sul cammino critico. Questo
rende la shell desktop una decisione di packaging e capacità native, non di
prestazioni.

Tauri, perché:

- Ci serve comunque un livello nativo — per la sorveglianza dei processi, il
  controllo del browser via CDP e i git worktree; quel codice esiste e i suoi
  test passano.
- Passare a Electron ci metterebbe esattamente sulla pila del desktop di
  OpenCode (Electron + SolidJS + sidecar), dove gli autori del nucleo sono in
  vantaggio e non ci differenzeremmo in nulla.
- Il loro template Electron porta un'integrazione Sentry. La nostra promessa
  di "telemetria zero" è più facile da mantenere vera su una pila che
  controlliamo noi.
- Il peso del bundle è un argomento debole qui: il binario del nucleo da solo
  pesa ~57 MB, quindi 5 MB contro 120 MB di shell non decide nulla.

Il costo vero, detto senza sconti:

- **Tre webview diversi.** WebView2 (Chromium, auto-aggiornante) su Windows,
  WKWebView su macOS, `webkit2gtk` su Linux. Secondo la tabella dello stesso
  Tauri, `webkit2gtk` 2.36 ≈ Safari 16, e le distro vecchie sono più indietro
  ancora. Linux è il bersaglio più debole ed è lì che vedremo prima i bug di
  rendering. Rimedio: CSS conservativo, niente API web di frontiera, test su
  `webkit2gtk` vero.
- **Più webview in una finestra stanno dietro il flag `unstable` di Tauri.**
  Conta per il pannello browser: meglio CDP + screenshot/stream verso l'UI
  che un secondo webview vivo incorporato, o accettare una finestra separata.
- Tempi di build Rust e un ecosistema di plugin più piccolo di Electron.

### Alternative considerate

| Opzione | Verdetto |
|---|---|
| **Electron** | UX più prevedibile: un Chromium ovunque, il migliore ecosistema, devtools più semplici. Scartato come predefinito perché è esattamente la pila del desktop di OpenCode, e il codice nativo andrebbe comunque scritto con addon node. Il ripiego onesto se i bug di `webkit2gtk` diventano ingestibili. |
| **Go + Wails** | Lo stesso modello di webview di sistema di Tauri, quindi l'identico problema `webkit2gtk`, rinunciando al codice Rust che già abbiamo. Go non compra nulla qui: il nucleo non è Go, e il nostro lavoro nativo (CDP, worktree, sorveglianza) non è più facile in Go. |
| **GUI pura in Rust** (egui, Iced, GPUI, Dioxus native, Slint) | Elimina l'intera classe di bug da webview e dà vera prestazione nativa. Ma dovremmo costruire a mano chat, markdown, evidenziazione sintattica, viste diff e albero file — esattamente la superficie per cui si giudica una GUI d'agente di codice. Una deviazione di anni, e un pannello browser diventa difficilissimo. Non praticabile per la v1. |
| **UI solo web** (servire il nostro frontend in un browser) | La più economica, e un bersaglio secondario genuinamente utile — ma OpenCode pubblica già `opencode web`, e una scheda non può avere menu nativi, worktree o browser integrato. Buono come modalità extra più avanti, non come prodotto. |
| **Flutter / .NET / Qt** | Widget di qualità nativa, ma senza riuso di React, e l'ecosistema per "renderizzare markdown + diff + codice" è più debole del web. Riscrittura enorme senza guadagno strategico. |
| **Estensione VS Code** | Subito familiare ed economica, ma è la scatola Cline/Kilo contro cui ci posizioniamo esplicitamente, e uccide la storia dell'app autonoma/senza telemetria. |

Decisione: **Tauri + React ora**, con Electron come ripiego documentato se i
difetti di webview su Linux si rivelassero ingestibili. Tenere l'UI come
semplice client HTTP/SSE del nucleo è ciò che rende quel ripiego economico —
la shell è sostituibile proprio perché nessuna logica d'agente vive in lei.

### Perché non Oh My Pi come nucleo

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30k stelle) è un agente
forte — in alcuni punti più profondo di OpenCode: LSP nel loop, DAP, modifiche
hashline, un grande strato Rust nativo, schemi URI `pr://`/`issue://`/`agent://`,
catene di fallback dei modelli. Rimane comunque il nucleo sbagliato *per questo
prodotto*:

- **Nessun server HTTP.** Le sue quattro superfici sono la TUI, un prompt
  monouso, un SDK Node in-process, e `--mode rpc` / `acp` su **stdio**. Un
  browser non parla stdio, quindi il Rust dovrebbe fare da proxy a ogni
  messaggio — lo strato che abbiamo tolto apposta — e il loro RPC richiede
  framing manuale a blocchi da 1 MiB e negoziazione di protocollo. Senza
  specifica OpenAPI non c'è client generato.
- **Telemetria che non si può spegnere.** Un UUID d'installazione persistente
  (`~/.omp/install-id`, documentato nel loro `docs/install-id.md`) sopravvive
  alla cancellazione dello stato dell'agente e alimenta, tra le altre, una
  relazione d'uso di un auth-broker che invia anche l'hostname, più push di
  auto-QA. Toglierlo significa fare fork del loro runtime, vanificando il
  senso di riutilizzare un nucleo altrui.
- **La nicchia è presa:** `gooey-pi`, `pi-desktop`, `ohmypi-craft`, `ompweb`
  sono già GUI per OMP.

Se un giorno aggiungeremo un secondo backend, sarà via **ACP** — protocollo
condiviso — dietro un'interfaccia adattatore, e solo quando la fetta OpenCode
sarà solida.

## La qualità dell'interfaccia è il prodotto

Tutto quanto sopra è impiantistica. Il motivo per usare BuzzAgent è
l'interfaccia, quindi viene giudicata su uno standard, non su "funziona": nulla
si blocca in rete, 60 fps durante lo streaming, nessun salto di layout,
tastiera prima, diff reali affiancati con evidenziazione della sintassi,
sessioni lunghe virtualizzate, stati vuoto/errore/offline disegnati, temi
scuro **e** chiaro, e accessibilità genuina (focus, contrasto, supporto del
lettore di schermo per il flusso dei messaggi).

L'asticella completa, la pila frontend scelta (React 19, Tailwind 4, Radix,
Shiki, CodeMirror 6, TanStack Virtual, cmdk) e le regole per aggiungere
dipendenze sono in PLAN.md.

## Come un'impostazione arriva al nucleo

L'UI non custodisce mai una seconda copia dello stato del nucleo. Esempio —
l'utente incolla una API key:

1. Il pannello Modelli chiama `GET /provider/auth`. Il modulo viene renderizzato
   dallo schema che il nucleo restituisce (API key, OAuth, device flow, …).
2. Al salvataggio l'UI chiama `PUT /auth/:id`. Il nucleo scrive
   `~/.local/share/opencode/auth.json`. La chiave non resta nel nostro store
   né nel `localStorage`.
3. Base URL, whitelist dei modelli, `share: "disabled"` passano per
   `PATCH /config`.
4. Il selettore dei modelli è `GET /config/providers` / `GET /provider`.
5. Il modello di un turno è un campo di `POST /session/:id/message` (`model`,
   `agent`). Un "router per ruolo" è la nostra UI che sceglie quei campi —
   non un secondo client HTTP davanti a 75 provider.

I provider OAuth (Claude Pro, Copilot, GitLab Duo, DigitalOcean) usano
`POST /provider/{id}/oauth/authorize` → browser di sistema →
`POST /provider/{id}/oauth/callback`. Nessun codice specifico per provider da
parte nostra.

Se due store divergono di nuovo, l'agente non parte. Il nucleo è l'unico
proprietario di configurazione, sessioni, diff e permessi.

## Cosa consegniamo e cosa no

**Non scriviamo:** provider, OAuth, il loop di strumenti, streaming, sessioni,
compattazione, il motore di permessi, LSP, MCP, grep/glob/symbols, AGENTS.md,
slash command, skill, todo.

**Scriviamo:** l'intero livello visivo; il browser integrato come strumento del
nucleo; l'orchestrazione dei worktree; la casella dei permessi; il router
visivo di modello/sforzo; la sorveglianza dei processi; il packaging.

**Non facciamo fork di OpenCode** a meno che una fetta verticale non provi che
dobbiamo cambiare la semantica del nucleo (system prompt, comportamento degli
strumenti, staging dei diff). Quella decisione si prende su prove, dopo il
Milestone 1, non in anticipo.

## Posizionamento

```
BuzzAgent = nucleo OpenCode
          + controllo visivo di livello Cline
          + orchestrazione di worktree di livello Orca
          + un browser integrato nel loop dell'agente
          + telemetria zero
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Open source | sì | sì | no | no | sì |
| Telemetria zero | sì (auditata — vedi sotto) | no | no | no | quasi (share/Zen opzionali) |
| GUI visuale | desktop autonomo | VS Code | sì | no | TUI / web |
| Browser integrato nel loop | sì | no | no | no | no |
| Orchestrazione worktree | sì | no | no | no | solo sessioni |
| Sub-agenti, LSP, MCP, permessi | via nucleo | parziale | parziale | sì | sì |
| Agnostico dall'agente più avanti | interfaccia adattatore, OpenCode primo | no | no | no | n/d |

Kilo Code ha provato che il nucleo di OpenCode regge un prodotto, e il MIT lo
consente. Poi hanno occupato la nicchia IDE + telemetria + fatturazione. La
nicchia che hanno lasciato aperta è esattamente questa: desktop autonomo,
niente account, niente telemetria, browser + worktree.

## Telemetria zero — verificata

L'audit (Milestone 0) è completato e verificato empiricamente. I passi di
riproduzione completi sono in
[docs/telemetry-audit.md](./docs/telemetry-audit.md).

- **Telemetria di terze parti zero.** Né Sentry, PostHog, Segment, Mixpanel,
  Datadog né alcun SDK di analytics nel binario del nucleo.
- **Chiamate di rete in uscita forzatamente off.** La condivisione delle
  conversazioni (`"share": "disabled"`), gli auto-aggiornamenti
  (`"autoupdate": false`) e i piccoli modelli Zen sono spenti via configurazione
  forzata su disco.
- **Ambiente isolato.** Tutto lo stato, la cache, il db e i log vivono isolati
  nella directory dati dell'applicazione (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`,
  `XDG_DATA_HOME`, `XDG_CACHE_HOME`).
- **Sicurezza.** Autenticazione HTTP Basic con password casuali di 64
  caratteri, vincolata solo a `127.0.0.1`.

## Stato attuale

BuzzAgent è ricostruito e pienamente funzionante:
- **Supervisore del nucleo (Rust)**: gestione automatica del processo,
  assegnazione di porta casuale, generazione della password, health check,
  isolamento dell'ambiente, bypass di `NO_PROXY` per il loopback, spegnimento
  pulito all'uscita.
- **Client diretto HTTP + SSE**: connessione diretta all'API del nucleo
  OpenCode, parsing del flusso eventi resistente ai confini di frame, gestione
  delle sessioni, messaggi multi-turno, gate dei permessi.
- **UI del banco visivo**: chat in streaming in tempo reale con markdown senza
  sfarfallio, blocchi di codice con evidenziazione (Shiki), schede strumento
  ispezionabili con stati/durate/errori, finestre di permesso.
- **Pannello diff visivi**: visualizzatore delle modifiche git in tempo reale
  con marche a livello di parola (`+`/`−`) e ritorno di un file con un clic.
- **Pannello browser integrato**: automazione di Chrome headless e aggancio
  CDP dal vivo (`http://127.0.0.1:9222`), streaming degli screenshot del
  viewport, interazione per selettori (clic, digitazione) e visualizzatore dei
  log console CDP in tempo reale.
- **Orchestrazione worktree**: creare e gestire git worktree isolati per
  branch, cambiare progetto attivo al volo.
- **Palette comandi (`⌘K`)**: navigazione da tastiera rapida tra pannelli,
  sessioni e temi (Scuro, Chiaro, Sistema).

## Avvio rapido

### 1. Prerequisiti e configurazione

```bash
npm install
npm run setup:core   # Scarica il binario OpenCode bloccato in src-tauri/bin
```

### 2. Avviare l'app desktop

```bash
npm run dev          # App desktop Tauri + sorveglianza automatica del nucleo
```

Oppure anteprima web:
```bash
npm run web          # Solo Vite — http://localhost:1420
```

### 3. Compilare gli installer (Windows / macOS / Linux)

```bash
npm run dist         # Scarica il nucleo bloccato, poi compila gli installer di rilascio
```

Gli artefatti atterrano in `src-tauri/target/release/bundle/`:

| OS | File |
|---|---|
| Windows | `.msi`, `.exe` NSIS |
| macOS | `.app`, `.dmg` (per architettura con `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Il nucleo OpenCode bloccato viaggia **dentro** ogni installer
(`bundle.externalBin`): l'utente finale installa un file e non tocca mai un
terminale.

Iterazione veloce senza packaging di rilascio: `npm run dist:debug`.

### 4. Pubblicare agli utenti (un comando per i tre OS)

Gli installer per ogni OS sono compilati dal CI quando viene spinto un tag di
versione:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions (`.github/workflows/release.yml`) compila `.msi`/`.exe`
Windows, `.dmg` macOS (Apple Silicon + Intel) e `.deb`/`.rpm`/`.AppImage`
Linux, e li allega tutti al GitHub Release. È l'equivalente più vicino a
`npm install -g` per un'app desktop: l'utente clicca un link sulla pagina
Releases.

> Nota: `npm install -g` è per strumenti CLI. BuzzAgent è un'app GUI desktop;
> la distribuzione avviene via installer; non esiste un percorso di
> installazione globale.

### 5. Verifica e test

```bash
npm run typecheck    # Controllo severo TypeScript
npm run lint         # ESLint 9
npm test             # Suite unit test Vitest (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Test Rust: supervisore, git, browser
npm run test:integration     # End-to-end contro OpenCode reale + provider mock
```

## Licenza

[MIT](../LICENSE) © Contributori BuzzAgent.

OpenCode è anch'esso MIT
([anomalyco/opencode](https://github.com/anomalyco/opencode)). Il binario
sidecar è una dipendenza, non un fork.
