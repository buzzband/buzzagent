import { useCallback, useEffect, useState } from "react";
import {
  AudioLines,
  CloudRain,
  Flame,
  Pause,
  Play,
  Plus,
  Radio,
  Square,
  Trash2,
  Volume2,
  Waves,
  Wind,
} from "lucide-react";
import {
  AMBIENT_LAYERS,
  ambientEngine,
  loadAmbientState,
  saveAmbientState,
  type AmbientState,
} from "../../lib/ambient";

const RADIO_KEY = "buzzagent.radioStations";
const RADIO_VOLUME_KEY = "buzzagent.radioVolume";
const TAB_KEY = "buzzagent.musicTab";

interface RadioStation {
  name: string;
  url: string;
  custom?: boolean;
}

/** Curated calm stations (user-replaceable; nothing is hardcoded-invasive). */
const BUILTIN_STATIONS: RadioStation[] = [
  { name: "Groove Salad — SomaFM", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
  { name: "Drone Zone — SomaFM", url: "https://ice1.somafm.com/dronezone-128-mp3" },
  { name: "Deep Space One — SomaFM", url: "https://ice1.somafm.com/deepspaceone-128-mp3" },
  { name: "Lush — SomaFM", url: "https://ice1.somafm.com/lush-128-mp3" },
  { name: "Fluid — SomaFM", url: "https://ice1.somafm.com/fluid-128-mp3" },
  { name: "Space Station — SomaFM", url: "https://ice1.somafm.com/spacestation-128-mp3" },
];

function loadStations(): RadioStation[] {
  try {
    const raw = localStorage.getItem(RADIO_KEY);
    if (!raw) return BUILTIN_STATIONS;
    const parsed = JSON.parse(raw) as { custom?: RadioStation[] };
    return [...BUILTIN_STATIONS, ...(Array.isArray(parsed.custom) ? parsed.custom : [])];
  } catch {
    return BUILTIN_STATIONS;
  }
}

function saveStations(stations: RadioStation[]): void {
  try {
    localStorage.setItem(
      RADIO_KEY,
      JSON.stringify({ custom: stations.filter((s) => s.custom) })
    );
  } catch {
    // Best-effort.
  }
}

/** Layer icon by id; the switch keeps the JSX flat. */
function layerIcon(id: string): typeof CloudRain {
  if (id === "rain" || id === "heavy-rain") return CloudRain;
  if (id === "ocean") return Waves;
  if (id === "wind") return Wind;
  if (id === "fireplace") return Flame;
  return AudioLines;
}

// ---------------------------------------------------------------- radio
//
// The audio element lives at module level, NOT inside the panel: switching
// tabs or closing the Music window unmounts the component, and playback must
// continue ("let the music work when I switch to other tabs"). Created lazily
// so importing this module never touches DOM APIs (tests, non-DOM contexts).
let radioEl: HTMLAudioElement | null = null;
let radioCurrent: RadioStation | null = null;

function radio(): HTMLAudioElement {
  if (!radioEl) {
    radioEl = new Audio();
    radioEl.preload = "none";
  }
  return radioEl;
}

function stopRadio(): void {
  radio().pause();
  radioCurrent = null;
}

function loadRadioVolume(): number {
  try {
    const raw = localStorage.getItem(RADIO_VOLUME_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.7;
  } catch {
    return 0.7;
  }
}

/**
 * Music — a panel like Browser/Skills/MCP, two tabs, zero telemetry:
 *   * Ambient: offline procedural textures (rain without thunder, waves, …);
 *   * Radio: curated calm streams + the user's own stream URLs.
 *
 * Playback is owned by module singletons, so it continues while other tabs or
 * windows have focus; the panel only drives and displays it. Ambient and
 * Radio are mutually exclusive: opening one stops the other.
 */
export function MusicPanel() {
  const [tab, setTab] = useState<"ambient" | "radio">(() => {
    try {
      return localStorage.getItem(TAB_KEY) === "radio" ? "radio" : "ambient";
    } catch {
      return "ambient";
    }
  });

  // ---- ambient --------------------------------------------------------
  const [ambient, setAmbient] = useState<AmbientState>(() => loadAmbientState());
  // Re-sync from the (persistent) engine: layers keep playing across panel
  // unmounts, so a remount must show them as active — not start from empty.
  const [active, setActive] = useState<Set<string>>(() => new Set(ambientEngine.activeIds()));

  const persistAmbient = useCallback((next: AmbientState) => {
    setAmbient(next);
    saveAmbientState(next);
  }, []);

  useEffect(() => {
    // Restore the persisted master volume into the persistent engine.
    ambientEngine.setMaster(ambient.master);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- radio ----------------------------------------------------------
  const [stations, setStations] = useState<RadioStation[]>(() => loadStations());
  const [playing, setPlaying] = useState<RadioStation | null>(() => radioCurrent);
  const [radioVolume, setRadioVolume] = useState(() => loadRadioVolume());
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [radioError, setRadioError] = useState<string | null>(null);

  useEffect(() => {
    radio().volume = radioVolume;
    try {
      localStorage.setItem(RADIO_VOLUME_KEY, String(radioVolume));
    } catch {
      // Best-effort.
    }
  }, [radioVolume]);

  const toggleLayer = (id: string) => {
    const volumes = { ...ambient.volumes };
    const nextActive = new Set(active);
    if (nextActive.has(id)) {
      ambientEngine.stop(id);
      nextActive.delete(id);
      delete volumes[id];
    } else {
      // Ambient and Radio are exclusive: starting a texture silences radio.
      stopRadio();
      setPlaying(null);
      ambientEngine.start(id, 0.6);
      ambientEngine.setVolume(id, 0.6);
      volumes[id] = 0.6;
      nextActive.add(id);
    }
    setActive(nextActive);
    persistAmbient({ ...ambient, volumes });
  };

  const setLayerVolume = (id: string, v: number) => {
    ambientEngine.setVolume(id, v);
    persistAmbient({ ...ambient, volumes: { ...ambient.volumes, [id]: v } });
  };

  const setMaster = (v: number) => {
    ambientEngine.setMaster(v);
    persistAmbient({ ...ambient, master: v });
  };

  const stopAllAmbient = () => {
    ambientEngine.stopAll();
    setActive(new Set());
    persistAmbient({ ...ambient, volumes: {} });
  };

  const playStation = (station: RadioStation) => {
    const el = radio();
    if (playing?.url === station.url) {
      el.pause();
      radioCurrent = null;
      setPlaying(null);
      return;
    }
    // Ambient and Radio are exclusive: switching to a stream stops textures.
    ambientEngine.stopAll();
    setActive(new Set());
    persistAmbient({ ...ambient, volumes: {} });
    setRadioError(null);
    el.src = station.url;
    el.volume = radioVolume;
    radioCurrent = station;
    setPlaying(station); // Optimistic: the icon flips while the stream buffers.
    el.play().catch((e: Error) => {
      const media = el.error;
      radioCurrent = null;
      setPlaying(null);
      const reason = media
        ? `media error ${media.code}${media.message ? `: ${media.message}` : ""}`
        : e.message || "unknown playback error";
      setRadioError(
        `Stream failed (${reason}) — ${station.url}. Check the URL (direct Icecast/MP3/AAC links work best); if it is correct, the system may be missing GStreamer codecs (gstreamer1.0-plugins-good, gstreamer1.0-libav).`
      );
    });
  };

  const addCustomStation = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !/^https?:\/\//.test(url)) return;
    const next = [...stations, { name, url, custom: true }];
    setStations(next);
    saveStations(next);
    setNewName("");
    setNewUrl("");
  };

  const removeCustomStation = (url: string) => {
    const next = stations.filter((s) => s.url !== url);
    setStations(next);
    saveStations(next);
    if (playing?.url === url) {
      stopRadio();
      setPlaying(null);
    }
  };

  /**
   * Tab switch with the requested exclusivity: Radio taking over stops
   * Ambient; coming back to Ambient pauses Radio. Playback itself is NOT
   * stopped when the panel unmounts — the singletons above own it.
   */
  const switchTab = (next: "ambient" | "radio") => {
    if (next === tab) return;
    if (next === "radio") {
      ambientEngine.stopAll();
      setActive(new Set());
      persistAmbient({ ...ambient, volumes: {} });
    } else {
      stopRadio();
      setPlaying(null);
    }
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Best-effort.
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-base)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
        <h2 className="text-xs font-medium text-[var(--fg-primary)]">Music</h2>
        <div className="ml-auto flex overflow-hidden rounded-md border border-[var(--border-default)]">
          {(
            [
              ["ambient", "Ambient", CloudRain],
              ["radio", "Radio", Radio],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className={`flex items-center gap-1 px-2.5 py-1 text-2xs transition-colors ${
                tab === id
                  ? "bg-[var(--accent)] font-medium text-[var(--accent-fg)]"
                  : "bg-[var(--bg-base)] text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
              }`}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* ---------------------------------------------------- ambient */}
        {tab === "ambient" && (
          <div className="mx-auto max-w-2xl">
            <p className="mb-3 text-2xs text-[var(--fg-muted)]">
              Procedural sound generated locally — no files, no network, no thunder. Mix any
              combination; everything keeps playing while you work, even when this panel is
              not in focus.
            </p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AMBIENT_LAYERS.map((layer) => {
                const Icon = layerIcon(layer.id);
                const on = active.has(layer.id);
                return (
                  <li
                    key={layer.id}
                    className={`rounded-lg border p-3 transition-colors ${
                      on
                        ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={14} className={on ? "text-[var(--accent)]" : "text-[var(--fg-muted)]"} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--fg-primary)]">
                        {layer.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleLayer(layer.id)}
                        aria-pressed={on}
                        className={`flex size-6 items-center justify-center rounded-md transition-colors ${
                          on
                            ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                            : "bg-[var(--bg-raised)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                        }`}
                      >
                        {on ? <Square size={10} /> : <Play size={11} />}
                      </button>
                    </div>
                    {on && (
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={ambient.volumes[layer.id] ?? 0.6}
                        onChange={(e) => setLayerVolume(layer.id, Number(e.target.value))}
                        aria-label={`${layer.label} volume`}
                        className="mt-2 w-full accent-[var(--accent)]"
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
              <Volume2 size={13} className="text-[var(--fg-muted)]" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={ambient.master}
                onChange={(e) => setMaster(Number(e.target.value))}
                aria-label="Master volume"
                className="min-w-0 flex-1 accent-[var(--accent)]"
              />
              {active.size > 0 && (
                <button
                  type="button"
                  onClick={stopAllAmbient}
                  className="rounded-md border border-[var(--border-default)] px-2 py-1 text-2xs text-[var(--fg-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)]"
                >
                  Stop all
                </button>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------ radio */}
        {tab === "radio" && (
          <div className="mx-auto max-w-2xl">
            <ul className="space-y-1">
              {stations.map((station) => {
                const isPlaying = playing?.url === station.url;
                return (
                  <li
                    key={station.url}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                      isPlaying
                        ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                        : "border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => playStation(station)}
                      className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                        isPlaying
                          ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                          : "bg-[var(--bg-raised)] text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]"
                      }`}
                      aria-label={isPlaying ? "Pause" : `Play ${station.name}`}
                    >
                      {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[var(--fg-primary)]">
                        {station.name}
                      </p>
                      <p className="truncate font-mono text-2xs text-[var(--fg-muted)]">
                        {station.url}
                      </p>
                    </div>
                    {station.custom && (
                      <button
                        type="button"
                        onClick={() => removeCustomStation(station.url)}
                        aria-label={`Remove ${station.name}`}
                        className="shrink-0 rounded p-1 text-[var(--fg-muted)] hover:text-[var(--danger)]"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {radioError && (
              <p role="alert" className="selectable mt-2 break-words text-2xs text-[var(--danger)]">
                {radioError}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Your stream name"
                className="w-40 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1.5 text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://stream.example.com/live.mp3"
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1.5 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={addCustomStation}
                disabled={!newName.trim() || !/^https?:\/\//.test(newUrl.trim())}
                className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-2xs font-medium text-[var(--accent-fg)] disabled:opacity-40"
              >
                <Plus size={11} />
                Add stream
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Volume2 size={13} className="text-[var(--fg-muted)]" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={radioVolume}
                onChange={(e) => setRadioVolume(Number(e.target.value))}
                aria-label="Radio volume"
                className="min-w-0 flex-1 accent-[var(--accent)]"
              />
            </div>
            <p className="mt-2 text-2xs text-[var(--fg-muted)]">
              Streams play via the system audio stack (Icecast / direct MP3 / AAC) and keep
              playing while you work in other tabs. Add any calm station URL you like —
              nothing is sent anywhere.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
