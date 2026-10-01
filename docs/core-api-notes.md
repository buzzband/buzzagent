# Core API notes (verified against opencode 1.18.30)

Answers to the PLAN.md “open questions”, established empirically against a
live `opencode serve`. Re-verify when the pinned version changes.

## Auth

`PUT /auth/:id` **applies immediately, no restart needed.**

```
PUT /auth/openai  {"type":"api","key":"sk-..."}   -> true
GET /provider                                      -> connected: ["opencode","openai"]
```

Credentials are written by the core to `<data>/opencode/auth.json`. The key
never needs to live in our store.

## Config

`PATCH /config` **does not persist.** It echoes the patch back, but a later
`GET /config` shows the value gone and the on-disk file untouched.

Therefore all hardening lives in a config file in the core's config dir,
written by the supervisor before spawn:

```jsonc
{
  "share": "disabled",
  "autoupdate": false,
  "small_model": "<user provider>/<model>"
}
```

Verified: after restart `GET /config` reports `share: "disabled"`,
`autoupdate: false`, and the pinned `small_model`.

Use `PATCH /config` only for session-scoped, throwaway changes — never for
anything that must survive a restart.

## Data directories

`XDG_STATE_HOME` alone is not enough. The core spreads state across four
roots, and only setting all of them keeps a BuzzAgent install isolated from
the user's personal `opencode` CLI:

| Variable | Holds |
|---|---|
| `XDG_CONFIG_HOME` | `opencode.jsonc`, config |
| `XDG_STATE_HOME` | locks |
| `XDG_DATA_HOME` | `opencode.db`, `auth.json`, logs, repos |
| `XDG_CACHE_HOME` | `models.json` (~4.5 MB catalogue), binaries |

## Auth on the server

`OPENCODE_SERVER_PASSWORD` is enforced on every route, HTTP basic, username
`opencode` (override with `OPENCODE_SERVER_USERNAME`).

```
no credentials    -> 401
wrong password    -> 401
correct           -> 200
```

Without a password the server is open to any local process **and can run
shell commands**. The supervisor always sets one.

## Sessions and messages

```
POST /session                       -> {id, slug, projectID, directory, tokens, ...}
POST /session/:id/message           -> {info: AssistantMessage, parts: Part[]}
GET  /session/:id/message           -> [{info, parts}]
POST /session/:id/prompt_async      -> 204, result arrives over /event
```

`POST .../message` blocks until the turn completes, so the UI should prefer
`prompt_async` + `/event` and treat the synchronous form as a fallback.

Model selection is per message:

```json
{ "model": { "providerID": "mock", "modelID": "mock-coder" },
  "parts": [{ "type": "text", "text": "..." }] }
```

`info.tokens` and `info.cost` come back on the assistant message — that is
the only legitimate source for usage numbers.

## Part types observed

A completed turn with a tool call produces, in order:

```
step-start
tool        { tool: "write", state: { status: "completed", input: {...}, output: "..." } }
text        { text: "..." }
step-finish
```

`state.status` moves through `pending` → `running` → `completed` / `error`,
which is exactly what the tool card renders.

## Events (`GET /event`, SSE)

Envelope is `{ id, type, properties }`. First frame after connect is
`server.connected`. Observed during one full turn, in order:

```
server.connected, session.created, session.updated,
message.updated, message.part.updated, session.status {type:"busy"},
message.part.delta, message.part.updated, message.updated,
session.status {type:"idle"}, session.idle, session.diff,
session.updated, server.heartbeat
```

Three of these carry the whole streaming UX, and all three were originally
missed — which is why the UI once hung on "working" forever:

| Event | Payload | Role |
|---|---|---|
| `session.status` | `{sessionID, status:{type:"busy"\|"idle"}}` | **Authoritative** busy/idle. `session.idle` alone is not enough to trust. |
| `message.part.delta` | `{sessionID, messageID, partID, field, delta}` | The streamed tokens themselves. `field` is `text` or `reasoning`. |
| `permission.v2.asked` / `.replied` | v2 shape: `action`, `resources`, `source.{messageID,callID}` | Newer permission surface, alongside legacy `permission.asked`. |

Do not invent event names — subscribe and switch on what the pinned version
actually emits.

## Permission endpoints

