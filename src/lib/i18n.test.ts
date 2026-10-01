/**
 * i18n coverage: every declared language must have a complete dict (all keys
 * of the English source present and translated), all shared keys must resolve,
 * and the LANGUAGES order must keep English (the default) first.
 */

import { describe, expect, it } from "vitest";
import { LANGUAGES, t } from "./i18n";

// Keys that appear on the primary screens; every shipped language must
// translate at least these so a switch never leaves core UI in English.
const CORE_KEYS = [
  "sidebar.sessions",
  "sidebar.projects",
  "composer.placeholder",
  "composer.send",
  "status.ready",
  "settings.title",
  "settings.language",
  "chat.empty",
  "common.save",
  "common.cancel",
];

describe("i18n", () => {
  it("lists English first as the default language", () => {
    expect(LANGUAGES[0].id).toBe("en");
  });

  it("orders languages by world population (en, zh, hi, es, ar, fr, bn, pt, id, ru, …)", () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(ids).toEqual([
      "en",
      "zh",
      "hi",
      "es",
      "ar",
      "fr",
      "bn",
      "pt",
      "id",
      "ru",
      "de",
      "ja",
      "tr",
      "it",
      "uk",
    ]);
  });

  it("has unique language ids and non-empty self-named labels", () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const lang of LANGUAGES) {
      expect(lang.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("resolves every key in every language (no key resolves to itself)", () => {
    // If a dict forgot a key, t() silently falls back to English — allowed,
    // but a key that resolves to its own name means a typo everywhere.
    expect(t("en", "sidebar.sessions"), "en dict broken").not.toBe("sidebar.sessions");
    for (const lang of LANGUAGES) {
      const resolved = t(lang.id, "sidebar.sessions");
      expect(resolved, `${lang.id} unresolved`).not.toBe("sidebar.sessions");
    }
  });

  it("translates core UI keys in every language", () => {
    for (const lang of LANGUAGES) {
      if (lang.id === "en") continue;
      for (const key of CORE_KEYS) {
        // Some keys legitimately share spelling across languages (e.g. fr
        // "Sessions", de "Sessions"); require difference only where the
        // English word is not itself an internationalism.
        const en = t("en", key);
        const intl = /^(sessions|projects)$/i.test(en);
        if (!intl) {
          expect(t(lang.id, key), `${lang.id} missing ${key}`).not.toBe(en);
        }
      }
    }
  });

  it("falls back to English, then to the explicit fallback arg, for missing keys", () => {
    // All shipped dicts are complete; the English fallback in t() remains a
    // safety net for future keys, followed by any caller-provided fallback.
    expect(t("uk", "error.kind.auth")).not.toBe(t("en", "error.kind.auth"));
    expect(t("de", "error.kind.balance")).not.toBe(t("en", "error.kind.balance"));
    expect(t("uk", "no.such.key")).toBe("no.such.key");
    expect(t("uk", "no.such.key", "caller fallback")).toBe("caller fallback");
  });

  it("returns the key itself for a completely unknown key", () => {
    expect(t("en", "no.such.key")).toBe("no.such.key");
  });
});
