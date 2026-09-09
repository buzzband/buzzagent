import React from "react";
import { useModelStore, Role, ModelConfig, EffortLevel } from "../../stores/modelStore";

const ROLES: { key: Role; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "smol", label: "Smol" },
  { key: "slow", label: "Slow" },
  { key: "plan", label: "Planning" },
  { key: "debug", label: "Debug" },
  { key: "review", label: "Review" },
  { key: "subagents", label: "Sub-agents" },
];

export function RoleEffortGrid({
  onRoleModelSelect,
}: {
  onRoleModelSelect?: (role: Role, modelId: string) => void;
}) {
  const { effortSettings, providers, setRoleModel, setRoleEffort } = useModelStore();

  const allModels: ModelConfig[] = providers
    .filter((p) => p.enabled)
    .flatMap((p) => p.models);

  return (
    <div className="role-effort-grid">
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Model</th>
            <th>Effort</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map(({ key, label }) => {
            const roleConfig = effortSettings.roles[key];
            return (
              <tr key={key}>
                <td className="role-label">{label}</td>
                <td>
                  <select
                    value={roleConfig?.modelId ?? ""}
                    onChange={(e) => {
                      setRoleModel(key, e.target.value);
                      onRoleModelSelect?.(key, e.target.value);
                    }}
                    className="model-select"
                  >
                    <option value="">Choose model…</option>
                    {allModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.provider} / {m.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={roleConfig?.effort ?? "medium"}
                     onChange={(e) =>
                      setRoleEffort(key, e.target.value as EffortLevel)
                    }
                    className="effort-select"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="max">Max</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
