import React from "react";
import { DiffEntry } from "../../stores/agentStore";

export function DiffToolbar({
  diff,
  onAccept,
  onReject,
  onStage,
}: {
  diff: DiffEntry;
  onAccept: () => void;
  onReject: () => void;
  onStage: () => void;
}) {
  return (
    <div className="diff-toolbar">
      <span className="diff-file">{diff.filePath}</span>
      <div className="diff-toolbar-actions">
        <button onClick={onStage} className="btn-stage">
          Stage
        </button>
        <button onClick={onAccept} className="btn-accept">
          ✓ Accept
        </button>
        <button onClick={onReject} className="btn-reject">
          ✗ Reject
        </button>
      </div>
    </div>
  );
}