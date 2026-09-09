import React from "react";
import { Hunk } from "../../stores/agentStore";

export function HunkSelector({
  hunks,
  selected,
  onSelect,
}: {
  hunks: Hunk[];
  selected: Set<number>;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="hunk-selector">
      <h4>Hunks</h4>
      <div className="hunk-list">
        {hunks.map((hunk) => (
          <div
            key={hunk.index}
            className={`hunk-item ${selected.has(hunk.index) ? "selected" : ""}`}
            onClick={() => onSelect(hunk.index)}
          >
            <span>@@ {hunk.index} @@</span>
            <span className="hunk-preview">
              {hunk.content.split("\n")[0]?.substring(0, 50)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}