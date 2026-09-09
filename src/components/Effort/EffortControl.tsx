import React from "react";
import { useModelStore, Role, EffortLevel, EffortSettings, GlobalMode } from "../../stores/modelStore";
import { useAgentStore } from "../../stores/agentStore";
import { modelRouter } from "../../services/modelRouter";

const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "max"];
const ROLES: Role[] = ["default", "smol", "slow", "plan", "debug", "review", "subagents"];

/** Global mode presets map onto the per-run effort level. */
const MODE_TO_EFFORT: Record<GlobalMode, EffortLevel> = {
  Fast: "low",
  Balanced: "medium",
  Deep: "high",
  Research: "max",
};

const ROLE_LABELS: Record<Role, string> = {
  default: "Default",
  smol: "Smol / Fast",
  slow: "Slow / Deep",
  plan: "Planning",
  debug: "Debugging",
  review: "Review",
  subagents: "Sub-agents",
};

export function EffortControl() {
  const { effortSettings, setEffort, setRoleEffort, setRoleTokenBudget } = useModelStore();
  const setAgentEffort = useAgentStore((s) => s.setEffort);

  const handleMode = (mode: GlobalMode) => {
    setEffort("mode", mode);
    // The global mode drives the effort actually used by the next agent run.
    setAgentEffort(MODE_TO_EFFORT[mode]);
  };

  const { cost, time } = calculateEstimate(effortSettings);

  return (
    <div className="effort-control">
      <h3>Thinking Effort</h3>

      <div className="global-mode">
        <label>Global Mode (applies to the next run):</label>
        <div className="mode-buttons">
          {(Object.keys(MODE_TO_EFFORT) as GlobalMode[]).map((mode) => (
            <button
              key={mode}
              className={effortSettings.mode === mode ? "active" : ""}
              onClick={() => handleMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="role-grid">
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Effort</th>
              <th>Token budget</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role}>
                <td>{ROLE_LABELS[role]}</td>
                <td>
                  <select
                    value={effortSettings.roles[role]?.effort ?? "medium"}
                    onChange={(e) => setRoleEffort(role, e.target.value as EffortLevel)}
                  >
                    {EFFORT_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    value={effortSettings.roles[role]?.tokenBudget ?? 8192}
                    onChange={(e) => setRoleTokenBudget(role, parseInt(e.target.value) || 0)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cost-estimate">
        <p>Estimated cost: ${cost.toFixed(2)}</p>
        <p>Estimated time: {time}</p>
      </div>
    </div>
  );
}

function calculateEstimate(settings: EffortSettings): { cost: number; time: string } {
  const costResult = modelRouter.estimateCost(settings);
  const time = modelRouter.estimateTime(settings);
  return { cost: costResult.cost, time };
}
