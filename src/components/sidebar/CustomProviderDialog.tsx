import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  Brain,
  Check,
  CheckCircle2,
  CheckSquare,
  Globe,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";

export interface ProviderDraft {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: Record<string, { name?: string; reasoning?: boolean }>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Present → edit an existing provider instead of creating one. */
  initial?: ProviderDraft | null;
}

interface ModelItem {
  id: string;
  name: string;
  selected: boolean;
  reasoning: boolean;
}

interface ProbeResult {
  ok: boolean;
  status: number;
  message: string;
  models: string[];
}

const PRESETS = [
  {
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    needsKey: false,
  },
  {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
  },
  {
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    needsKey: false,
  },
  {
    name: "vLLM",
    baseUrl: "http://127.0.0.1:8000/v1",
    needsKey: false,
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
  },
];

function checkIsReasoning(modelName: string): boolean {
  const m = modelName.toLowerCase();
  return (
    m.includes("r1") ||
    m.includes("o1") ||
    m.includes("o3") ||
    m.includes("qwq") ||
    m.includes("thinking") ||
    m.includes("reasoning") ||
    m.includes("deepseek-reasoner")
  );
}

function friendlyName(modelId: string): string {
  const segment = modelId.split(":")[0].split("/").pop() || modelId;
  return (
    segment
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || modelId
  );
}

