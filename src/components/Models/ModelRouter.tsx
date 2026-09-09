import React, { useState } from "react";
import { useModelStore, ProviderConfig, ModelConfig } from "../../stores/modelStore";
import { ProviderList } from "./ProviderList";
import { ProviderForm } from "./ProviderForm";
import { RoleEffortGrid } from "../Effort/RoleEffortGrid";

/**
 * Curated default models per provider type. Populated automatically when a
 * provider is added so the user can select a model without typing model ids.
 */
const DEFAULT_MODELS: Record<string, Array<{ id: string; name: string; contextLength?: number }>> = {
  openai: [
    { id: "gpt-4o", name: "GPT-4o", contextLength: 128000 },
    { id: "gpt-4o-mini", name: "GPT-4o mini", contextLength: 128000 },
    { id: "o3-mini", name: "o3-mini", contextLength: 200000 },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextLength: 200000 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextLength: 200000 },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek Chat", contextLength: 64000 },
    { id: "deepseek-reasoner", name: "DeepSeek Reasoner", contextLength: 64000 },
  ],
  google: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLength: 1000000 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextLength: 1000000 },
  ],
  ollama: [{ id: "qwen3-coder", name: "Qwen3 Coder (local)", contextLength: 128000 }],
  openrouter: [
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5 (OR)" },
    { id: "openai/gpt-4o", name: "GPT-4o (OR)" },
  ],
  custom: [{ id: "custom-model", name: "Custom model" }],
};

export function ModelRouter() {
  const { providers, addProvider, updateProvider, selectModel } = useModelStore();
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [showProviderForm, setShowProviderForm] = useState(false);

  const handleSaveProvider = (provider: ProviderConfig) => {
    // Attach default models when the provider has none yet.
    const withModels: ProviderConfig =
      provider.models.length > 0
        ? provider
        : {
            ...provider,
            models: (DEFAULT_MODELS[provider.type] ?? DEFAULT_MODELS.custom).map((m) => ({
              ...m,
              id: `${provider.type}:${m.id}`,
              provider: provider.type,
            })),
          };

    if (editingProvider) {
      updateProvider(editingProvider.id, withModels);
    } else {
      addProvider(withModels);
    }
    setShowProviderForm(false);
    setEditingProvider(null);
  };

  const allModels: ModelConfig[] = providers
    .filter((p) => p.enabled)
    .flatMap((p) => p.models);

  return (
    <div className="model-router">
      <div className="model-router-header">
        <h3>Model Router</h3>
        <button onClick={() => setShowProviderForm(true)}>+ Add Provider</button>
      </div>

      <div className="model-router-content">
        <div className="provider-section">
          <h4>Providers &amp; Models</h4>
          <ProviderList
            onSelect={selectModel}
            onEdit={(p) => {
              setEditingProvider(p);
              setShowProviderForm(true);
            }}
          />
        </div>

        {allModels.length > 0 && (
          <div className="role-mapping-section">
            <h4>Role → Model Mapping</h4>
            <RoleEffortGrid />
          </div>
        )}
      </div>

      {showProviderForm && (
        <ProviderForm
          provider={editingProvider}
          onSave={handleSaveProvider}
          onCancel={() => {
            setShowProviderForm(false);
            setEditingProvider(null);
          }}
        />
      )}
    </div>
  );
}
