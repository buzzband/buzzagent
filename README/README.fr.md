# BuzzAgent — Français (README.fr.md)

🌐 Site web du projet : **https://b4zz.com/agent**

Atelier visuel open source pour agents de programmation IA. Le cœur de
l'agent est [OpenCode](https://github.com/anomalyco/opencode) (MIT) ;
BuzzAgent est le client GUI autour — pas un autre runtime d'agent.

> **Voyez tout ce que fait l'agent. Contrôlez modèles, outils, navigateur,
> MCP et raisonnement — en local, avec zéro télémétrie.**

## Pourquoi ça existe

Le marché est coupé en deux :

**Visuel mais faible.** Cline, Kilo Code, Roo Code — une UI utilisable, mais
enfermée dans VS Code, avec télémétrie et une boucle d'agent plus faible.

**Puissant mais aveugle.** OpenCode, Claude Code, Codex CLI, Oh My Pi — un
agent fort, mais un terminal. Pas de diffs visuels, pas de navigateur
intégré, pas d'orchestration d'espaces de travail.

Le trou à combler : un produit qui garde la puissance des agents terminal
**et** offre le contrôle visuel, sans télémétrie ni enfermement.

BuzzAgent est ce produit. Il **ne réimplémente pas l'agent**. OpenCode est
déjà un serveur HTTP headless (`opencode serve`) avec une spécification
OpenAPI, un flux d'événements SSE et un SDK JS typé. Leur TUI est un client
de ce serveur ; leurs plugins IDE en sont un autre. BuzzAgent est le
troisième client : une GUI de bureau autonome.

La CLI de Kilo Code est un **fork** d'OpenCode, ensuite emballé en extension
VS Code (lignée Cline) avec comptes et télémétrie. Nous ne copions pas ça.
Un fork hérite de leur coût de maintenance et nous coupe de l'amont. Un
client garde le cœur à jour au fil des publications d'OpenCode, qui sont
constantes.

### OpenCode publie désormais sa propre GUI

Depuis la 1.18, le dépôt OpenCode publie des builds `opencode-desktop-*`
(Electron + SolidJS, ~120–150 Mo) et un mode navigateur (`opencode web`).
« Un client visuel pour OpenCode » n'est **donc plus un différenciateur en
soi** — les auteurs du cœur ont le leur.

Ce qui reste à nous :

- **Zéro télémétrie comme fait vérifiable.** Leur bureau intègre
  `@sentry/solid` et l'initialise quand `VITE_SENTRY_DSN` est défini à la
  compilation (`packages/desktop/src/renderer/index.tsx`), plus
  `sentryVitePlugin` dans le build. Notre process n'a aucun crash reporter
  ni aucune dépendance d'analytique.
- **Un navigateur dans la boucle de l'agent** — il écrit le code, ouvre le
  résultat, la capture revient comme résultat d'outil, il corrige. Pas seul
  headless : on peut aussi s'attacher à un Chrome en cours via CDP, pour que
  l'agent travaille sur un profil où l'utilisateur est déjà connecté
  (soumis aux permissions comme `shell_exec`).
- **Orchestration de worktrees** — plusieurs agents en parallèle sur des
  branches isolées, avec moniteur visuel.
- **Pas de compte, pas de gateway embarquée.** Pas de chemin par défaut
  Zen/Go.

La conséquence : notre GUI sera comparée directement à la leur. Ça monte le
niveau d'exigence, et c'est pourquoi le Jalon 1 est une tranche étroite et
fiable plutôt qu'un large balayage de fonctionnalités.

