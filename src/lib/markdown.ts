/**
 * Incremental markdown rendering for streamed assistant text.
 *
 * Streaming means we are constantly handed *partial* markdown: an unterminated
 * code fence, a half-written bold run, a table with one row so far. The naive
 * approach re-parses the whole string each token and flickers, because a fence
 * that is open on one frame closes on the next.
 *
 * The approach here:
 *   1. Split into blocks, treating an unterminated fence as a *complete* code
 *      block whose content simply is not finished yet. It renders as code from
 *      the first token, so nothing flips layout when the fence eventually
 *      closes.
 *   2. Keep block identity stable (index + kind + language) so React reuses
 *      DOM nodes instead of remounting them, which is what actually causes the
 *      visible flicker.
 *
 * Deliberately a small, dependency-free subset: headings, fenced code, lists,
 * blockquotes, inline code/bold/italic/links, horizontal rules. Agent output
 * that needs more than this is rare, and a full markdown pipeline is a large
 * dependency plus a sanitisation burden.
 */

export type MarkdownBlock =
  | { kind: "paragraph"; key: string; text: string }
  | { kind: "heading"; key: string; level: number; text: string }
  | { kind: "code"; key: string; language: string; code: string; closed: boolean }
  | { kind: "list"; key: string; ordered: boolean; items: string[] }
  | { kind: "quote"; key: string; text: string }
  | { kind: "rule"; key: string };

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.split("\n");
  const blocks: MarkdownBlock[] = [];

  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({
      kind: "paragraph",
      key: `p${blocks.length}`,
      text: paragraph.join("\n"),
    });
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push({ kind: "quote", key: `q${blocks.length}`, text: quote.join("\n") });
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({
      kind: "list",
      key: `l${blocks.length}`,
      ordered: list.ordered,
      items: list.items,
    });
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(FENCE);

    if (fence) {
      flushAll();
      const marker = fence[1];
      const language = fence[2] || "text";
      const body: string[] = [];
      let closed = false;

      i += 1;
      for (; i < lines.length; i += 1) {
        const candidate = lines[i];
        // Only a fence of the same type (and at least as long) closes it.
        const closing = candidate.match(FENCE);
        if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) {
          closed = true;
          break;
        }
        body.push(candidate);
      }

      blocks.push({
        kind: "code",
        // Language is part of the key: switching language is a different
        // block and *should* remount, but growing content should not.
        key: `c${blocks.length}-${language}`,
        language,
        code: body.join("\n"),
        closed,
      });
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    if (RULE.test(line)) {
      flushAll();
      blocks.push({ kind: "rule", key: `r${blocks.length}` });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushAll();
      blocks.push({
        kind: "heading",
        key: `h${blocks.length}`,
        level: heading[1].length,
        text: heading[2],
      });
      continue;
    }

    const quoted = line.match(QUOTE);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    const unordered = line.match(UNORDERED);
    const ordered = line.match(ORDERED);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const isOrdered = Boolean(ordered);
      const item = (unordered ? unordered[1] : ordered![1]).trim();
      if (list && list.ordered === isOrdered) list.items.push(item);
      else {
        flushList();
        list = { ordered: isOrdered, items: [item] };
      }
      continue;
    }

    flushQuote();
    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

export type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "link"; value: string; href: string };

/**
 * Inline formatting. Inline code wins over emphasis, so `**` inside backticks
 * stays literal. Unterminated markers render as plain text rather than
 * swallowing the rest of the line — important while streaming.
 */
export function parseInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buffer = "";

  const pushText = () => {
    if (buffer) {
      tokens.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);

    const code = rest.match(/^`([^`]+)`/);
    if (code) {
      pushText();
      tokens.push({ kind: "code", value: code[1] });
      i += code[0].length;
      continue;
    }

    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (link) {
      pushText();
      tokens.push({ kind: "link", value: link[1], href: link[2] });
      i += link[0].length;
      continue;
    }

    const strong = rest.match(/^\*\*([^*]+)\*\*/);
    if (strong) {
      pushText();
      tokens.push({ kind: "strong", value: strong[1] });
      i += strong[0].length;
      continue;
    }

    const em = rest.match(/^(?:\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/);
    if (em) {
      pushText();
      tokens.push({ kind: "em", value: em[1] ?? em[2] });
      i += em[0].length;
      continue;
    }

    buffer += source[i];
    i += 1;
  }

  pushText();
  return tokens;
}
