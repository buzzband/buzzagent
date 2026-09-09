import { describe, it, expect } from "vitest";
import { ModelRouter } from "../services/modelRouter";
import { EffortSettings } from "../stores/modelStore";

function makeSettings(overrides?: Partial<EffortSettings>): EffortSettings {
  return {
    mode: "Balanced",
    roles: {
      default: { modelId: "m1", effort: "medium", tokenBudget: 8192 },
      smol: { modelId: "", effort: "low", tokenBudget: 4096 },
      slow: { modelId: "m2", effort: "high", tokenBudget: 16384 },
      plan: { modelId: "", effort: "high" },
      debug: { modelId: "", effort: "medium" },
      review: { modelId: "", effort: "medium" },
      subagents: { modelId: "", effort: "low" },
    },
    ...overrides,
  };
}

describe("modelRouter", () => {
  const models = [
    { id: "m1", name: "Model 1", provider: "openai" },
    { id: "m2", name: "Model 2", provider: "deepseek" },
  ];

  it("returns the configured model for a role", () => {
    const router = new ModelRouter(makeSettings());
    expect(router.getModelForRole("default", models)?.id).toBe("m1");
    expect(router.getModelForRole("slow", models)?.id).toBe("m2");
  });

  it("falls back to the default role when a role has no model", () => {
    const router = new ModelRouter(makeSettings());
    expect(router.getModelForRole("debug", models)?.id).toBe("m1");
  });

  it("returns null when no models exist", () => {
    const router = new ModelRouter(makeSettings());
    expect(router.getModelForRole("default", [])).toBeNull();
  });

  it("routes complex tasks to the slow role", async () => {
    const router = new ModelRouter(makeSettings());
    const { role } = await router.route("Redesign the architecture of the database layer", 0.9);
    expect(role).toBe("slow");
  });

  it("routes simple tasks to the smol role", async () => {
    const router = new ModelRouter(makeSettings());
    const { role } = await router.route("fix typo", 0.1);
    expect(role).toBe("smol");
  });

  it("estimates cost and time from effort settings", () => {
    const router = new ModelRouter(makeSettings());
    const { tokens, cost } = router.estimateCost(makeSettings());
    expect(tokens).toBeGreaterThan(0);
    expect(cost).toBeGreaterThan(0);
    expect(router.estimateTime(makeSettings())).toMatch(/min$/);
  });

  it("estimateComplexity scores complex tasks higher", () => {
    const router = new ModelRouter(makeSettings());
    const simple = router.estimateComplexity("hello");
    const complex = router.estimateComplexity(
      "Refactor the architecture with security and performance optimizations for the api"
    );
    expect(complex).toBeGreaterThan(simple);
  });
});