export function CustomProviderDialog({ open, onClose, initial }: Props) {
  const { saveCustomProvider } = useApp(
    useShallow((s) => ({ saveCustomProvider: s.saveCustomProvider }))
  );
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Models list
  const [models, setModels] = useState<ModelItem[]>([]);
  const [searchFilter, setSearchFilter] = useState("");

  // Manual model addition
  const [manualModelId, setManualModelId] = useState("");

  // Probe status
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing pre-fills from the stored config; creating starts clean.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setBaseUrl(initial.baseUrl);
      setApiKey(initial.apiKey ?? "");
      setModels(
        Object.entries(initial.models).map(([id, def]) => ({
          id,
          name: def.name ?? friendlyName(id),
          selected: true,
          reasoning: def.reasoning === true,
        }))
      );
      setProbeResult(null);
    } else {
      setName("");
      setBaseUrl("");
      setApiKey("");
      setModels([]);
      setProbeResult(null);
    }
    setError(null);
    setManualModelId("");
    setSearchFilter("");
  }, [open, initial]);

  const probeModels = useCallback(
    async (targetUrl = baseUrl, targetKey = apiKey) => {
      const url = targetUrl.trim();
      if (!url) return;
      setProbing(true);
      try {
        const res = await invoke<ProbeResult>("probe_provider_models", {
          baseUrl: url,
          apiKey: targetKey.trim() || null,
        });

        setProbeResult(res);

        if (res.ok && res.models.length > 0) {
          setModels((prev) => {
            const prevMap = new Map(prev.map((m) => [m.id, m]));
            return res.models.map((id) => {
              const existing = prevMap.get(id);
              return {
                id,
                name: existing?.name ?? friendlyName(id),
                selected: existing ? existing.selected : true,
                reasoning: existing ? existing.reasoning : checkIsReasoning(id),
              };
            });
          });
        }
      } catch (err) {
        setProbeResult({
          ok: false,
          status: 0,
          message: err instanceof Error ? err.message : String(err),
          models: [],
        });
      } finally {
        setProbing(false);
      }
    },
    [baseUrl, apiKey]
  );

  // Auto-probe when baseUrl or apiKey changes with debounce
  useEffect(() => {
    if (!open) return;
    const url = baseUrl.trim();
    if (!url || url.length < 8) {
      setProbeResult(null);
      return;
    }

    const timer = setTimeout(() => {
      void probeModels(url, apiKey);
    }, 550);

    return () => clearTimeout(timer);
  }, [baseUrl, apiKey, open, probeModels]);

  if (!open) return null;

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
    setModels([]);
    setProbeResult(null);
    setError(null);
    if (!preset.needsKey) {
      void probeModels(preset.baseUrl, "");
    }
  };

  const addManualModel = () => {
    const trimmed = manualModelId.trim();
    if (!trimmed) return;
    if (models.some((m) => m.id === trimmed)) {
      setManualModelId("");
      return;
    }
    const item: ModelItem = {
      id: trimmed,
      name: friendlyName(trimmed),
      selected: true,
      reasoning: checkIsReasoning(trimmed),
    };
    setModels((prev) => [...prev, item]);
    setManualModelId("");
  };

  const toggleSelect = (id: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, selected: !m.selected } : m))
    );
  };

  const toggleReasoning = (id: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, reasoning: !m.reasoning } : m))
    );
  };

  const updateModelName = (id: string, newName: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, name: newName } : m))
    );
  };

  const removeModel = (id: string) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
  };

  const selectAll = (selected: boolean) => {
    setModels((prev) => prev.map((m) => ({ ...m, selected })));
  };

  const selectedCount = models.filter((m) => m.selected).length;

  const filteredModels = models.filter(
    (m) =>
      m.id.toLowerCase().includes(searchFilter.toLowerCase()) ||
      m.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a Provider Name.");
      return;
    }
    if (!baseUrl.trim()) {
      setError("Please enter the API Base URL.");
      return;
    }
    const chosen = models.filter((m) => m.selected);
    if (chosen.length === 0) {
      setError("Please select at least one model to enable.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const autoId =
        initial?.id ??
        (name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || `custom-${Date.now()}`);

      await saveCustomProvider({
        id: autoId,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        models: chosen.map((m) => ({
          id: m.id,
          name: m.name.trim() || m.id,
          reasoning: m.reasoning,
        })),
      });

      if (!initial) {
        setName("");
        setBaseUrl("");
        setApiKey("");
        setModels([]);
        setProbeResult(null);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-raised)] px-5 py-3">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--fg-primary)]">
              Add AI Provider & Models
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-1 flex-col overflow-y-auto p-5">
          {error && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]"
            >
              {error}
            </div>
          )}

          {/* Quick Presets */}
          <div className="mb-4">
            <label className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wider text-[var(--fg-muted)]">
              <Sparkles size={11} className="text-[var(--accent)]" />
              Quick Presets
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    baseUrl === preset.baseUrl
                      ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                      : "border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3.5">
            {/* Provider Name */}
            <div>
              <label className="text-2xs font-medium text-[var(--fg-secondary)]">
                Provider Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ollama, DeepSeek, Local Server…"
                required
                className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
            </div>

            {/* Base URL */}
            <div>
              <label className="flex items-center gap-1 text-2xs font-medium text-[var(--fg-secondary)]">
                <Globe size={11} />
                API Base URL
              </label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:11434/v1 or https://api.deepseek.com/v1"
                required
                className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <p className="mt-0.5 text-2xs text-[var(--fg-muted)]">
                Include the path prefix, e.g. <code>http://127.0.0.1:11434/v1</code>
              </p>
            </div>

            {/* API Key */}
            <div>
              <label className="flex items-center gap-1 text-2xs font-medium text-[var(--fg-secondary)]">
                <Key size={11} />
                API Key (Optional for local Ollama / LM Studio)
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-… (models auto-load on input)"
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 font-mono text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void probeModels()}
                  disabled={probing || !baseUrl.trim()}
                  title="Check connection and reload models"
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:border-[var(--accent)] disabled:opacity-40"
                >
                  <RefreshCw size={12} className={probing ? "animate-spin text-[var(--accent)]" : ""} />
                  <span>Check</span>
                </button>
              </div>
            </div>

            {/* Live Verification & Connection Feedback */}
            {probing && (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--accent-subtle)] px-3 py-2 text-xs text-[var(--accent)]">
                <Loader2 size={13} className="animate-spin shrink-0" />
                <span>Verifying connection and fetching available models…</span>
              </div>
            )}

            {!probing && probeResult && (
              probeResult.ok ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-[var(--success)]/40 bg-[var(--success-subtle)] px-3 py-2 text-xs text-[var(--success)]">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Connection & API Key Verified (HTTP {probeResult.status})</div>
                    <div className="text-2xs opacity-90">{probeResult.message}</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger-subtle)] px-3 py-2 text-xs text-[var(--danger)]">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Verification Failed</div>
                    <div className="text-2xs opacity-90">{probeResult.message}</div>
                  </div>
                </div>
              )
            )}

            {/* Models section */}
            <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                <div>
                  <span className="text-xs font-semibold text-[var(--fg-primary)]">
                    Available Models
                  </span>
                  <span className="ml-2 text-2xs text-[var(--fg-muted)]">
                    ({selectedCount} of {models.length} selected)
                  </span>
                </div>

                {models.length > 0 && (
                  <div className="flex items-center gap-2 text-2xs">
                    <button
                      type="button"
                      onClick={() => selectAll(true)}
                      className="text-[var(--accent)] hover:underline"
                    >
                      Select All
                    </button>
                    <span className="text-[var(--border-strong)]">·</span>
                    <button
                      type="button"
                      onClick={() => selectAll(false)}
                      className="text-[var(--fg-muted)] hover:underline"
                    >
                      Deselect All
                    </button>
                  </div>
                )}
              </div>

              {/* Search filter if models present */}
              {models.length > 5 && (
                <div className="mt-2.5 flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1">
                  <Search size={12} className="text-[var(--fg-muted)]" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Filter models list…"
                    className="w-full bg-transparent text-xs text-[var(--fg-primary)] focus:outline-none"
                  />
                </div>
              )}

              {/* Models list */}
              <div className="mt-2.5 max-h-60 overflow-y-auto divide-y divide-[var(--border-subtle)]">
                {models.length === 0 ? (
                  <div className="py-7 text-center text-xs text-[var(--fg-muted)]">
                    {probing ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={14} className="animate-spin text-[var(--accent)]" />
                        <span>Checking endpoint and discovering models…</span>
                      </div>
                    ) : (
                      <p>
                        No models loaded. Enter Base URL & API key above to load models, or add one below.
                      </p>
                    )}
                  </div>
                ) : filteredModels.length === 0 ? (
                  <p className="py-4 text-center text-xs text-[var(--fg-muted)]">
                    No models matching &ldquo;{searchFilter}&rdquo;
                  </p>
                ) : (
                  filteredModels.map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-center gap-2.5 py-2 transition-colors ${
                        m.selected ? "opacity-100" : "opacity-50"
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        type="button"
                        onClick={() => toggleSelect(m.id)}
                        className="text-[var(--accent)] shrink-0"
                        aria-label={m.selected ? "Deselect" : "Select"}
                      >
                        {m.selected ? <CheckSquare size={16} /> : <Square size={16} className="text-[var(--fg-muted)]" />}
                      </button>

                      {/* Model info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-medium text-[var(--fg-primary)]">
                            {m.id}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={m.name}
                          onChange={(e) => updateModelName(m.id, e.target.value)}
                          placeholder="Display title"
                          className="mt-0.5 w-full bg-transparent text-2xs text-[var(--fg-muted)] focus:text-[var(--fg-primary)] focus:outline-none"
                        />
                      </div>

                      {/* Reasoning Toggle */}
                      <button
                        type="button"
                        onClick={() => toggleReasoning(m.id)}
                        title={m.reasoning ? "Reasoning Active (Thinking Model)" : "Click to enable Reasoning"}
                        className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors ${
                          m.reasoning
                            ? "bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent)]/40"
                            : "border border-[var(--border-subtle)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
                        }`}
                      >
                        <Brain size={12} />
                        <span>{m.reasoning ? "Reasoning On" : "Reasoning Off"}</span>
                      </button>

                      {/* Remove item */}
                      <button
                        type="button"
                        onClick={() => removeModel(m.id)}
                        className="rounded p-1 text-[var(--fg-muted)] hover:text-[var(--danger)] shrink-0"
                        title="Remove model"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add manual model inline */}
              <div className="mt-3 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-2.5">
                <input
                  type="text"
                  value={manualModelId}
                  onChange={(e) => setManualModelId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManualModel();
                    }
                  }}
                  placeholder="Add unlisted model ID (e.g. llama3.2, mistral:latest)"
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2.5 py-1 font-mono text-xs text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:border-[var(--accent)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={addManualModel}
                  disabled={!manualModelId.trim()}
                  className="flex items-center gap-1 rounded-md bg-[var(--bg-raised)] px-2.5 py-1 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] disabled:opacity-40 shrink-0"
                >
                  <Plus size={12} />
                  <span>Add Model</span>
                </button>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="mt-6 flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
            <span className="text-2xs text-[var(--fg-muted)]">
              {selectedCount > 0 ? (
                <>Adding <strong>{selectedCount}</strong> model{selectedCount === 1 ? "" : "s"} to BuzzAgent</>
              ) : (
                "Select at least 1 model"
              )}
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3.5 py-1.5 text-xs text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || selectedCount === 0 || !name.trim() || !baseUrl.trim()}
                className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                <span>Save Provider</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
