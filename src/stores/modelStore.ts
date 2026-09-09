import { create } from "zustand";
import { persist } from "zustand/middleware";

export type EffortLevel = "low" | "medium" | "high" | "max";
export type GlobalMode = "Fast" | "Balanced" | "Deep" | "Research";

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  contextLength?: number;
  maxTokens?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: "openai" | "anthropic" | "deepseek" | "google" | "ollama" | "openrouter" | "custom";
  apiKey: string;
  baseUrl?: string;
  models: ModelConfig[];
  enabled: boolean;
}

export type Role = "default" | "smol" | "slow" | "plan" | "debug" | "review" | "subagents";

export interface RoleConfig {
  modelId: string;
  effort: EffortLevel;
  tokenBudget?: number;
}

export interface EffortSettings {
  mode: GlobalMode;
  roles: Record<Role, RoleConfig>;
}

interface ModelStore {
  providers: ProviderConfig[];
  selectedModel: ModelConfig | null;
  effortSettings: EffortSettings;
  usage: UsageStats;

  addProvider: (provider: Omit<ProviderConfig, "id">) => void;
  updateProvider: (id: string, data: Partial<ProviderConfig>) => void;
  removeProvider: (id: string) => void;
  selectModel: (model: ModelConfig) => void;
  setEffort: (key: string, value: unknown) => void;
  setRoleEffort: (role: Role, effort: EffortLevel) => void;
  setRoleModel: (role: Role, modelId: string) => void;
  setRoleTokenBudget: (role: Role, budget: number) => void;
  recordUsage: (tokens: number, cost: number) => void;
}

const DEFAULT_ROLES: Role[] = ["default", "smol", "slow", "plan", "debug", "review", "subagents"];

const DEFAULT_EFFORT: EffortSettings = {
  mode: "Balanced",
  roles: Object.fromEntries(
    DEFAULT_ROLES.map((role) => [
      role,
      { modelId: "", effort: "medium" as EffortLevel, tokenBudget: 8192 },
    ])
  ) as Record<Role, RoleConfig>,
};

export interface UsageStats {
  totalTokens: number;
  totalCost: number;
  sessionTokens: number;
  sessionCost: number;
}

export const useModelStore = create<ModelStore>()(
  persist(
    (set) => ({
      providers: [],
      selectedModel: null,
      effortSettings: DEFAULT_EFFORT,
      usage: { totalTokens: 0, totalCost: 0, sessionTokens: 0, sessionCost: 0 },

      addProvider: (provider) =>
        set((state) => ({
          providers: [...state.providers, { ...provider, id: crypto.randomUUID() }],
        })),

      updateProvider: (id, data) =>
        set((state) => ({
          providers: state.providers.map((p) => (p.id === id ? { ...p, ...data } : p)),
        })),

      removeProvider: (id) =>
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
        })),

      selectModel: (model) => set({ selectedModel: model }),

      setEffort: (key, value) =>
        set((state) => {
          if (key === "mode") {
            return {
              effortSettings: { ...state.effortSettings, mode: value as GlobalMode },
            };
          }
          return state;
        }),

      setRoleEffort: (role, effort) =>
        set((state) => ({
          effortSettings: {
            ...state.effortSettings,
            roles: {
              ...state.effortSettings.roles,
              [role]: { ...state.effortSettings.roles[role], effort },
            },
          },
        })),

      setRoleModel: (role, modelId) =>
        set((state) => ({
          effortSettings: {
            ...state.effortSettings,
            roles: {
              ...state.effortSettings.roles,
              [role]: { ...state.effortSettings.roles[role], modelId },
            },
          },
        })),

      setRoleTokenBudget: (role, budget) =>
        set((state) => ({
          effortSettings: {
            ...state.effortSettings,
            roles: {
              ...state.effortSettings.roles,
              [role]: { ...state.effortSettings.roles[role], tokenBudget: budget },
            },
          },
        })),

      recordUsage: (tokens, cost) =>
        set((state) => ({
          usage: {
            totalTokens: state.usage.totalTokens + tokens,
            totalCost: state.usage.totalCost + cost,
            sessionTokens: state.usage.sessionTokens + tokens,
            sessionCost: state.usage.sessionCost + cost,
          },
        })),
    }),
    { name: "buzzagent-model-store" }
  )
);
