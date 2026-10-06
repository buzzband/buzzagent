/**
 * Error classification and reporting for agent/provider failures.
 *
 * A provider failure, an exhausted API balance, a dropped connection or a
 * refused API key are all ordinary events of this product — the goal is that
 * each of them lands on screen **in full detail, copyable**, instead of as a
 * swallowed spinner or a one-line toast. The core reports what it saw; this
 * module turns that into a human summary plus a machine-readable report.
 */

import { CoreError } from "../core/client";

/** Broad categories the UI knows how to explain and act on. */
export type ErrorKind =
  | "auth" // 401/403, invalid API key
  | "balance" // 402, quota / insufficient credits
  | "rate-limit" // 429, throttling
  | "timeout"
  | "network" // connection refused, DNS, offline, SSE drop
  | "not-found" // 404 from the core API
  | "server" // 5xx from core or provider
  | "provider"; // anything else the upstream provider said
export type ErrorSource = "provider" | "core" | "network" | "app";

export interface ClassifiedError {
  id: string;
  kind: ErrorKind;
  source: ErrorSource;
  /** Short human headline (the error name or a classified label). */
  title: string;
  /** The primary message, as reported — never paraphrased. */
  message: string;
  /** Upstream/vendor detail when available (data fields, provider payload). */
  detail?: string;
  /** HTTP status, when one was involved. */
  status?: number;
  /** Provider/model the turn was running against, when known. */
  providerID?: string;
  modelID?: string;
  /** Session the failure happened in, when known. */
  sessionID?: string;
  /** Message carrying this failure, when it also renders inline there. The
   * chat banner suppresses itself when the carrier message is on screen. */
  messageID?: string;
  /** Tool call carrying this failure (same suppression rule, per tool card). */
  callID?: string;
  /** ISO timestamp of when the UI learned about it. */
  time: string;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `err-${Date.now().toString(36)}-${seq}`;
}

function firstLine(text: string): string {
  const line = text.trim().split("\n").find((l) => l.trim());
  return (line ?? text.trim()).slice(0, 200);
}

/**
 * Pull a message out of an unknown payload without inventing one: JSON bodies,
 * provider `data` objects and nested `error` wrappers are all inspected.
 */
function extractMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (!isRecord(value)) return undefined;
  // `data` is the core's wrapper for provider failures
  // (session.error → error.data.message), so it is traversed too.
  for (const key of ["message", "error", "detail", "description", "msg", "data"]) {
    const found = value[key];
    if (typeof found === "string" && found.trim()) return found.trim();
    if (isRecord(found)) {
      const nested = extractMessage(found);
      if (nested) return nested;
    }
  }
  return undefined;
}

/** Parse a JSON error body if it is one; provider/core bodies often are. */
function parseJsonBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function extractName(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.name === "string" && value.name.trim()) {
    return value.name.trim();
  }
  return undefined;
}

