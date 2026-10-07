/**
 * Syntax highlighting via Shiki.
 *
 * Highlighting is the most expensive thing the chat does, so:
 *   * the highlighter is created once and shared;
 *   * languages load on demand, not all upfront;
 *   * results are cached by (code, language, theme) — streaming re-renders the
 *     same block many times, and re-highlighting each token would drop frames;
 *   * callers get a synchronous cache hit or plain text, then an update. No
 *     spinner, no layout shift.
 */

import type { HighlighterCore, LanguageInput } from "shiki/core";

const THEMES = { dark: "github-dark-default", light: "github-light-default" } as const;
export type CodeTheme = keyof typeof THEMES;

/** Languages bundled because agent output hits them constantly. */
const BASE_LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "rust",
  "python",
  "html",
  "css",
  "markdown",
  "diff",
  "yaml",
  "sql",
  "go",
  "toml",
];

/** Aliases the model tends to emit that Shiki does not know verbatim. */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  "": "text",
  txt: "text",
  plain: "text",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>(BASE_LANGS);
const cache = new Map<string, string>();
const MAX_CACHE = 500;

/** Very large blocks are left unhighlighted: correctness over a stalled UI. */
const MAX_HIGHLIGHT_BYTES = 100_000;

export function normaliseLanguage(language: string): string {
  const lower = (language || "").toLowerCase();
  return ALIASES[lower] ?? lower;
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    // Import the fine-grained core and hand it an explicit list of grammars.
    // The `shiki` barrel export pulls in every language it knows (~26 MB and
    // 300+ chunks), which is unacceptable for a desktop bundle.
    highlighterPromise = (async () => {
      const { createHighlighterCore } = await import("shiki/core");
      const themes = [
        import("@shikijs/themes/github-dark-default"),
        import("@shikijs/themes/github-light-default"),
      ];
      const langs = BASE_LANGS.map((lang) => LANG_LOADERS[lang]).filter(Boolean);
      // Oniguruma is the reference engine but needs WebAssembly: a CSP
      // without 'wasm-unsafe-eval' (or a WASM-less platform) makes it fail
      // silently — the editor then renders unhighlighted text forever. The
      // pure-JS engine is the fallback so colors survive everywhere.
      try {
        const { createOnigurumaEngine } = await import("shiki/engine/oniguruma");
        return await createHighlighterCore({
          themes,
          langs,
          engine: createOnigurumaEngine(import("shiki/wasm")),
        });
      } catch {
        const { createJavaScriptRegexEngine } = await import("shiki/engine/javascript");
        return await createHighlighterCore({
          themes,
          langs,
          engine: createJavaScriptRegexEngine({ forgiving: true }),
        });
      }
    })();
  }
  return highlighterPromise;
}

/**
 * Explicit grammar loaders. Adding a language here is deliberate: each one
 * costs bundle size, so the list covers what agents actually emit.
 */
