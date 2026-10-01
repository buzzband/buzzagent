# Milestone 0 — Telemetry audit

Gate for the “zero telemetry” claim. Verified empirically, not from docs.

- **Core audited:** `opencode` v1.18.30, `opencode-linux-x64.tar.gz`
  (185 MB ELF binary from the pinned GitHub release).
- **Date:** 2026-09-10
- **Method:** string extraction from the shipped binary, live socket
  inspection of a running `opencode serve`, state-directory inspection, and
  config-override tests.

## 1. No third-party telemetry vendors

Searched the binary for known analytics/crash vendors:

```
sentry.io · ingest.sentry · posthog · segment.io · mixpanel
datadog · bugsnag · google-analytics · googletagmanager
statsig · launchdarkly
```

**Result: no matches.** (An `amplitude` substring hit exists but resolves to
audio functions — `ma_waveform_set_amplitude` — in a bundled miniaudio-style
library, not the analytics vendor.)

Note: `@sentry/solid` *is* present in the OpenCode monorepo, but only in
`packages/desktop` / `packages/app` — their Electron GUI — and it only
initialises when `VITE_SENTRY_DSN` is set at build time. It is **not** in the
server binary we ship as a sidecar. This is the concrete difference our
product claims.

## 2. Actual network behaviour of `opencode serve`

Live socket check of the server process with no prompt ever sent:

```
LISTEN  127.0.0.1:4599                          (the API — loopback only)
ESTAB   192.168.122.108:53910 -> 104.20.32.17:443
```

The single outbound connection resolves to `models.opencode.ai` /
`api.opencode.ai`. It downloads the **model catalogue**
(`~/.cache/opencode/models.json`, ~4.5 MB) — provider/model metadata, not
usage data. No session, prompt, or code content is involved.

This is a *capability catalogue fetch*, not telemetry. It is still an
outbound call at startup and must be disclosed. Mitigation options for later:
ship a bundled catalogue snapshot and/or an explicit offline mode.

No other non-loopback socket was observed.

## 3. Optional outbound channels — and how they are forced off

| Channel | Default | Our forced setting |
|---|---|---|
| `/share` (conversation upload to `opncd.ai`) | `manual` | `"share": "disabled"` |
| Auto-update / upgrade check | on | `"autoupdate": false` |
| `small_model` (titles etc., may hit Zen) | Zen-hosted | pinned to a user-configured/local model |
| OpenCode Zen / Go gateway | see below | never selected implicitly |

**Zen is “connected” out of the box.** `GET /provider` reports
`connected: ["opencode"]` and `GET /config/providers` returns
`default: {"opencode": "big-pickle"}` — the Zen provider is available with
free-tier models before the user adds any key. Left alone, a first prompt
could go to `api.opencode.ai`. Our UI must therefore **never** fall back to
an implicit default model: the user picks a provider explicitly, and the
forced config pins `small_model` away from Zen.

## 4. `PATCH /config` does not persist

Confirmed: `PATCH /config` with `{"share":"disabled"}` echoes the value back,
but a subsequent `GET /config` reports `share: null` and the on-disk config
is unchanged.

**Consequence for the supervisor:** hardening must be written to the config
file the core reads at startup (or passed at spawn), not applied over HTTP
after boot. Verified working — with `opencode.jsonc` in the config dir, a
restarted server reports:

```
share: disabled · autoupdate: False · small_model: ollama/qwen2.5-coder
```

## 5. Auth is enforced

With `OPENCODE_SERVER_PASSWORD` set:

```
GET /global/health                  -> 401
GET /global/health (wrong password) -> 401
GET /global/health (correct)        -> {"healthy":true,"version":"1.18.30"}
```

The server binds `127.0.0.1` only. Without a password it would be open to any
local process, so the supervisor always sets one.

## 6. Data isolation

`XDG_STATE_HOME` alone is **not** enough — it redirects config/locks, but the
database, logs and model cache still land in `~/.local/share/opencode` and
`~/.cache/opencode`. Full isolation needs all four:

```
XDG_CONFIG_HOME  XDG_STATE_HOME  XDG_DATA_HOME  XDG_CACHE_HOME
```

With all four set, every artefact stays inside our app directory. This is a
deliberate product decision: BuzzAgent does not silently read or write the
user's personal `opencode` CLI state (sessions, credentials) unless they opt
in.

## Verdict

**Gate passed.** No third-party telemetry in the server binary; no analytics
endpoints; the only startup egress is a model-catalogue fetch; every optional
channel (share, autoupdate, Zen `small_model`) is disabled by a forced config
file that we verified takes effect.

Honest residual disclosures for user-facing copy:

1. The core fetches a model catalogue from `models.opencode.ai` at startup.
2. Zen is reachable by default; we prevent implicit use, but it exists.
3. Prompts go to whichever provider the user configures — by design.

“No analytics, no tracking, no crash reporting” is accurate. “Never talks to
anything but your provider” would **not** be, until the catalogue fetch is
bundled or made opt-in.
