import React, { useState } from "react";
import { ProviderConfig } from "../../stores/modelStore";

interface ProviderFormProps {
  provider?: ProviderConfig | null;
  onSave: (provider: ProviderConfig) => void;
  onCancel: () => void;
}

const BUILTIN_PROVIDERS = [
  { type: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { type: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com" },
  { type: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { type: "google", name: "Google", baseUrl: "https://generativelanguage.googleapis.com" },
  { type: "ollama", name: "Ollama", baseUrl: "http://localhost:11434" },
  { type: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api" },
];

export function ProviderForm({ provider, onSave, onCancel }: ProviderFormProps) {
  const isEdit = !!provider;
  const [name, setName] = useState(provider?.name ?? "");
  const [type, setType] = useState(provider?.type ?? "openai");
  const [apiKey, setApiKey] = useState(provider?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [showKey, setShowKey] = useState(false);

  const preset = BUILTIN_PROVIDERS.find((p) => p.type === type);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const providerToSave: ProviderConfig = {
      id: provider?.id ?? crypto.randomUUID(),
      name: name || (preset?.name ?? "Custom"),
      type: type as ProviderConfig["type"],
      apiKey,
      baseUrl: baseUrl || preset?.baseUrl,
      models: provider?.models ?? [],
      enabled: provider?.enabled ?? true,
    };
    onSave(providerToSave);
  };

  return (
    <div className="form-backdrop">
      <form className="provider-form" onSubmit={handleSubmit}>
        <h3>{isEdit ? "Edit Provider" : "Add Provider"}</h3>

        <label>
          Provider Type
          <select value={type} onChange={(e) => setType(e.target.value as ProviderConfig["type"])}>
            {BUILTIN_PROVIDERS.map((p) => (
              <option key={p.type} value={p.type}>
                {p.name}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>

        <label>
          Display Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={preset?.name ?? "My Provider"}
          />
        </label>

        <label>
          Base URL
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={preset?.baseUrl}
          />
        </label>

        <label>
          API Key {type === "ollama" && <span className="optional-hint">(not required for Ollama)</span>}
          <div className="api-key-input">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="toggle-key-visibility"
            >
              {showKey ? "🙈" : "👁️"}
            </button>
          </div>
        </label>

        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {isEdit ? "Save Changes" : "Add Provider"}
          </button>
        </div>
      </form>
    </div>
  );
}
