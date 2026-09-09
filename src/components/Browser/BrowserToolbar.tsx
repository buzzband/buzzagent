import React, { useState } from "react";

export function BrowserToolbar({
  url,
  title,
  isLoading,
  onNavigate,
  onRefresh,
  onBack,
  onForward,
  onToggleDevTools,
  onScreenshot,
}: {
  url: string;
  title: string;
  isLoading: boolean;
  onNavigate: (url: string) => void;
  onRefresh: () => void;
  onBack: () => void;
  onForward: () => void;
  onToggleDevTools: () => void;
  onScreenshot?: () => void;
}) {
  const [inputValue, setInputValue] = useState(url);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigate(inputValue);
  };

  return (
    <div className="browser-toolbar">
      <div className="browser-nav-buttons">
        <button onClick={onBack} disabled={isLoading} title="Back">
          ←
        </button>
        <button onClick={onForward} disabled={isLoading} title="Forward">
          →
        </button>
        <button onClick={onRefresh} disabled={isLoading} title="Refresh">
          ↻
        </button>
      </div>

      <form onSubmit={handleSubmit} className="browser-url-form">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter URL..."
          className="browser-url-input"
        />
      </form>

      <span className="browser-title" title={title}>
        {isLoading ? "Loading..." : title}
      </span>

      <div className="browser-toolbar-actions">
        {onScreenshot && (
          <button onClick={onScreenshot} disabled={isLoading} title="Take screenshot">
            📷
          </button>
        )}
        <button onClick={onToggleDevTools} title="Toggle DevTools">
          ⌥
        </button>
      </div>
    </div>
  );
}
