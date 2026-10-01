/**
 * Session usage aggregation for the status-bar chip (the GUI answer to
 * `/context` + `/cost` in Claude Code): totals over message tokens, plus
 * formatting helpers. Pure functions so they are unit-testable in isolation.
 */

export interface TokenRecord {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface UsageMessage {
  info?: {
    id?: string;
    role?: string;
    tokens?: TokenRecord;
    cost?: number;
  };
}

export interface UsageTotals {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/** Sum tokens and cost over a session's messages. Tolerates missing fields. */
export function sessionUsage(messages: UsageMessage[]): UsageTotals {
  let input = 0,
    output = 0,
    reasoning = 0,
    cacheRead = 0,
    cacheWrite = 0,
    cost = 0;
  for (const m of messages) {
    const tk = m.info?.tokens;
    if (tk) {
      input += tk.input || 0;
      output += tk.output || 0;
      reasoning += tk.reasoning || 0;
      cacheRead += tk.cache?.read || 0;
      cacheWrite += tk.cache?.write || 0;
    }
    cost += m.info?.cost ?? 0;
  }
  return { input, output, reasoning, cacheRead, cacheWrite, cost };
}

/** Compact number formatting for the status bar: 1200 → 1.2k, 3.4M → 3.4M. */
export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * Context window fill as a percentage. Input + cache-read approximates what
 * the next request will carry; returns null when the model's limit is unknown.
 */
export function contextPercent(
  usage: UsageTotals,
  contextLimit: number | null
): number | null {
  if (!contextLimit || contextLimit <= 0) return null;
  const used = usage.input + usage.cacheRead;
  return Math.min(100, Math.round((used / contextLimit) * 100));
}
