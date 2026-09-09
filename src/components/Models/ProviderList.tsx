import React from "react";
import { useModelStore, ProviderConfig, ModelConfig } from "../../stores/modelStore";

interface ProviderListProps {
  onSelect: (model: ModelConfig) => void;
  onEdit: (provider: ProviderConfig) => void;
}

export function ProviderList({ onSelect, onEdit }: ProviderListProps) {
  const { providers, selectedModel, selectModel, removeProvider } = useModelStore();

  if (providers.length === 0) {
    return (
      <div className="provider-list empty">
        <p>No providers configured. Add your first provider to get started.</p>
      </div>
    );
  }

  return (
    <div className="provider-list">
      {providers.map((provider) => (
        <div key={provider.id} className="provider-group">
          <div className="provider-header">
            <h4>{provider.name}</h4>
            <span className={`provider-status ${provider.enabled ? "enabled" : "disabled"}`}>
              {provider.enabled ? "●" : "●"}
            </span>
            <button onClick={() => onEdit(provider)} className="btn-edit" title="Edit">
              ✎
            </button>
            <button onClick={() => removeProvider(provider.id)} className="btn-remove" title="Remove">
              ✕
            </button>
          </div>

          <div className="model-list">
            {provider.models.map((model) => (
              <div
                key={model.id}
                className={`model-item ${selectedModel?.id === model.id ? "selected" : ""}`}
                onClick={() => {
                  selectModel(model);
                  onSelect(model);
                }}
              >
                <span className="model-name">{model.name}</span>
                {model.contextLength && (
                  <span className="model-context">{model.contextLength} ctx</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
