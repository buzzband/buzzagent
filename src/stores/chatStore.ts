import { create } from "zustand";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

export interface Attachment {
  type: "file" | "image" | "screenshot";
  name: string;
  data?: string;
  path?: string;
}

export interface PendingDiff {
  file: string;
  diff: string;
  accepted?: boolean;
}

interface ChatStore {
  messages: ChatMessage[];
  input: string;
  isStreaming: boolean;
  pendingDiffs: PendingDiff[];

  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => string;
  updateMessage: (id: string, content: string, append?: boolean) => void;
  setInput: (input: string) => void;
  clearMessages: () => void;
  addPendingDiff: (diff: PendingDiff) => void;
  acceptDiff: (file: string) => void;
  rejectDiff: (file: string) => void;
  setStreaming: (streaming: boolean) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  input: "",
  isStreaming: false,
  pendingDiffs: [],

  addMessage: (msg) => {
    const id = crypto.randomUUID();
    const message: ChatMessage = { ...msg, id, timestamp: Date.now() };
    set((state) => ({
      messages: [...state.messages, message],
    }));
    return id;
  },

  updateMessage: (id, content, append = false) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id
          ? { ...m, content: append ? m.content + content : content }
          : m
      ),
    })),

  setInput: (input) => set({ input }),

  clearMessages: () => set({ messages: [], pendingDiffs: [] }),

  addPendingDiff: (diff) =>
    set((state) => ({
      pendingDiffs: [...state.pendingDiffs, diff],
    })),

  acceptDiff: (file) =>
    set((state) => ({
      pendingDiffs: state.pendingDiffs.map((d) =>
        d.file === file ? { ...d, accepted: true } : d
      ),
    })),

  rejectDiff: (file) =>
    set((state) => ({
      pendingDiffs: state.pendingDiffs.filter((d) => d.file !== file),
    })),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
}));