function extractStatus(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["status", "statusCode", "code"]) {
    const raw = value[key];
    if (typeof raw === "number" && raw >= 100 && raw < 600) return raw;
    // Strings like "402" or "ERR_BAD_REQUEST" from axios-style payloads.
    if (typeof raw === "string") {
      const numeric = Number.parseInt(raw, 10);
      if (!Number.isNaN(numeric) && numeric >= 100 && numeric < 600) return numeric;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strProp(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Classify by inspecting the raw text — provider payloads vary far too much to
 * switch on a field, but the vocabulary of failures is stable (401, quota,
 * ECONNREFUSED, timeouts…). Order matters: specific patterns before generic.
 */
function classify(text: string, status?: number): { kind: ErrorKind; source: ErrorSource } {
  const hay = text.toLowerCase();

  const has = (...needles: string[]) => needles.some((n) => hay.includes(n));

  // Balance / quota before auth: "insufficient_quota" also mentions "api key".
  if (status === 402 || has("insufficient_quota", "insufficient funds", "billing", "exceeded your current quota", "credit balance", "payment required", "plan limit", "usage limit")) {
    return { kind: "balance", source: "provider" };
  }
  if (status === 429 || has("rate limit", "ratelimit", "too many requests", "resource_exhausted", "throttl")) {
    return { kind: "rate-limit", source: "provider" };
  }
  if (status === 401 || status === 403 || has("invalid api key", "invalid_api_key", "unauthorized", "authentication", "incorrect api key", "api key not valid", "permission denied", "forbidden")) {
    return { kind: "auth", source: "provider" };
  }
  if (status === 404 || has("not found", "no such model", "model_not_found", "does not exist")) {
    return { kind: "not-found", source: status !== undefined ? "core" : "provider" };
  }
  if (has("timed out", "request timeout", "etimedout", "deadline exceeded", "socket timeout")) {
    return { kind: "timeout", source: "network" };
  }
  if (
    has(
      "cannot reach",
      "econnrefused",
      "econnreset",
      "enotfound",
      "ehostunreach",
      "enetunreach",
      "connection refused",
      "connection reset",
      "network",
      "socket hang up",
      "fetch failed",
      // WebKit/Chromium wording for a fetch that never reached the server
      // (core still booting, network flap): "TypeError: Load failed" /
      // "Failed to fetch". These are connection failures, not provider ones.
      "load failed",
      "failed to fetch",
      "event stream",
      "dns",
      "offline"
    )
  ) {
    return { kind: "network", source: "network" };
  }
  if (status !== undefined && status >= 500) {
    return { kind: "server", source: "core" };
  }
  if (status !== undefined && status >= 400) {
    return { kind: "provider", source: "provider" };
  }
  return { kind: "provider", source: "app" };
}

/** A short English headline per kind; i18n happens in the UI layer. */
export const KIND_LABEL: Record<ErrorKind, string> = {
  auth: "Authentication failed",
  balance: "API balance / quota exhausted",
  "rate-limit": "Rate limit reached",
  timeout: "Request timed out",
  network: "Connection lost",
  "not-found": "Not found",
  server: "Server error",
  provider: "Provider error",
};

interface ClassifyInput {
  name?: string;
  message?: string;
  detail?: unknown;
  status?: number;
  providerID?: string;
  modelID?: string;
  sessionID?: string;
  messageID?: string;
  callID?: string;
}

/** Build a ClassifiedError from raw fields (core events, exceptions, fetches). */
export function classifyError(input: ClassifyInput): ClassifiedError {
  const message = extractMessage(input.message) ?? "Unknown error";
  const detailRaw = input.detail;
  const detail =
    detailRaw === undefined || detailRaw === null
      ? undefined
      : typeof detailRaw === "string"
        ? detailRaw
        : safeJson(detailRaw);

  const combined = `${input.name ?? ""} ${message} ${detail ?? ""}`;
  const status = input.status ?? extractStatus(isRecord(detailRaw) ? detailRaw : undefined);
  const { kind, source } = classify(combined, status);

  return {
    id: nextId(),
    kind,
    source,
    title: input.name?.trim() || KIND_LABEL[kind],
    message,
    detail,
    status,
    providerID: input.providerID,
    modelID: input.modelID,
    sessionID: input.sessionID,
    messageID: input.messageID,
    callID: input.callID,
    time: new Date().toISOString(),
  };
}

function safeJson(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? undefined : text;
  } catch {
    return String(value);
  }
}

/**
 * Normalise anything thrown or emitted into a ClassifiedError.
 *
 * Sources handled:
 *  - `CoreError` (our own HTTP client): status + raw body preserved.
 *  - The core's `session.error` / message `error` payloads (provider data lives
 *    in nested `data` fields whose shape varies by provider).
 *  - Plain `Error` objects and bare strings.
 */
export function normalizeError(
  error: unknown,
  context: {
    sessionID?: string;
    providerID?: string;
    modelID?: string;
    messageID?: string;
    callID?: string;
  } = {}
): ClassifiedError {
  if (error instanceof CoreError) {
    const parsed = error.body ? parseJsonBody(error.body) : undefined;
    const bodyMessage = error.body
      ? extractMessage(parsed ?? error.body) ?? error.body
      : undefined;
    return classifyError({
      name: firstLine(bodyMessage ?? error.message),
      message: bodyMessage ?? error.message,
      detail: error.body ?? undefined,
      status: error.status,
      sessionID: context.sessionID,
      providerID: context.providerID,
      modelID: context.modelID,
      messageID: context.messageID,
      callID: context.callID,
    });
  }
  if (error instanceof Error) {
    return classifyError({
      name: error.name,
      message: error.message,
      detail: error.stack,
      sessionID: context.sessionID,
      providerID: context.providerID,
      modelID: context.modelID,
      messageID: context.messageID,
      callID: context.callID,
    });
  }
  if (isRecord(error)) {
    // Core event payloads nest the provider detail under `data`.
    const data = isRecord(error.data) ? error.data : undefined;
    return classifyError({
      name: extractName(error),
      message: extractMessage(error),
      detail: error,
      status: extractStatus(error) ?? (data ? extractStatus(data) : undefined),
      providerID: strProp(data?.providerID) ?? context.providerID,
      modelID: strProp(data?.modelID) ?? context.modelID,
      sessionID: strProp(error.sessionID) ?? strProp(data?.sessionID) ?? context.sessionID,
      // The inline carrier ids always come from the caller's context: the
      // raw payload does not know which message/tool card renders it.
      messageID: context.messageID,
      callID: context.callID,
    });
  }
  return classifyError({ message: String(error), sessionID: context.sessionID });
}

/**
 * Full copyable report: what, where, when, and the raw detail.
 * Markdown-ish plain text so it pastes cleanly into an issue or a chat.
 */
export function formatErrorReport(error: ClassifiedError, appVersion = "BuzzAgent"): string {
  const lines: string[] = [
    `${appVersion} — ${KIND_LABEL[error.kind]}`,
    `Time: ${error.time}`,
  ];
  if (error.status !== undefined) lines.push(`HTTP status: ${error.status}`);
  if (error.providerID) lines.push(`Provider: ${error.providerID}`);
  if (error.modelID) lines.push(`Model: ${error.modelID}`);
  if (error.sessionID) lines.push(`Session: ${error.sessionID}`);
  lines.push("", `Message:`, error.message);
  if (error.detail && error.detail !== error.message) {
    lines.push("", `Detail:`, error.detail);
  }
  return lines.join("\n");
}
