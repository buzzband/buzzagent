import { useEffect, useState } from "react";
import { Check, Loader2, LogIn, KeyRound } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t } from "../../lib/i18n";

/**
 * Built-in providers that support OAuth (Claude Pro, GitHub Copilot, …).
 *
 * The core owns the whole flow — this section only lists which providers
 * offer oauth (from `GET /provider/auth`), shows which are already connected,
 * and hands off to the system browser. No provider-specific code lives here.
 */
export function OAuthProvidersSection({ connected }: { connected: string[] }) {
  const { providerAuthMethods, oauthLogin, language } = useApp(
    useShallow((s) => ({
      providerAuthMethods: s.providerAuthMethods,
      oauthLogin: s.oauthLogin,
      language: s.language,
    }))
  );
  const [methods, setMethods] = useState<Record<string, { type: string; label?: string }[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    void providerAuthMethods().then(setMethods);
  }, [providerAuthMethods]);

  const oauthProviders = Object.entries(methods)
    .filter(([, list]) => list?.some((m) => m.type === "oauth"))
    .map(([id, list]) => ({
      id,
      label: list.find((m) => m.type === "oauth")?.label ?? id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (oauthProviders.length === 0) return null;

  const login = async (id: string) => {
    setBusy(id);
    setFailed(null);
    setDone(null);
    const ok = await oauthLogin(id);
    setBusy(null);
    if (ok) {
      setDone(id);
      setTimeout(() => setDone(null), 4000);
    } else {
      setFailed(id);
      setTimeout(() => setFailed(null), 6000);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg-primary)]">
        <KeyRound size={13} className="text-[var(--accent)]" />
        {t(language, "oauth.title")}
      </div>
      <p className="mt-1 text-2xs text-[var(--fg-muted)]">
        {t(language, "oauth.hint")}
      </p>

      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        {oauthProviders.map(({ id, label }) => {
          const isConnected = connected.includes(id);
          return (
            <div
              key={id}
              className="flex items-center justify-between gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <div className="truncate text-xs text-[var(--fg-primary)]">{label}</div>
                {isConnected && (
                  <span className="flex items-center gap-1 text-2xs text-[var(--success)]">
                    <Check size={9} />
                    {t(language, "oauth.connected")}
                  </span>
                )}
                {failed === id && (
                  <span className="text-2xs text-[var(--danger)]">
                    {t(language, "oauth.failed")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void login(id)}
                disabled={busy !== null}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-2xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
              >
                {busy === id ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : done === id ? (
                  <Check size={10} />
                ) : (
                  <LogIn size={10} />
                )}
                {isConnected ? t(language, "oauth.relogin") : t(language, "oauth.login")}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
