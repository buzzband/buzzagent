# BuzzAgent — Español (README.es.md)

🌐 Sitio web del proyecto: **https://b4zz.com/agent**

⬇️ **Descargar:** [https://b4zz.com/agent/#download](https://b4zz.com/agent/#download)

Banco de trabajo visual de código abierto para agentes de programación con IA.
El núcleo del agente es [OpenCode](https://github.com/anomalyco/opencode)
(MIT); BuzzAgent es el cliente GUI alrededor — no otro runtime de agente.

> **Ve todo lo que hace el agente. Controla modelos, herramientas, navegador,
> MCP y razonamiento — localmente, con cero telemetría.**

## Por qué existe

El mercado está partido en dos:

**Visual pero débil.** Cline, Kilo Code, Roo Code — una UI usable, pero
encerrada en VS Code, con telemetría y un bucle de agente más flojo.

**Potente pero ciego.** OpenCode, Claude Code, Codex CLI, Oh My Pi — un
agente fuerte, pero un terminal. Sin diffs visuales, sin navegador integrado,
sin orquestación de espacios de trabajo.

El hueco es un producto que conserve la potencia de los agentes de terminal
**y** ofrezca control visual, sin telemetría ni cautiverio de proveedor.

BuzzAgent es ese producto. **No reimplementation el agente.** OpenCode ya es
un servidor HTTP sin cabeza (`opencode serve`) con especificación OpenAPI,
flujo de eventos SSE y un JS SDK tipado. Su TUI es un cliente de ese
servidor; sus plugins de IDE son otro. BuzzAgent es el tercer cliente: una
GUI de escritorio independiente.

La CLI de Kilo Code es un **fork** de OpenCode, luego empaquetado como
extensión de VS Code (linaje Cline) con cuentas y telemetría. Nosotros no
copiamos eso. Un fork hereda su coste de mantenimiento y nos corta del
upstream. Un cliente mantiene el núcleo al día mientras OpenCode publica
versiones constantemente.

### OpenCode ahora trae su propia GUI

Desde la 1.18 el repositorio de OpenCode publica builds
`opencode-desktop-*` (Electron + SolidJS, ~120–150 MB) y un modo navegador
(`opencode web`). "Un cliente visual para OpenCode" ya **no es un
diferenciador por sí solo** — los autores del núcleo tienen el suyo.

Lo que sigue siendo nuestro:

- **Cero telemetría como hecho verificable.** Su escritorio integra
  `@sentry/solid` y lo inicializa cuando `VITE_SENTRY_DSN` se define en
  tiempo de compilación (`packages/desktop/src/renderer/index.tsx`), además
  de `sentryVitePlugin` en el build. Nuestro proceso no tiene crash reporter
  ni dependencia de analítica alguna.
- **Un navegador dentro del bucle del agente** — escribes código, abres el
  resultado, la captura vuelve como resultado de herramienta, corriges. No
  solo headless: también se conecta a un Chrome en ejecución vía CDP, para
  que el agente trabaje sobre un perfil donde el usuario ya inició sesión
  (con permisos, igual que `shell_exec`).
- **Orquestación de worktrees** — varios agentes en paralelo en ramas
  aisladas, con monitor visual.
- **Sin cuenta, sin gateway incluido.** Sin la ruta por defecto Zen/Go.

La consecuencia: nuestra GUI se compara directamente con la de ellos. Eso
sube el listón y es la razón por la que el Hito 1 es una rebanada estrecha y
fiable, no un barrido amplio de funciones.

Precedente útil de su escritorio: `packages/desktop/src/main/sidecar.ts`
arranca el servidor con `OPENCODE_SERVER_PASSWORD`, puerto aleatorio, CORS
restringido a su propio origen, loopback forzado en `NO_PROXY` y certificados
CA del sistema cargados. Adoptamos el mismo endurecimiento.

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  BuzzAgent (Tauri + React)                              │
│                                                         │
│  Capa visual   ──HTTP + SSE──►  opencode serve           │
│  chat · diffs · archivos ·      (binario sidecar,        │
│  proveedores · permisos ·        versión fijada)         │
│  worktrees                                              │
│                                                         │
│  Capa Rust                                              │
│  · supervisa el proceso del núcleo                       │
│  · navegador embebido (CDP) ──registrado como tool─────  │
│  · orquestación de git worktrees                         │
└─────────────────────────────────────────────────────────┘
```

- **Núcleo = OpenCode.** Bucle de herramientas, function calling nativo,
  streaming, sesiones y reanudación, compactación, permisos, LSP, MCP,
  grep/glob/symbols, AGENTS.md, skills, slash commands, 75+ proveedores,
  OAuth. No reescribimos nada de esto.
- **GUI = BuzzAgent.** Chat con tarjetas de tool-calls, diffs visuales,
  árbol de archivos, bandeja de permisos, controles de modelo/esfuerzo por
  rol, monitor de worktrees.
- **Extras nativos que el núcleo no tiene.** Navegador embebido en el bucle
  del agente; agentes paralelos en git worktrees aislados.

El frontend habla con el núcleo **directamente** por HTTP y SSE, usando
`@opencode-ai/sdk` generado desde la especificación OpenAPI de una versión
**fijada** (`GET /doc`). Rust no hace de proxy del tráfico del agente. Rust
solo:

1. Lanza y supervisa `opencode serve` (puerto aleatorio, contraseña, salud).
2. Expone herramientas nativas que el núcleo no puede hacer solo (navegador,
   worktrees).

Es la misma división que OpenCode usa internamente: la TUI es un cliente, el
servidor es el runtime.

## Por qué Tauri (y lo que cuesta)

La ruta caliente — tokens en streaming, tarjetas de herramientas, diffs — va
directa del webview al núcleo local por HTTP/SSE. **No** pasa por el IPC de
Tauri, así que el rendimiento IPC del shell no está en el camino crítico. Eso
hace del shell de escritorio una decisión de empaquetado y capacidades
nativas, no de rendimiento.

Tauri, porque:

- Ya necesitamos una capa nativa para supervisión de procesos, control de
  navegador por CDP y git worktrees; ese código existe y sus pruebas pasan.
- Movernos a Electron nos pondría en el stack exacto del escritorio de
  OpenCode (Electron + SolidJS + sidecar), donde los autores del núcleo
  llevan ventaja y no diferenciaríamos en nada.
- Su plantilla de Electron trae integración de Sentry. Nuestra promesa de "cero
  telemetría" es más fácil de mantener verdadera en un stack que controlamos.
- El tamaño del bundle es un argumento débil aquí: el binario del núcleo solo
  ya pesa ~57 MB, así que 5 MB frente a 120 MB de shell no decide nada.

El coste real, dicho sin adornos:

- **Tres webviews distintos.** WebView2 (Chromium, auto-actualizable) en
  Windows, WKWebView en macOS, `webkit2gtk` en Linux. Según la propia tabla
  de Tauri, `webkit2gtk` 2.36 ≈ Safari 16 y las distros antiguas van más
  atrás. Linux es el objetivo más débil y donde veremos bugs de renderizado
  primero. Mitigación: CSS conservador, sin APIs web de vanguardia, probar en
  `webkit2gtk` real.
- **Varios webviews en una ventana están tras el flag `unstable` de Tauri.**
  Importa para el panel del navegador: preferimos CDP + capturas/streaming
  hacia la UI antes que incrustar un segundo webview vivo, o aceptar una
  ventana aparte.
- Tiempos de compilación de Rust y un ecosistema de plugins menor que el de
  Electron.

### Alternativas consideradas

| Opción | Veredicto |
|---|---|
| **Electron** | UX más predecible: un Chromium en todas partes, el mejor ecosistema, el devtools más fácil. Rechazado como predeterminado porque es exactamente el stack del escritorio de OpenCode, y aún necesitaríamos código nativo vía addons de node. La alternativa honesta si los bugs de `webkit2gtk` se vuelven inmanejables. |
| **Go + Wails** | Mismo modelo de webview del sistema que Tauri, así que hereda el idéntico problema de `webkit2gtk` mientras renuncia al código Rust que ya tenemos. Go no compra nada aquí: el núcleo no es Go, y nuestro trabajo nativo (CDP, worktrees, supervisión) no es más fácil en Go. |
| **GUI pura en Rust** (egui, Iced, GPUI, Dioxus native, Slint) | Elimina la clase de bugs de webview y da rendimiento nativo real. Pero construiríamos a mano chat, markdown, resaltado de sintaxis, vistas de diff y árbol de archivos — justo la superficie por la que se juzga a una GUI de agente de código. Un desvío de años, y un panel de navegador se vuelve muy difícil. No viable para v1. |
| **UI solo web** (servir nuestro frontend en un navegador) | La más barata y un objetivo secundario genuinamente útil — pero OpenCode ya publica `opencode web`, y una pestaña no puede tener menús nativos, worktrees ni navegador embebido. Bien como modo extra más adelante, no como producto. |
| **Flutter / .NET / Qt** | Widgets de calidad nativa, pero sin reutilizar React, y el ecosistema para "renderizar markdown + diffs + código" es más débil que el de la web. Reescritura grande sin ganancia estratégica. |
| **Extensión de VS Code** | Familiar y barata, pero es la caja de Cline/Kilo contra la que nos posicionamos explícitamente, y mata la historia de app independiente/sin telemetría. |

Decisión: **Tauri + React ahora**, con Electron como fallback documentado si
los defectos de webview en Linux resultan inmanejables. Mantener la UI como
cliente HTTP/SSE simple del núcleo es lo que hace barato ese fallback — el
shell es reemplazable precisamente porque no vive en él ninguna lógica de
agente.

### Por qué no Oh My Pi como núcleo

[oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT, ~30k estrellas) es un
agente fuerte — en algunos aspectos más profundo que OpenCode: LSP en el
bucle, DAP, ediciones hashline, una gran capa nativa en Rust, esquemas URI
`pr://`/`issue://`/`agent://`, cadenas de fallback de modelos. Aun así es el
núcleo equivocado *para este producto*:

- **Sin servidor HTTP.** Sus cuatro superficies son la TUI, un prompt de un
  disparo, un SDK de Node en proceso, y `--mode rpc` / `acp` sobre **stdio**.
  Un navegador no habla stdio, así que Rust tendría que hacer de proxy de
  cada mensaje — la capa que quitamos deliberadamente — y su RPC exige
  troceado manual de tramas de 1 MiB y negociación de protocolo. Sin
  especificación OpenAPI no hay cliente generado.
- **Telemetría que no podemos apagar.** Un UUID de instalación persistente
  (`~/.omp/install-id`, documentado en su `docs/install-id.md`) sobrevive a
  borrar el estado del agente y alimenta, entre otros, un informe de uso de
  un auth-broker que además envía el hostname, y pushes de auto-QA. Quitarlo
  implica forkear su runtime, lo que anula el sentido de reutilizar un núcleo.
- **El nicho está ocupado:** `gooey-pi`, `pi-desktop`, `ohmypi-craft`,
  `ompweb` ya son GUIs de OMP.

Si algún día añadimos un segundo backend, será vía **ACP** — protocolo
compartido — tras una interfaz adaptadora, y solo cuando la rebanada de
OpenCode sea sólida.

## La calidad de la interfaz es el producto

Todo lo anterior es fontanería. La razón para usar BuzzAgent es la interfaz,
así que se le exige un estándar, no un "funciona": nada se bloquea por la
red, 60 fps durante el streaming, sin saltos de diseño, teclado primero,
diffs reales lado a lado con resaltado de sintaxis, sesiones largas
virtualizadas, estados vacío/error/sin conexión diseñados, temas oscuro
**y** claro, y accesibilidad genuina (foco, contraste, soporte de lector de
pantalla para el flujo de mensajes).

El listón completo, el stack frontend elegido (React 19, Tailwind 4, Radix,
Shiki, CodeMirror 6, TanStack Virtual, cmdk) y las reglas para añadir
dependencias están en PLAN.md.

## Cómo llega un ajuste al núcleo

La UI nunca guarda una segunda copia del estado del núcleo. Ejemplo — el
usuario pega una API key:

1. El panel de modelos llama a `GET /provider/auth`. El formulario se
   renderiza desde el schema que devuelve el núcleo (API key, OAuth, device
   flow, …).
2. Al guardar, la UI llama a `PUT /auth/:id`. El núcleo escribe
   `~/.local/share/opencode/auth.json`. La clave no queda en nuestro store
   ni en `localStorage`.
3. Base URL, lista blanca de modelos, `share: "disabled"` van por
   `PATCH /config`.
4. El selector de modelos es `GET /config/providers` / `GET /provider`.
5. El modelo de un turno es un campo de `POST /session/:id/message`
   (`model`, `agent`). Un "router por rol" es nuestra UI eligiendo esos
   campos — no un segundo cliente HTTP delante de 75 proveedores.

Los proveedores OAuth (Claude Pro, Copilot, GitLab Duo, DigitalOcean) usan
`POST /provider/{id}/oauth/authorize` → navegador del sistema →
`POST /provider/{id}/oauth/callback`. Sin código específico de proveedor en
nuestro lado.

Si dos stores vuelven a divergir, el agente no arrancará. El núcleo es el
único dueño de configuración, sesiones, diffs y permisos.

## Qué construimos y qué no

**No escribimos:** proveedores, OAuth, el bucle de herramientas, streaming,
sesiones, compactación, el motor de permisos, LSP, MCP, grep/glob/symbols,
AGENTS.md, slash commands, skills, todos.

**Sí escribimos:** toda la capa visual; el navegador embebido como
herramienta del núcleo; orquestación de worktrees; la bandeja de permisos;
el router visual de modelo/esfuerzo; la supervisión de procesos;
el empaquetado.

**No hacemos fork de OpenCode** salvo que una rebanada vertical pruebe que
debemos cambiar la semántica del núcleo (system prompts, comportamiento de
herramientas, staging de diffs). Esa decisión se toma con evidencia, tras el
Hito 1, no por adelantado.

## Posicionamiento

```
BuzzAgent = núcleo OpenCode
          + control visual de nivel Cline
          + orquestación de worktrees de nivel Orca
          + un navegador integrado en el bucle del agente
          + cero telemetría
```

| | BuzzAgent | Cline / Kilo | Cursor | Claude Code | OpenCode |
|---|---|---|---|---|---|
| Código abierto | sí | sí | no | no | sí |
| Cero telemetría | sí (auditada — ver abajo) | no | no | no | casi (share/Zen opcional) |
| GUI visual | escritorio independiente | VS Code | sí | no | TUI / web |
| Navegador integrado en el bucle | sí | no | no | no | no |
| Orquestación de worktrees | sí | no | no | no | solo sesiones |
| Subagentes, LSP, MCP, permisos | vía núcleo | parcial | parcial | sí | sí |
| Agnóstico de agente más adelante | interfaz adaptadora, OpenCode primero | no | no | no | n/a |

Kilo Code demostró que el núcleo de OpenCode aguanta un producto, y MIT lo
permite. Luego ocuparon el nicho de IDE + telemetría + facturación. El nicho
que dejaron libre es justo este: escritorio independiente, sin cuenta, sin
telemetría, navegador + worktrees.

## Cero telemetría — verificado

La auditoría (Hito 0) está completada y verificada empíricamente. Los pasos
de reproducción completos están en
[docs/telemetry-audit.md](./docs/telemetry-audit.md).

- **Cero telemetría de terceros.** Ni Sentry, PostHog, Segment, Mixpanel,
  Datadog ni SDKs de analítica en el binario del núcleo.
- **Llamadas de red salientes forzadas a off.** El uso compartido de
  conversaciones (`"share": "disabled"`), las auto-actualizaciones
  (`"autoupdate": false`) y los modelos pequeños Zen se apagan mediante
  configuración forzada en disco.
- **Entorno aislado.** Todo el estado, caché, base de datos y logs viven
  aislados en el directorio de datos de la aplicación
  (`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`).
- **Seguridad.** Autenticación HTTP Basic con contraseñas aleatorias de 64
  caracteres, enlazado solo a `127.0.0.1`.

## Estado actual

BuzzAgent está reconstruido y completamente funcional:
- **Supervisor del núcleo (Rust)**: gestión automática del proceso, puerto
  aleatorio, generación de contraseñas, health checks, aislamiento del
  entorno, bypass de `NO_PROXY` para loopback, teardown limpio al salir.
- **Cliente directo HTTP + SSE**: conexión directa a la API del núcleo
  OpenCode, parsing del flujo de eventos con resiliencia a límites de frame,
  gestión de sesiones, mensajes multitérmino, control de permisos.
- **UI del banco de trabajo visual**: chat en streaming en tiempo real con
  markdown sin parpadeos, bloques de código con resaltado (Shiki), tarjetas
  de herramientas inspeccionables con estados/duraciones/errores, diálogos
  de permisos.
- **Panel de diffs visuales**: visor de cambios de git en tiempo real con
  marcas a nivel de palabra (`+`/`−`) y reversión de archivo con un clic.
- **Panel de navegador integrado**: automatización de Chrome headless y
  conexión CDP en vivo (`http://127.0.0.1:9222`), streaming de capturas del
  viewport, interacción por selectores (clic, escribir) y visor de consola
  CDP en tiempo real.
- **Orquestación de worktrees**: crear y gestionar git worktrees aislados por
  rama, cambiar de proyecto activo al vuelo.
- **Paleta de comandos (`⌘K`)**: navegación por teclado rápida entre paneles,
  sesiones y temas (Oscuro, Claro, Sistema).

## Inicio rápido

### 1. Requisitos y configuración

```bash
npm install
npm run setup:core   # Descarga el binario de OpenCode fijado en src-tauri/bin
```

### 2. Ejecutar la app de escritorio

```bash
npm run dev          # App de escritorio Tauri + supervisión automática del núcleo
```

O vista web:
```bash
npm run web          # Solo Vite — http://localhost:1420
```

### 3. Compilar instaladores (Windows / macOS / Linux)

```bash
npm run dist         # Descarga el núcleo fijado y compila los instaladores
```

Los artefactos quedan en `src-tauri/target/release/bundle/`:

| SO | Archivos |
|---|---|
| Windows | `.msi`, `.exe` NSIS |
| macOS | `.app`, `.dmg` (por arquitectura con `--target aarch64-apple-darwin` / `x86_64-apple-darwin`) |
| Linux | `.deb`, `.rpm`, `.AppImage` |

El núcleo OpenCode fijado viaja **dentro** de cada instalador
(`bundle.externalBin`): el usuario final instala un archivo y jamás toca un
terminal.

Iteración rápida sin empaquetado de release: `npm run dist:debug`.

### 4. Publicar a los usuarios (un comando para los tres SO)

Los instaladores de cada SO los construye el CI al empujar una etiqueta de
versión:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

GitHub Actions (`.github/workflows/release.yml`) compila `.msi`/`.exe` de
Windows, `.dmg` de macOS (Apple Silicon + Intel) y `.deb`/`.rpm`/`.AppImage`
de Linux, y los adjunta todos al GitHub Release. Es lo más cercano a
`npm install -g` para una app de escritorio: el usuario hace un clic en la
página de Releases.

> Nota: `npm install -g` es para herramientas CLI. BuzzAgent es una app GUI
> de escritorio: se distribuye con instaladores; no hay vía de instalación
> global.

### 5. Verificación y pruebas

```bash
npm run typecheck    # Verificación estricta de TypeScript
npm run lint         # ESLint 9
npm test             # Suite de tests unitarios Vitest (markdown, diff, client, store, UI)
cd src-tauri && cargo test   # Supervisor Rust, git, tests de navegador
npm run test:integration     # Extremo a extremo contra OpenCode real + proveedor mock
```

## Licencia

[MIT](./LICENSE) © Colaboradores de BuzzAgent.

OpenCode también es MIT
([anomalyco/opencode](https://github.com/anomalyco/opencode)). El binario
sidecar es una dependencia, no un fork.
