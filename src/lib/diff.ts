/**
 * Unified-diff parsing for the diff view.
 *
 * The core's diff endpoints came back empty in testing, so patches arrive from
 * `git` via the Rust side. This turns a unified diff into rows the UI can paint
 * — including *word-level* marks inside a changed line, which is the difference
 * between a diff you can read and a wall of red and green.
 */

export type RowKind = "add" | "del" | "context" | "hunk" | "meta";

export interface DiffSegment {
  text: string;
  /** True for the part of the line that actually changed. */
  changed: boolean;
}

export interface DiffRow {
  kind: RowKind;
  /** Line number in the original file. */
  oldNumber: number | null;
  /** Line number in the new file. */
  newNumber: number | null;
  text: string;
  segments?: DiffSegment[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = patch.split("\n");

  // A patch ends with a newline, so `split` leaves a trailing empty element.
  // Without dropping it we would invent a blank line at the end of every file.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunk = line.match(HUNK);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      inHunk = true;
      rows.push({ kind: "hunk", oldNumber: null, newNumber: null, text: line });
      continue;
    }

    if (!inHunk) {
      // diff --git, index, ---, +++ and similar headers.
      if (line.trim()) {
        rows.push({ kind: "meta", oldNumber: null, newNumber: null, text: line });
      }
      continue;
    }

    if (line.startsWith("+")) {
      rows.push({
        kind: "add",
        oldNumber: null,
        newNumber: newLine++,
        text: line.slice(1),
      });
      continue;
    }

    if (line.startsWith("-")) {
      rows.push({
        kind: "del",
        oldNumber: oldLine++,
        newNumber: null,
        text: line.slice(1),
      });
      continue;
    }

    if (line.startsWith("\\")) {
      // "\ No newline at end of file" — not a content line.
      continue;
    }

    // A context line; an empty string is a legitimate blank line.
    rows.push({
      kind: "context",
      oldNumber: oldLine++,
      newNumber: newLine++,
      text: line.startsWith(" ") ? line.slice(1) : line,
    });
  }

  return withWordDiff(rows);
}

/**
 * Add word-level segments to del/add pairs that are similar enough to be an
 * edit rather than a wholesale replacement. Runs over balanced blocks only, so
 * a 40-line deletion followed by a 40-line insertion is not falsely paired.
 */
function withWordDiff(rows: DiffRow[]): DiffRow[] {
  let index = 0;
  while (index < rows.length) {
    if (rows[index].kind !== "del") {
      index += 1;
      continue;
    }

    const dels: number[] = [];
    while (index < rows.length && rows[index].kind === "del") dels.push(index++);

    const adds: number[] = [];
    while (index < rows.length && rows[index].kind === "add") adds.push(index++);

    if (dels.length === adds.length) {
      for (let i = 0; i < dels.length; i += 1) {
        const before = rows[dels[i]];
        const after = rows[adds[i]];
        const pair = diffWords(before.text, after.text);
        if (pair) {
          before.segments = pair.before;
          after.segments = pair.after;
        }
      }
    }
  }
  return rows;
}

/** Similarity floor below which a word diff is noise rather than signal. */
const MIN_SIMILARITY = 0.35;

function diffWords(
  before: string,
  after: string
): { before: DiffSegment[]; after: DiffSegment[] } | null {
  if (!before || !after || before === after) return null;

  const a = tokenize(before);
  const b = tokenize(after);

  // Trim the common head and tail: edits are usually in the middle.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const common = head + tail;
  const similarity = common / Math.max(a.length, b.length);
  if (similarity < MIN_SIMILARITY) return null;

  const build = (tokens: string[]): DiffSegment[] => {
    const segments: DiffSegment[] = [];
    const push = (text: string, changed: boolean) => {
      if (!text) return;
      const last = segments[segments.length - 1];
      if (last && last.changed === changed) last.text += text;
      else segments.push({ text, changed });
    };
    push(tokens.slice(0, head).join(""), false);
    push(tokens.slice(head, tokens.length - tail).join(""), true);
    push(tokens.slice(tokens.length - tail).join(""), false);
    return segments;
  };

  return { before: build(a), after: build(b) };
}

/** Split into words and separators so whitespace is preserved exactly. */
function tokenize(text: string): string[] {
  return text.match(/(\w+|\s+|[^\w\s])/g) ?? [];
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function statsFor(rows: DiffRow[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === "add") added += 1;
    else if (row.kind === "del") removed += 1;
  }
  return { added, removed };
}