Un précédent utile de leur bureau : `packages/desktop/src/main/sidecar.ts`
lance le serveur avec `OPENCODE_SERVER_PASSWORD`, port aléatoire, CORS
restreint à leur seule origine, loopback forcé dans `NO_PROXY` et
certificats CA système chargés. Nous adoptons le même durcissement.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Couche visuelle ──HTTP + SSE──►  opencode serve         │
│  chat · diffs · fichiers ·      (binaire sidecar,        │
│  fournisseurs · permissions ·    version épinglée)        │
│  worktrees                                              │
│                                                         │
│  Couche Rust                                            │
│  · supervise le processus du cœur                        │
│  · navigateur embarqué (CDP) ──enregistré comme outil──  │
│  · orchestration des git worktrees                       │
└─────────────────────────────────────────────────────────┘
```

- **Cœur = OpenCode.** Boucle d'outils, function calling natif, streaming,
  sessions et reprise, compaction, permissions, LSP, MCP,
  grep/glob/symbols, AGENTS.md, skills, slash commands, 75+ fournisseurs,
  OAuth. Nous ne réécrivons rien de tout cela.
- **GUI = BuzzAgent.** Chat avec cartes d'outils, diffs visuels, arborescence
  de fichiers, boîte de réception des permissions, contrôles de
  modèle/effort par rôle, moniteur de worktrees.
- **Extras natifs que le cœur n'a pas.** Navigateur embarqué dans la boucle
  de l'agent ; agents parallèles dans des git worktrees isolés.

Le frontend parle au cœur **directement** en HTTP et SSE, via
`@opencode-ai/sdk` généré depuis la spécification OpenAPI d'une version
**épinglée** (`GET /doc`). Rust ne sert pas de proxy au trafic de l'agent.
Rust fait seulement :

1. Démarre et supervise `opencode serve` (port aléatoire, mot de passe,
   santé).
2. Expose les outils natifs que le cœur ne sait pas faire seul (navigateur,
   worktrees).

C'est la même division qu'OpenCode utilise en interne : la TUI est un
client, le serveur est le runtime.

## Pourquoi Tauri (et ce que ça coûte)

Le chemin chaud — tokens en streaming, cartes d'outils, diffs — va du webview
au cœur local en HTTP/SSE direct. Il ne passe **pas** par l'IPC de Tauri, donc
le débit IPC du shell n'est pas sur le chemin critique. Le shell de bureau est
alors une décision d'empaquetage et de capacités natives, pas de performance.

Tauri, parce que :

- Nous avons de toute façon besoin d'une couche native pour la supervision de
  processus, le contrôle de navigateur via CDP et les git worktrees ; ce code
  existe et ses tests passent.
- Passer à Electron nous mettrait sur la pile exacte du bureau d'OpenCode
  (Electron + SolidJS + sidecar), où les auteurs du cœur ont de l'avance et
  où nous ne différencierions en rien.
- Leur template Electron embarque une intégration Sentry. Notre promesse «
  zéro télémétrie » est plus facile à garder vraie sur une pile que nous
  contrôlons.
- La taille du bundle est un argument faible ici : le binaire du cœur pèse à
  lui seul ~57 Mo, donc 5 Mo contre 120 Mo de shell n'est pas décisif.

Le vrai coût, dit franchement :

- **Trois webviews différents.** WebView2 (Chromium, auto-mise à jour) sur
  Windows, WKWebView sur macOS, `webkit2gtk` sur Linux. Selon le tableau de
  Tauri lui-même, `webkit2gtk` 2.36 ≈ Safari 16 et les vieilles distros sont
  bien derrière. Linux est la cible la plus faible et celle où nous verrons
  les bugs de rendu en premier. Atténuation : CSS conservateur, pas d'API web
  de pointe, tests sur un vrai `webkit2gtk`.
- **Plusieurs webviews dans une fenêtre sont derrière le flag `unstable` de
  Tauri.** Ça compte pour le panneau navigateur : on préfère CDP + captures/
  streaming vers l'UI plutôt qu'un second webview vivant, ou une fenêtre
  séparée.
- Temps de compilation Rust et écosystème de plugins plus petit que celui
  d'Electron.

### Alternatives envisagées

| Option | Verdict |
|---|---|
| **Electron** | UX la plus prévisible : un Chromium partout, le meilleur écosystème, le devtools le plus simple. Rejeté par défaut parce que c'est exactement la pile du bureau d'OpenCode, et il faudrait quand même du natif via des addons node. Le repli honnête si les bugs de `webkit2gtk` deviennent ingérables. |
| **Go + Wails** | Même modèle de webview système que Tauri, donc le même problème `webkit2gtk`, en abandonnant le code Rust existant. Go n'apporte rien ici : le cœur n'est pas en Go, et notre travail natif (CDP, worktrees, supervision) n'est pas plus simple en Go. |
| **GUI Rust pure** (egui, Iced, GPUI, Dioxus native, Slint) | Supprime la classe de bugs des webviews et donne une vraie performance native. Mais il faudrait écrire à la main chat, markdown, coloration syntaxique, vues de diff et arborescence — la surface même par laquelle on juge une GUI d'agent de code. Un détour de plusieurs années, et un panneau navigateur devient très difficile. Pas viable pour la v1. |
| **UI web seule** (servir notre frontend dans un navigateur) | La moins chère, et un objectif secondaire vraiment utile — mais OpenCode publie déjà `opencode web`, et un onglet ne peut pas posséder de menus natifs, worktrees ou navigateur embarqué. Bien comme mode additionnel plus tard, pas comme produit. |
| **Flutter / .NET / Qt** | Widgets de qualité native, mais pas de réutilisation de React, et l'écosystème « rendre markdown + diffs + code » est plus faible que celui du web. Grosse réécriture sans gain stratégique. |
| **Extension VS Code** | Immédiatement familière et pas chère, mais c'est la boîte Cline/Kilo contre laquelle nous nous positionnons explicitement, et ça tue l'histoire de l'app autonome / sans télémétrie. |

Décision : **Tauri + React maintenant**, Electron étant le repli documenté si
les défauts de webview sous Linux s'avèrent ingérables. Garder l'UI comme un
simple client HTTP/SSE du cœur, c'est ce qui rend ce repli bon marché — le
shell est remplaçable précisément parce qu'aucune logique d'agent n'y vit.

### Pourquoi pas Oh My Pi comme cœur

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30k étoiles) est un
agent fort — par endroits plus profond qu'OpenCode : LSP dans la boucle, DAP,
éditions hashline, une grande couche Rust native, des schémas d'URI
`pr://`/`issue://`/`agent://`, des chaînes de repli de modèles. C'est quand
même le mauvais cœur *pour ce produit* :

