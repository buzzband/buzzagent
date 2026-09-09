import React from "react";
import { DiffEntry, Hunk } from "../../stores/agentStore";

export function DiffViewer({
  diff,
  activeHunk,
  onAcceptHunk,
  onReject,
  onAcceptAll,
}: {
  diff: DiffEntry;
  activeHunk: number | null;
  onAcceptHunk: (hunkIndex: number) => void;
  onReject: () => void;
  onAcceptAll: () => void;
}) {
  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <span className="file-path">{diff.filePath}</span>
        <div className="diff-actions">
          <button onClick={onAcceptAll} className="btn-accept">
            ✓ Accept All
          </button>
          <button onClick={onReject} className="btn-reject">
            ✗ Reject
          </button>
        </div>
      </div>

      <div className="hunks-container">
         {diff.hunks.map((hunk: Hunk) => (
          <div
            key={hunk.index}
            className={`hunk ${activeHunk === hunk.index ? "active" : ""}`}
          >
            <div className="hunk-header">
              <span>@@ Hunk {hunk.index} @@</span>
              <button
                className={`btn-accept-hunk ${activeHunk === hunk.index ? "active" : ""}`}
                onClick={() => onAcceptHunk(hunk.index)}
              >
                Accept
              </button>
            </div>
            <pre className="hunk-content">{hunk.content}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
