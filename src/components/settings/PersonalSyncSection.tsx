import { useEffect, useState } from "react";
import { ArrowUpFromLine, Check, Download, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useApp } from "../../store/app";
import { t, type Language } from "../../lib/i18n";

interface ScanReport {
  authProviders: string[];
  configKeys: string[];
  hasConfig: boolean;
}

/**
 * One-click bridge between the opencode CLI and this app, in both directions.
 *
 * The core runs inside BuzzAgent's own data dir, so credentials and providers
 * the user configured in a terminal (`opencode`, `~/.local/share/opencode`)
 * are invisible to it — import copies them in. Export mirrors new keys and
 * custom providers configured here back to the personal CLI state. Both are
 * merge-only: never overwrite an existing value on the receiving side.
 */
export function PersonalSyncSection() {
  const { language, projectDir, refreshProviders } = useApp(
    useShallow((s) => ({
      language: s.language,
      projectDir: s.projectDir,
      refreshProviders: s.refreshProviders,
    }))
  );
  const [scan, setScan] = useState<ScanReport | null>(null);
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [doneFor, setDoneFor] = useState<"import" | "export" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    invoke<ScanReport>("core_scan_personal")
      .then(setScan)
      .catch(() => setScan(null));
  }, []);

  const flash = (forAction: "import" | "export", message: string, ms: number) => {
    setDone(message);
    setDoneFor(forAction);
    setTimeout(() => {
      setDone(null);
      setDoneFor(null);
    }, ms);
  };

  const runImport = async () => {
    setBusy("import");
    setDone(null);
    setFailed(null);
    try {
      const result = await invoke<{ authProviders: number; configKeys: number }>(
        "core_import_personal",
        { projectDir: projectDir || "." }
      );
      await refreshProviders(true);
      flash(
        "import",
        t(language, "import.done")
          .replace("{a}", String(result.authProviders))
          .replace("{c}", String(result.configKeys)),
        8000
      );
    } catch (e) {
      setFailed(String(e).replace("Error invoking remote method: ", ""));
      setTimeout(() => setFailed(null), 10000);
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    setBusy("export");
    setDone(null);
    setFailed(null);
    try {
      const result = await invoke<{ authProviders: number; providers: number }>(
        "core_export_personal"
      );
      flash(
        "export",
        t(language, "export.done")
          .replace("{a}", String(result.authProviders))
          .replace("{p}", String(result.providers)),
        8000
      );
    } catch (e) {
      setFailed(String(e).replace("Error invoking remote method: ", ""));
      setTimeout(() => setFailed(null), 10000);
    } finally {
      setBusy(null);
    }
  };

  // Nothing personal to import: still render the export half — new keys
  // entered in BuzzAgent can always be pushed back to the CLI.
  if (!scan) {
    return (
      <ExportBlock
        language={language}
        busy={busy === "export"}
        onExport={() => void runExport()}
        done={doneFor === "export" ? done : null}
        failed={failed}
      />
    );
  }

  const hasAnything = scan.authProviders.length > 0 || scan.hasConfig;

  return (
    <div className="space-y-3">
      {hasAnything && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg-primary)]">
            <Download size={13} className="text-[var(--accent)]" />
            {t(language, "import.title")}
          </div>
          <p className="mt-1 text-2xs text-[var(--fg-muted)]">{t(language, "import.hint")}</p>

          <p className="mt-2 text-2xs text-[var(--fg-secondary)]">
            {scan.authProviders.length > 0
              ? t(language, "import.found").replace("{n}", String(scan.authProviders.length))
              : t(language, "import.foundNone")}
            {scan.authProviders.length > 0 && (
              <span className="ml-1 font-mono text-[var(--fg-muted)]">
                ({scan.authProviders.join(", ")})
              </span>
            )}
          </p>

          <button
            type="button"
            onClick={() => void runImport()}
            disabled={busy !== null}
            className="mt-2.5 flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            {busy === "import" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : doneFor === "import" ? (
              <Check size={12} />
            ) : (
              <Download size={12} />
            )}
            {t(language, "import.action")}
          </button>
          {doneFor === "import" && done && (
            <p className="mt-1.5 text-2xs text-[var(--success)]">{done}</p>
          )}
        </div>
      )}

      <ExportBlock
        language={language}
        busy={busy === "export"}
        onExport={() => void runExport()}
        done={doneFor === "export" ? done : null}
        failed={failed}
      />
    </div>
  );
}

/** The "copy back to the CLI" half; independent of the import scan. */
function ExportBlock({
  language,
  busy,
  onExport,
  done,
  failed,
}: {
  language: Language;
  busy: boolean;
  onExport: () => void;
  done: string | null;
  failed: string | null;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg-primary)]">
        <ArrowUpFromLine size={13} className="text-[var(--accent)]" />
        {t(language, "export.title")}
      </div>
      <p className="mt-1 text-2xs text-[var(--fg-muted)]">{t(language, "export.hint")}</p>

      <button
        type="button"
        onClick={onExport}
        disabled={busy}
        className="mt-2.5 flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : done ? (
          <Check size={12} />
        ) : (
          <ArrowUpFromLine size={12} />
        )}
        {t(language, "export.action")}
      </button>

      {done && <p className="mt-1.5 text-2xs text-[var(--success)]">{done}</p>}
      {failed && <p className="mt-1.5 text-2xs text-[var(--danger)]">{failed}</p>}
    </div>
  );
}
