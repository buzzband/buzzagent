import { AgentConfig, AgentEvent } from "../types";
import * as ipc from "./ipc";

/**
 * Agent service — thin wrapper over the backend commands and the
 * `agent-event` event stream. The event listener is registered exactly once
 * per process and dispatched to the latest subscriber.
 */

let currentCallback: ((event: AgentEvent) => void) | null = null;
let listenerRegistered = false;

async function ensureListener(): Promise<void> {
  if (listenerRegistered) return;
  listenerRegistered = true;
  try {
    await ipc.listenEvent<AgentEvent>("agent-event", (event) => {
      if (currentCallback) currentCallback(event);
    });
  } catch (err) {
    listenerRegistered = false;
    console.warn("agent-event listener unavailable:", err);
  }
}

export function setCurrentCallback(callback: ((event: AgentEvent) => void) | null) {
  currentCallback = callback;
}

export function clearCurrentCallback() {
  currentCallback = null;
}

export async function startAgent(
  config: AgentConfig,
  task: string,
  onEvent: (event: AgentEvent) => void
): Promise<void> {
  setCurrentCallback(onEvent);
  await ensureListener();
  await ipc.invoke("start_agent", { config, task });
}

export async function sendMessage(content: string): Promise<void> {
  await ensureListener();
  await ipc.invoke("send_message", { message: content });
}

export async function stopAgent(): Promise<void> {
  await ipc.invoke("stop_agent");
}

export async function acceptDiff(filePath: string, hunkIndex?: number): Promise<void> {
  await ipc.invoke("accept_diff", { file_path: filePath, hunk_index: hunkIndex ?? null });
}

export async function rejectDiff(filePath: string): Promise<void> {
  await ipc.invoke("reject_diff", { file_path: filePath });
}
