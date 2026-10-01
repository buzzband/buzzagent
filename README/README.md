# BuzzAgent — documentation hub / хаб документации

From the English README you reached this folder through language links. The
main documentation lives in the repo root and is English-first:

- [README.md](../README.md) — full project overview in English
- [README.html](../README.html) — the same overview, standalone HTML page
- [PLAN.md](../PLAN.md) — architecture decisions, UI quality bar, roadmap
- [docs/telemetry-audit.md](../docs/telemetry-audit.md) — how the zero-telemetry claim is verified
- [docs/core-api-notes.md](../docs/core-api-notes.md) — verified HTTP/SSE contracts of the pinned core

## Translations / Переводы

Only English and Russian are full translations. The other files are condensed
versions (a quick-start and feature summary) pointing back here for detail.
The in-app UI itself ships with 15 built-in interface languages regardless —
see Settings → General → Language.

- [README.ru.md](./README.ru.md) — Русский (полный перевод)
- [README.zh.md](./README.zh.md) — 中文
- [README.hi.md](./README.hi.md) — हिन्दी
- [README.es.md](./README.es.md) — Español
- [README.ar.md](./README.ar.md) — العربية
- [README.fr.md](./README.fr.md) — Français
- [README.bn.md](./README.bn.md) — বাংলা
- [README.pt.md](./README.pt.md) — Português
- [README.id.md](./README.id.md) — Bahasa Indonesia
- [README.de.md](./README.de.md) — Deutsch
- [README.ja.md](./README.ja.md) — 日本語
- [README.tr.md](./README.tr.md) — Türkçe
- [README.it.md](./README.it.md) — Italiano
- [README.uk.md](./README.uk.md) — Українська

Adding a language: copy `README.en-template.md`, translate it, link it here
and in the main README. Interface translations go to
[`src/lib/i18n.ts`](../src/lib/i18n.ts).