const LANG_LOADERS: Record<string, LanguageInput> = {
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  tsx: () => import("@shikijs/langs/tsx"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  bash: () => import("@shikijs/langs/bash"),
  rust: () => import("@shikijs/langs/rust"),
  python: () => import("@shikijs/langs/python"),
  html: () => import("@shikijs/langs/html"),
  css: () => import("@shikijs/langs/css"),
  markdown: () => import("@shikijs/langs/markdown"),
  diff: () => import("@shikijs/langs/diff"),
  yaml: () => import("@shikijs/langs/yaml"),
  sql: () => import("@shikijs/langs/sql"),
  go: () => import("@shikijs/langs/go"),
  toml: () => import("@shikijs/langs/toml"),
  php: () => import("@shikijs/langs/php"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  java: () => import("@shikijs/langs/java"),
  xml: () => import("@shikijs/langs/xml"),
  ini: () => import("@shikijs/langs/ini"),
  scss: () => import("@shikijs/langs/scss"),
  less: () => import("@shikijs/langs/less"),
  vue: () => import("@shikijs/langs/vue"),
  ruby: () => import("@shikijs/langs/ruby"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  dart: () => import("@shikijs/langs/dart"),
  lua: () => import("@shikijs/langs/lua"),
  perl: () => import("@shikijs/langs/perl"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  graphql: () => import("@shikijs/langs/graphql"),
  powershell: () => import("@shikijs/langs/powershell"),
  bat: () => import("@shikijs/langs/bat"),
  cmake: () => import("@shikijs/langs/cmake"),
  nginx: () => import("@shikijs/langs/nginx"),
};

function key(code: string, language: string, theme: CodeTheme): string {
  return `${theme}\u0000${language}\u0000${code}`;
}

export function getCached(code: string, language: string, theme: CodeTheme): string | null {
  return cache.get(key(code, normaliseLanguage(language), theme)) ?? null;
}

// ---------------------------------------------------------------- editor use

/** A colored token plus its offset in the source: what the editor overlay draws. */
export interface EditorToken {
  text: string;
  /** Absolute offset from the start of the document (0-indexed). */
  offset: number;
  color?: string;
  fontStyle?: number;
}

export interface EditorHighlight {
  tokens: EditorToken[];
  /** Language Shiki actually used ("text" when the language is unknown). */
  language: string;
}

const editorCache = new Map<string, EditorHighlight | null>();
const EDITOR_CACHE_MAX = 60;

function fontStyleNumber(style: unknown): number | undefined {
  // Shiki's FontStyle enum: 1=italic 2=bold 4=underline 8=strikethrough.
  return typeof style === "number" ? style : undefined;
}

/**
 * Token-level highlighting for the editor overlay. Synchronous from cache,
 * async otherwise; null means "plain text" (unknown language, oversized file,
 * load failure) — callers must render unstyled text in that case.
 */
export async function highlightEditorTokens(
  content: string,
  language: string,
  theme: CodeTheme
): Promise<EditorHighlight | null> {
  const lang = normaliseLanguage(language);
  const cacheKey = `editor\u0000${theme}\u0000${lang}\u0000${content}`;
  if (editorCache.has(cacheKey)) {
    return editorCache.get(cacheKey)!;
  }
  if (content.length > MAX_HIGHLIGHT_BYTES) return null;

  try {
    const highlighter = await getHighlighter();
    let effective = lang;
    if (lang !== "text" && !highlighter.getLoadedLanguages().includes(lang)) {
      const loader = LANG_LOADERS[lang];
      if (!loader) return null;
      if (!loaded.has(lang)) {
        try {
          await highlighter.loadLanguage(loader);
          loaded.add(lang);
        } catch {
          return null;
        }
      } else {
        effective = "text";
      }
    }
    const result = highlighter.codeToTokens(content, {
      lang: effective,
      theme: THEMES[theme],
    });

    // Rebuild the document exactly: Shiki's tokens per line joined with "\n"
    // reproduce the source byte-for-byte (verified against the binary), so a
    // newline separator belongs BETWEEN lines — a document ending in "\n"
    // comes back as a final empty line, which keeps offsets aligned for the
    // overlay in both cases (with and without the trailing newline).
    const tokens: EditorToken[] = [];
    let offset = 0;
    result.tokens.forEach((line, lineIndex) => {
      for (const token of line) {
        tokens.push({
          text: token.content,
          offset,
          color: token.color,
          fontStyle: fontStyleNumber(token.fontStyle),
        });
        offset += token.content.length;
      }
      if (lineIndex < result.tokens.length - 1) {
        tokens.push({ text: "\n", offset });
        offset += 1;
      }
    });
    const highlight: EditorHighlight = { tokens, language: effective };

    if (editorCache.size >= EDITOR_CACHE_MAX) {
      const oldest = editorCache.keys().next().value;
      if (oldest !== undefined) editorCache.delete(oldest);
    }
    editorCache.set(cacheKey, highlight);
    return highlight;
  } catch {
    return null;
  }
}

/**
 * Highlight to HTML. Returns null when highlighting is not possible (unknown
 * language, oversized input, load failure) so the caller renders plain text.
 */
export async function highlight(
  code: string,
  language: string,
  theme: CodeTheme
): Promise<string | null> {
  const lang = normaliseLanguage(language);
  const cacheKey = key(code, lang, theme);
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  if (code.length > MAX_HIGHLIGHT_BYTES) return null;

  try {
    const highlighter = await getHighlighter();

    // Only grammars we bundle can be highlighted; anything else renders as
    // plain text, which is a better outcome than a failed dynamic import.
    let effective = lang;
    if (lang !== "text" && !highlighter.getLoadedLanguages().includes(lang)) {
      const loader = LANG_LOADERS[lang];
      if (!loader) return null;
      if (!loaded.has(lang)) {
        try {
          await highlighter.loadLanguage(loader);
          loaded.add(lang);
        } catch {
          return null;
        }
      } else {
        effective = "text";
      }
    }

    const html = highlighter.codeToHtml(code, {
      lang: effective,
      theme: THEMES[theme],
    });

    if (cache.size >= MAX_CACHE) {
      // Cheap FIFO eviction; the working set during a session is small.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, html);
    return html;
  } catch {
    return null;
  }
}