- **Pas de serveur HTTP.** Ses quatre surfaces sont la TUI, un prompt
  one-shot, un SDK Node in-process, et `--mode rpc` / `acp` sur **stdio**.
  Un navigateur ne parle pas stdio, donc Rust devrait proxifier chaque
  message — la couche que nous avons volontairement retirée — et leur RPC
  exige un découpage manuel des trames à 1 Mio et une négociation de
  protocole. Pas de spec OpenAPI, donc pas de client généré.
- **Une télémétrie qu'on ne peut pas éteindre.** Un UUID d'installation
  persistant (`~/.omp/install-id`, documenté dans leur `docs/install-id.md`)
  survit à l'effacement de l'état de l'agent et alimente, entre autres, un
  rapport d'usage d'un auth-broker qui envoie aussi le hostname, plus des
  pushes auto-QA. Le retirer signifie forker leur runtime, ce qui annule
  l'intérêt de réutiliser un cœur.
- **Le créneau est pris :** `gooey-pi`, `pi-desktop`, `ohmypi-craft`,
  `ompweb` sont déjà des GUI pour OMP.

Si un jour nous ajoutons un second backend, ce sera via **ACP** — un
protocole partagé — derrière une interface adaptateur, et seulement quand la
tranche OpenCode sera solide.

## La qualité de l'interface est le produit