Two reply surfaces exist; which one applies depends on which event delivered
the request:

```
POST /session/{sessionID}/permissions/{permissionID}     legacy
POST /permission/{requestID}/reply      {"reply":"once"|"always"|"reject"}   v2
```

Pending requests: `GET /permission`. Our client tries the legacy route first
and falls back on 404/400, so both event generations can be answered.

## Skills, agents, commands, MCP

```
GET  /skill                 -> [{ name, description, location, content }]
GET  /agent                 -> Agent[]
GET  /command               -> Command[]
GET  /mcp                   -> { [name]: MCPStatus }  (connected | disabled | failed | needs_auth | needs_client_registration)
POST /mcp                   { name, config }        register/replace on the live core
POST /mcp/{name}/connect    POST /mcp/{name}/disconnect
POST /mcp/{name}/auth/...   OAuth flows for MCP servers that need them
DELETE /auth/{providerID}   remove stored provider credentials
GET  /lsp                   detected language servers
```

MCP config (`mcp` key in `opencode.json`) supports `enabled: false` per
server — that is the real toggle, not an invention. Skills have no per-skill
disable in the schema; they are applied by invoking them (slash command), so
the UI inserts `/name` into the composer instead of pretending to toggle.

## Settings

There is **no `streaming` key in the config schema** — streaming is the
transport (`message.part.delta`), not an option. Do not add a toggle for it.

Real, user-relevant `Config` keys verified in the spec: `model`,
`small_model`, `default_agent`, `subagent_depth`, `permission` (per-action
`ask`/`allow`/`deny` for bash, edit, webfetch, websearch, read, grep, glob,
list, task, skill, lsp, external_directory…), `compaction`
(`auto`, `prune`, `tail_turns`, `reserved`), `tool_output`
(`max_lines`, `max_bytes`), `snapshot`, `shell`, `lsp`, `formatter`,
`logLevel` (`DEBUG`/`INFO`/`WARN`/`ERROR`), `username`,
`disabled_providers`, `enabled_providers`.

`PATCH /config` applies to the running instance but does not persist, so the
settings UI edits the on-disk config file and patches the live core in the
same operation.

Full settings coverage: structured editors for `model`, `small_model`,
`default_agent`, `subagent_depth`, `permission` (per action), `compaction`,
`tool_output`, `snapshot`, `shell`, `lsp`, `formatter`, `logLevel`,
`username`, `instructions`, `disabled_providers`, `enabled_providers`,
`skills.paths`/`urls`, `plugin`, `watcher.ignore`, `experimental` flags and
`enterprise.url`. Everything else — `agent`, `mode`, `command`, per-server
`lsp`/`formatter` maps, `attachment`, `references`, `server` — is reachable
through the raw-JSON tab, which replaces the whole file via
`core_replace_settings`. On every write path BuzzAgent force-re-applies
`share: "disabled"`, `autoupdate: false` and
`experimental.openTelemetry: false` (the core's only telemetry surface).

## Diffs

`GET /session/:id/diff` returned `[]` in our runs, and `GET /file/status`
also returned `[]` even with a dirty tracked file (`git status` showed
` M readme.md`).

**Unresolved.** Do not build the diff panel on the assumption that these
endpoints are populated. Options to test in M2: pass `messageID`, check
whether they only cover edits the agent itself made in that session, or fall
back to computing diffs ourselves from git. Treat this as a known gap, not a
solved problem.

## Zen is connected by default

`GET /provider` reports `connected: ["opencode"]` and
`GET /config/providers` gives `default: {"opencode": "big-pickle"}` before
the user configures anything — Zen ships free-tier models.

**The UI must never fall back to an implicit default model.** Require an
explicit provider+model choice, or a first prompt silently goes to
`api.opencode.ai`.

## Test fixture

`scripts/mock-provider.py` is an OpenAI-compatible stub that exercises the
loop with no API key: streaming text, a `write` tool call, a `bash` tool
call. Two details it had to get right, both of which hung the core when
wrong:

1. Serve threaded — the core holds keep-alive connections, and a
   single-threaded server deadlocks behind an idle socket.
2. An SSE response must either use chunked encoding or send
   `Connection: close` and actually close. Without it the client waits
   forever for the body to end.
