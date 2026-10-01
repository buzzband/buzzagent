import { useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Server, Zap } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";
import type { Provider } from "../../core/types";

/**
 * Compact model switcher for the composer toolbar.
 *
 * The sidebar picker handles configuration (keys, custom providers); this one
 * is for *switching* mid-session, which is why it lives next to where you type.
 * Zen is hidden here too, for the same reason as in the sidebar.
 *
 * Beyond switching, unconnected catalogue providers are listed with a one-tap
 * "connect" affordance: enter an API key right here and the model becomes
 * usable without leaving the chat.
 */
export function ComposerModelPicker() {
  const { providers, model, setModel } = useApp(
    useShallow((s) => ({ providers: s.providers, model: s.model, setModel: s.setModel }))
  );
  const language = useApp((s) => s.language);
  const saveApiKey = useApp((s) => s.saveApiKey);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [keyTarget, setKeyTarget] = useState<Provider | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [keyError, setKeyError] = useState(false);
  const [saving, setSaving] = useState(false);

  const connected = useMemo(() => {
    if (!providers) return [];
    return providers.all
      .filter((p) => providers.connected.includes(p.id) && p.id !== "opencode")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providers]);

  /** Catalogue providers with models but no key yet — the "connect" section. */
  const available = useMemo(() => {
    if (!providers) return [];
    return providers.all
      .filter(
        (p) =>
          p.id !== "opencode" &&
          !providers.connected.includes(p.id) &&
          Object.keys(p.models).length > 0
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [providers]);

  const matches = (provider: Provider, modelId: string) =>
    `${provider.name} ${provider.id} ${modelId}`
      .toLowerCase()
      .includes(query.toLowerCase());

  const availableMatches = useMemo(() => {
    if (!query) return available;
    return available.filter((p) =>
      Object.keys(p.models).some((id) => matches(p, id)) || `${p.name} ${p.id}`.toLowerCase().includes(query.toLowerCase())
    );
  }, [available, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetKeyForm = () => {
    setKeyTarget(null);
    setKeyValue("");
    setKeyError(false);
  };

  const connect = async () => {
    if (!keyTarget || !keyValue.trim()) return;
    setSaving(true);
    setKeyError(false);
    try {
      await saveApiKey(keyTarget.id, keyValue.trim());
      const modelId =
        Object.keys(keyTarget.models)[0] ?? `${keyTarget.id}/*`;
      setModel({ providerID: keyTarget.id, modelID: modelId });
      resetKeyForm();
      setOpen(false);
      setQuery("");
    } catch {
      setKeyError(true);
    } finally {
      setSaving(false);
    }
  };

  const closeAll = () => {
    setOpen(false);
    setQuery("");
    resetKeyForm();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Switch model"
        className="flex max-w-52 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg-primary)]"
      >
        <Zap size={11} className="shrink-0 text-[var(--accent)]" />
        <span className="truncate">{model ? model.modelID : "no model"}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={closeAll} aria-hidden />

          <div
            role="listbox"
            className="absolute bottom-full right-0 z-20 mb-1.5 w-72 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-panel)]"
          >
            {/* Inline key form replaces the list while active. */}
            {keyTarget ? (
              <div className="p-3">
                <p className="text-2xs font-medium text-[var(--fg-primary)]">
                  {t(language, "picker.connectTitle").replace("{p}", keyTarget.name)}
                </p>
                <p className="mt-0.5 text-2xs text-[var(--fg-muted)]">
                  {t(language, "picker.connectHint")}
                </p>
                <input
                  autoFocus
                  type="password"
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void connect();
                    if (e.key === "Escape") resetKeyForm();
                  }}
                  placeholder={t(language, "picker.connectPlaceholder")}
                  className={`mt-2 w-full rounded-md border bg-[var(--bg-surface)] px-2 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:outline-none ${
                    keyError
                      ? "border-[var(--danger)]"
                      : "border-[var(--border-default)] focus:border-[var(--accent)]"
                  }`}
                />
                {keyError && (
                  <p className="mt-1 text-2xs text-[var(--danger)]">
                    {t(language, "picker.connectFailed")}
                  </p>
                )}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void connect()}
                    disabled={saving || !keyValue.trim()}
                    className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-2xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
                  >
                    {saving ? t(language, "picker.connecting") : t(language, "picker.connect")}
                  </button>
                  <button
                    type="button"
                    onClick={resetKeyForm}
                    className="rounded-md px-2 py-1 text-2xs text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    {t(language, "common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-2.5 py-1.5">
                  <Server size={11} className="shrink-0 text-[var(--fg-muted)]" />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter models…"
                    className="w-full bg-transparent text-2xs text-[var(--fg-primary)] focus:outline-none"
                  />
                </div>

                <div className="max-h-72 overflow-y-auto p-1">
                  {connected.length === 0 && (
                    <div className="px-3 py-3 text-center">
                      <p className="text-2xs text-[var(--fg-muted)]">
                        {t(language, "picker.empty")}
                      </p>
                    </div>
                  )}

                  {connected.map((provider) => {
                    const modelIds = Object.entries(provider.models).filter(([id]) =>
                      matches(provider, id)
                    );
                    if (modelIds.length === 0) return null;
                    return (
                      <div key={provider.id} className="mb-0.5">
                        <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                          {provider.name}
                        </div>
                        {modelIds.map(([id, info]) => {
                          const selected =
                            model?.providerID === provider.id && model?.modelID === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => {
                                setModel({ providerID: provider.id, modelID: id });
                                closeAll();
                              }}
                              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                                selected
                                  ? "bg-[var(--accent-subtle)] text-[var(--fg-primary)]"
                                  : "text-[var(--fg-secondary)] hover:bg-[var(--bg-hover)]"
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate font-mono">
                                {info.name ?? id}
                              </span>
                              {selected && <Check size={12} className="shrink-0 text-[var(--accent)]" />}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  {availableMatches.length > 0 && (
                    <div className="mb-0.5">
                      <div className="mt-1 px-2 py-1 text-2xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                        {t(language, "picker.available")}
                      </div>
                      {availableMatches.map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          onClick={() => {
                            setKeyTarget(provider);
                            setKeyValue("");
                            setKeyError(false);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono">
                            {provider.name}
                          </span>
                          <span className="shrink-0 text-[var(--fg-muted)]">
                            {Object.keys(provider.models).length}
                          </span>
                          <Plus size={12} className="shrink-0 text-[var(--accent)]" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