Tout ce qui précède est de la plomberie. La raison d'utiliser BuzzAgent est
l'interface, donc elle est tenue à un standard, pas à « ça marche » : rien
ne bloque sur le réseau, 60 fps pendant le streaming, pas de décalage de
mise en page, clavier d'abord, vrais diffs côte à côte avec coloration
syntaxique, sessions longues virtualisées, états vides/erreur/hors-ligne
conçus, thèmes sombre **et** clair, et une accessibilité réelle (focus,
contraste, support du lecteur d'écran pour le flux de messages).

Le bar complet, la pile frontend retenue (React 19, Tailwind 4, Radix,
Shiki, CodeMirror 6, TanStack Virtual, cmdk) et les règles d'ajout de
dépendances sont dans [PLAN.md](./PLAN.md#ui-quality-bar).

## Comment un réglage atteint le cœur

L'UI ne garde jamais une seconde copie de l'état du cœur. Exemple —
l'utilisateur colle une clé API :

1. Le panneau Modèles appelle `GET /provider/auth`. Le formulaire est rendu
   depuis le schéma que renvoie le cœur (clé API, OAuth, device flow, …).
2. À l'enregistrement, l'UI appelle `PUT /auth/:id`. Le cœur écrit
   `~/.local/share/opencode/auth.json`. La clé ne reste ni dans notre store
   ni dans `localStorage`.
3. Base URL, liste blanche de modèles, `share: "disabled"` passent par
   `PATCH /config`.
4. Le sélecteur de modèles est `GET /config/providers` / `GET /provider`.
5. Le modèle d'un tour est un champ de `POST /session/:id/message` (`model`,
   `agent`). Un « routeur par rôle » est notre UI qui choisit ces champs —
   pas un second client HTTP devant 75 fournisseurs.

Les fournisseurs OAuth (Claude Pro, Copilot, GitLab Duo, DigitalOcean)
utilisent `POST /provider/{id}/oauth/authorize` → navigateur système →
`POST /provider/{id}/oauth/callback`. Aucun code spécifique fournisseur chez
nous.

Si deux stores divergent à nouveau, l'agent ne démarrera pas. Le cœur est
l'unique propriétaire de la config, des sessions, des diffs et des
permissions.

## Ce qu'on livre et ce qu'on ne livre pas

**Nous n'écrivons pas :** les fournisseurs, OAuth, la boucle d'outils, le
streaming, les sessions, la compaction, le moteur de permissions, LSP, MCP,
grep/glob/symbols, AGENTS.md, slash commands, skills, todos.

**Nous écrivons :** toute la couche visuelle ; le navigateur embarqué comme
outil du cœur ; l'orchestration de worktrees ; la boîte de permissions ; le
routeur visuel de modèle/effort ; la supervision de process ;
l'empaquetage.

**Nous ne forkons pas OpenCode** sauf si une tranche verticale prouve qu'il
faut changer la sémantique du cœur (system prompts, comportement des
outils, staging des diffs). Cette décision se prend sur preuve, après le
Jalon 1, pas à l'avance.

## Positionnement

```
BuzzAgent = cœur OpenCode
          + contrôle visuel de niveau Cline
          + orchestration de worktrees de niveau Orca
          + un navigateur intégré dans la boucle de l'agent
          + zéro télémétrie
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Open source | oui | oui | non | non | oui |
| Zéro télémétrie | oui (auditée — voir plus bas) | non | non | non | presque (share/Zen optionnels) |
| GUI visuelle | bureau autonome | VS Code | oui | non | TUI / web |
| Navigateur intégré dans la boucle | oui | non | non | non | non |
| Orchestration de worktrees | oui | non | non | non | sessions seulement |
| Sous-agents, LSP, MCP, permissions | via le cœur | partiel | partiel | oui | oui |
| Agnostique à l'agent plus tard | interface adaptateur, OpenCode d'abord | non | non | non | n/a |

Kilo Code a prouvé que le cœur d'OpenCode peut porter un produit, et MIT le
permet. Ils ont ensuite occupé le créneau IDE + télémétrie + facturation. Le
créneau qu'ils ont laissé ouvert est exactement celui-ci : bureau autonome,
pas de compte, pas de télémétrie, navigateur + worktrees.

## Zéro télémétrie — vérifié

L'audit (Jalon 0) est terminé et vérifié empiriquement. Les étapes de
reproduction complètes sont dans
[docs/telemetry-audit.md](./docs/telemetry-audit.md).

- **Zéro télémétrie tierce.** Ni Sentry, PostHog, Segment, Mixpanel, Datadog
  ni SDK d'analytique dans le binaire du cœur.
- **Appels réseau sortants forcés à off.** Le partage de conversations
  (`"share": "disabled"`), les auto-mises à jour (`"autoupdate": false`) et
  les petits modèles Zen sont coupés via une config forcée sur disque.
- **Environnement isolé.** Tout l'état, le cache, la db et les logs vivent
  isolés dans le dossier de données de l'application (`XDG_CONFIG_HOME`,
  `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`).
- **Sécurité.** Authentification HTTP Basic avec mots de passe aléatoires de
  64 caractères, liée uniquement à `127.0.0.1`.

## État actuel

BuzzAgent est reconstruit et pleinement fonctionnel :
- **Superviseur du cœur (Rust)** : gestion automatique du processus, port
  aléatoire, génération de mot de passe, health checks, isolement de
  l'environnement, contournement `NO_PROXY` du loopback, arrêt propre en
  sortie.
- **Client direct HTTP + SSE** : connexion directe à l'API du cœur OpenCode,
  parsing du flux d'événements résilient aux frontières de trames, gestion
  des sessions, messages multi-tours, contrôle des permissions.
- **UI du workbench visuel** : chat en streaming temps réel avec markdown
  sans scintillement, blocs de code colorés (Shiki), cartes d'outils
  inspectables avec états/durées/erreurs, dialogues de permission.
- **Panneau de diffs visuels** : visionneuse git temps réel avec marques au
  niveau du mot (`+`/`−`) et revert d'un fichier en un clic.
- **Panneau navigateur intégré** : automatisation Chrome headless et
  attachement CDP en direct (`http://127.0.0.1:9222`), flux de captures du
  viewport, interaction par sélecteurs (clic, saisie), visionneuse de logs
  console CDP en temps réel.
- **Orchestration de worktrees** : créer et gérer des git worktrees isolés
  par branche, changer de projet actif à la volée.
- **Palette de commandes (`⌘K`)** : navigation clavier rapide entre panneaux,
  sessions et thèmes (Sombre, Clair, Système).

## Démarrage rapide

### 1. Prérequis et installation

```bash
npm install
npm run setup:core   # Télécharge le binaire OpenCode épinglé dans src-tauri/bin
```

### 2. Lancer l'application de bureau

```bash
npm run dev          # App bureau Tauri + supervision automatique du cœur
```

Ou aperçu web :
```bash
npm run web          # Vite seul — http://localhost:1420
```

### 3. Compiler les installateurs (Windows / macOS / Linux)

```bash
npm run dist         # Télécharge le cœur épinglé, puis compile les installateurs
```

Les artefacts atterrissent dans `src-tauri/target/release/bundle/` :

| OS | Fichiers |
|---|---|
| Windows | `.msi`, `.exe` NSIS |
| macOS | `.app`, `.dmg` (par architecture avec `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

Le cœur OpenCode épinglé voyage **dans** chaque installateur
(`bundle.externalBin`) : l'utilisateur final installe un fichier et ne touche
jamais un terminal.

Itération rapide sans empaquetage de release : `npm run dist:debug`.

### 4. Publier aux utilisateurs (une commande pour les trois OS)

Les installateurs de chaque OS sont compilés par le CI quand un tag de
version est poussé :

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions (`.github/workflows/release.yml`) compile `.msi`/`.exe`
Windows, `.dmg` macOS (Apple Silicon + Intel) et `.deb`/`.rpm`/`.AppImage`
Linux, puis les attache tous au GitHub Release. C'est l'équivalent le plus
proche de `npm install -g` pour une app de bureau : l'utilisateur clique un
lien sur la page Releases.

> Remarque : `npm install -g` c'est pour les outils CLI. BuzzAgent est une
> app GUI de bureau : la distribution se fait par installateurs ; il n'y a
> pas d'installation globale.

### 5. Vérification et tests

```bash
npm run typecheck    # Vérification stricte TypeScript
npm run lint         # ESLint 9
npm test             # Suite de tests unitaires Vitest (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Tests Rust du superviseur, git, navigateur
npm run test:integration     # Bout en bout contre OpenCode réel + fournisseur mock
```

## Licence

[MIT](./LICENSE) © Contributeurs BuzzAgent.

OpenCode est aussi MIT
([anomalyco/opencode](https://github.com/anomalyco/opencode)). Le binaire
sidecar est une dépendance, pas un fork.
