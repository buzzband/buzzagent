import React from "react";

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputBar({ value, onChange, onSubmit, disabled, placeholder = "Ask BuzzAgent..." }: InputBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        onSubmit();
      }
    }
  };

  const lines = Math.min(Math.max(value.split("\n").length, 1), 6);

  return (
    <div className="input-bar">
      <div className="input-container">
        <textarea
          className="input-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={lines}
          maxLength={4000}
        />
        <button
          className={`send-button ${disabled || !value.trim() ? "disabled" : ""}`}
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          title={disabled ? "Agent is running..." : "Send message (Enter)"}
        >
          {disabled ? "⏳" : "→"}
        </button>
      </div>
      <div className="input-shortcuts">
        <span className="shortcut-hint">Shift+Enter for newline</span>
      </div>
    </div>
  );
}
