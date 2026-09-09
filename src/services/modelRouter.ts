import { ModelConfig, Role, EffortLevel, EffortSettings, UsageStats } from "../stores/modelStore";

export class ModelRouter {
  private settings: EffortSettings;

  constructor(settings: EffortSettings) {
    this.settings = settings;
  }

  updateSettings(settings: EffortSettings): void {
    this.settings = settings;
  }

  getModelForRole(role: Role, modelConfigs: ModelConfig[]): ModelConfig | null {
    const roleConfig = this.settings.roles[role];
    if (!roleConfig || !roleConfig.modelId) {
      const roleConfigDefault = this.settings.roles.default;
      if (roleConfigDefault && roleConfigDefault.modelId) {
        return modelConfigs.find((m) => m.id === roleConfigDefault.modelId) || null;
      }
      return modelConfigs[0] || null;
    }
    return modelConfigs.find((m) => m.id === roleConfig.modelId) || null;
  }

  getEffortForRole(role: Role): EffortLevel {
    const roleConfig = this.settings.roles[role];
    return roleConfig.effort;
  }

  estimateComplexity(task: string): number {
    const keywords = ["architecture", "refactoring", "optimization", "bug", "tests", "security", "performance"];
    const hasKeywords = keywords.some((k) => task.toLowerCase().includes(k));

    let score = 0;
    if (hasKeywords) score += 0.4;
    if (task.length > 500) score += 0.3;
    if (task.includes("file") || task.includes("project")) score += 0.2;
    if (task.includes("database") || task.includes("api")) score += 0.1;

    return Math.min(score, 1.0);
  }

  async route(task: string, complexity?: number): Promise<{ role: Role; model: ModelConfig | null }> {
    const c = complexity ?? this.estimateComplexity(task);

    if (c > 0.8) {
      return { role: "slow", model: null };
    } else if (c > 0.4) {
      return { role: "default", model: null };
    } else {
      return { role: "smol", model: null };
    }
  }

  estimateCost(settings: EffortSettings): { tokens: number; cost: number } {
    const estimatedTokens = settings.roles.default.tokenBudget || 8192;
    const estimatedCost = estimatedTokens * 0.000005;

    const totalRoles = Object.keys(settings.roles).length;
    return {
      tokens: estimatedTokens * totalRoles,
      cost: estimatedCost * totalRoles,
    };
  }

  estimateTime(settings: EffortSettings): string {
    const effortLevels = Object.values(settings.roles).map((r) => r.effort);
    const maxEffort = effortLevels.includes("max") ? 3 : effortLevels.includes("high") ? 2 : 1;

    if (maxEffort >= 3) return "~5-10 min";
    if (maxEffort >= 2) return "~2-5 min";
    return "~1-2 min";
  }

  getUsageStats(): UsageStats {
    return {
      totalTokens: 0,
      totalCost: 0,
      sessionTokens: 0,
      sessionCost: 0,
    };
  }
}

export const modelRouter = new ModelRouter({
  mode: "Balanced",
  roles: {
    default: { modelId: "", effort: "medium" },
    smol: { modelId: "", effort: "low" },
    slow: { modelId: "", effort: "high" },
    plan: { modelId: "", effort: "high" },
    debug: { modelId: "", effort: "medium" },
    review: { modelId: "", effort: "medium" },
    subagents: { modelId: "", effort: "low" },
  },
});
