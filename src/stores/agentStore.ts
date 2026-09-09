import { create } from "zustand";
import { AgentConfig, AgentEvent } from "../types";
import * as agentService from "../services/agent";
import * as ipc from "./../services/ipc";

export type EffortLevel = "low" | "medium" | "high" | "max";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface DiffEntry {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  hunks: Hunk[];
  status: "pending" | "accepted" | "rejected";
}

export interface Hunk {
  index: number;
  content: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "error";
  result?: string;
}

export interface ProviderStatus {
  connected: boolean;
  latency: number;
  model: string;
}

interface AgentStore {
  agent: AgentConfig | null;
  projectPath: string | null;
  messages: Message[];
  toolCalls: ToolCall[];
  diffs: DiffEntry[];
  isRunning: boolean;
  effort: EffortLevel;
  provider: ProviderStatus | null;
  lastError: string | null;

  setAgent: (config: Partial<AgentConfig>) => void;
  setProjectPath: (path: string) => void;
  setEffort: (effort: EffortLevel) => void;
  startAgent: (task: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  acceptDiff: (filePath: string, hunkIndex?: number) => Promise<void>;
  rejectDiff: (filePath: string) => Promise<void>;
  registerToolCall: (call: ToolCall) => void;
  registerToolResult: (result: { id: string; output: string; error?: string }) => void;
  addMessage: (msg: Message) => void;
  stopAgent: () => Promise<void>;
  clearSession: () => void;
}

const DEFAULT_PROJECT = ".";

export const useAgentStore = create<AgentStore>((set, get) => ({
  agent: null,
  projectPath: null,
  messages: [],
  toolCalls: [],
  diffs: [],
  isRunning: false,
  effort: "medium",
  provider: null,
  lastError: null,

  setAgent: (partial) =>
    set((state) => ({
      agent: state.agent
        ? { ...state.agent, ...partial }
        : ({
            provider: "",
            model: "",
            apiKey: "",
            projectPath: state.projectPath ?? DEFAULT_PROJECT,
            effort: state.effort,
            ...partial,
          } as AgentConfig),
    })),

  setProjectPath: (path) =>
    set((state) => ({
      projectPath: path,
      agent: state.agent ? { ...state.agent, projectPath: path } : state.agent,
    })),

  setEffort: (effort) =>
    set((state) => ({
      effort,
      agent: state.agent ? { ...state.agent, effort } : state.agent,
    })),

  startAgent: async (task) => {
    const { agent, effort, projectPath } = get();
    if (!agent || !agent.provider || !agent.model) {
      get().addMessage({
        role: "system",
        content:
          "No model configured. Open the Models panel, add a provider (API key) and select a model first.",
        timestamp: Date.now(),
      });
      return;
    }

    set({ isRunning: true, lastError: null });
    get().addMessage({ role: "user", content: task, timestamp: Date.now() });

    const config: AgentConfig = {
      ...agent,
      effort,
      projectPath: projectPath || agent.projectPath || DEFAULT_PROJECT,
    };

    try {
      await agentService.startAgent(config, task, (event: AgentEvent) =>
        handleAgentEvent(event, get, set)
      );
    } catch (err) {
      set({ isRunning: false });
      get().addMessage({
        role: "system",
        content: `Failed to start agent: ${String(err)}`,
        timestamp: Date.now(),
      });
    }
  },

  sendMessage: async (content) => {
    const { agent } = get();
    if (!agent) {
      // Without a configured backend session, treat a message as a new task.
      await get().startAgent(content);
      return;
    }

    get().addMessage({ role: "user", content, timestamp: Date.now() });
    set({ isRunning: true, lastError: null });

    try {
      await agentService.sendMessage(content);
    } catch (err) {
      set({ isRunning: false });
      get().addMessage({
        role: "system",
        content: `Failed to send message: ${String(err)}`,
        timestamp: Date.now(),
      });
    }
  },

  acceptDiff: async (filePath, hunkIndex) => {
    try {
      await ipc.invoke("accept_diff", { file_path: filePath, hunk_index: hunkIndex ?? null });
    } catch (err) {
      console.warn("accept_diff failed:", err);
    }
    set((state) => ({
      diffs: state.diffs.map((d) =>
        d.filePath === filePath && !hunkIndex ? { ...d, status: "accepted" } : d
      ),
    }));
  },

  rejectDiff: async (filePath) => {
    try {
      await ipc.invoke("reject_diff", { file_path: filePath });
    } catch (err) {
      console.warn("reject_diff failed:", err);
    }
    set((state) => ({
      diffs: state.diffs.map((d) =>
        d.filePath === filePath ? { ...d, status: "rejected" } : d
      ),
    }));
  },

  registerToolCall: (call) =>
    set((state) => ({
      toolCalls: [...state.toolCalls, call],
    })),

  registerToolResult: (result) =>
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        tc.id === result.id
          ? {
              ...tc,
              status: result.error ? "error" : "completed",
              result: result.error ? `${result.output}\n${result.error}` : result.output,
            }
          : tc
      ),
    })),

  addMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),

  stopAgent: async () => {
    try {
      await ipc.invoke("stop_agent");
    } catch (err) {
      console.warn("stop_agent failed:", err);
    }
    set({ isRunning: false });
  },

  clearSession: () =>
    set({ messages: [], toolCalls: [], diffs: [], lastError: null }),
}));

type StoreSetter = (
  updater: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore>)
) => void;

function handleAgentEvent(
  event: AgentEvent,
  get: () => AgentStore,
  set: StoreSetter
) {
  const { addMessage, registerToolCall, registerToolResult } = get();

  switch (event.type) {
    case "text": {
      const chunk = event.chunk ?? "";
      if (!chunk) break;
      const messages = get().messages;
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        const updated = [...messages.slice(0, -1), { ...last, content: last.content + chunk }];
        set({ messages: updated });
      } else {
        addMessage({ role: "assistant", content: chunk, timestamp: Date.now() });
      }
      break;
    }
    case "tool_call":
      registerToolCall({
        id: event.id ?? crypto.randomUUID(),
        name: event.name ?? "unknown",
        input: event.input || {},
        status: "running",
      });
      break;
    case "tool_result":
      registerToolResult({
        id: event.id ?? "",
        output: event.output ?? "",
        error: event.error,
      });
      break;
    case "diff": {
      if (!event.diff) break;
      const incoming = event.diff;
      set((state: AgentStore) => ({
        diffs: [
          ...state.diffs.filter((d) => d.filePath !== incoming.file_path),
          {
            filePath: incoming.file_path,
            originalContent: "",
            modifiedContent: incoming.content,
            hunks: [{ index: 0, content: incoming.content }],
            status: "pending" as const,
          },
        ],
      }));
      break;
    }
    case "status":
      set({
        provider: {
          ...(get().provider || { connected: true, latency: 0, model: "" }),
          connected: true,
          model: event.message ?? "",
        },
      });
      break;
    case "error":
      set({ lastError: event.message ?? "Unknown error" });
      addMessage({
        role: "system",
        content: `Error: ${event.message ?? "Unknown error"}`,
        timestamp: Date.now(),
      });
      break;
    case "done":
      set({ isRunning: false });
      break;
  }
}
