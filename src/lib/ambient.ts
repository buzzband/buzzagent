/**
 * Offline ambient-sound engine (no assets, no licensing, no network):
 * every texture is synthesized with WebAudio and mixed through one master
 * gain. Sources:
 *   * noise beds (rain, heavy rain, wind, ocean) — filtered white noise with
 *     slow LFO modulation for swell;
 *   * fireplace — random crackle bursts over a low rumble;
 *   * brown/pink noise — standard coefficient filters.
 *
 * The owner of an AudioContext cannot be re-parented across React remounts,
 * so the engine is a module singleton; the Music panel only drives it.
 */

export interface AmbientLayer {
  id: string;
  label: string;
  /** Start the layer and return a stop handle. */
  start: (ctx: AudioContext, out: AudioNode) => () => void;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const seconds = 4;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function noiseSource(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start();
  return src;
}

/** Slow random-walk gain LFO for natural swell. */
function swellLfo(ctx: AudioContext, target: GainNode, depth: number, periodSec: number) {
  const lfo = ctx.createOscillator();
  const amp = ctx.createGain();
  lfo.frequency.value = 1 / periodSec;
  amp.gain.value = depth * target.gain.value;
  lfo.connect(amp).connect(target.gain);
  lfo.start();
  return () => {
    try {
      lfo.stop();
    } catch {
      // Already stopped.
    }
  };
}

function lowpass(ctx: AudioContext, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function highpass(ctx: AudioContext, freq: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = freq;
  return f;
}

/** Filtered-noise bed shared by rain / wind / ocean layers. */
function noiseBed(
  ctx: AudioContext,
  out: AudioNode,
  opts: {
    level: number;
    lowpassHz: number;
    highpassHz?: number;
    q?: number;
    swellDepth?: number;
    swellPeriod?: number;
  }
): () => void {
  const buffer = makeNoiseBuffer(ctx);
  const src = noiseSource(ctx, buffer);
  const lp = lowpass(ctx, opts.lowpassHz, opts.q);
  const hp = opts.highpassHz ? highpass(ctx, opts.highpassHz) : null;
  const gain = ctx.createGain();
  gain.gain.value = opts.level;
  src.connect(lp);
  if (hp) {
    lp.connect(hp);
    hp.connect(gain);
  } else {
    lp.connect(gain);
  }
  gain.connect(out);
  const stops = [() => src.stop()];
  if (opts.swellDepth && opts.swellPeriod) {
    stops.push(swellLfo(ctx, gain, opts.swellDepth, opts.swellPeriod));
  }
  return () => stops.forEach((stop) => stop());
}

/** Random crackles: short filtered-noise bursts over a faint rumble. */
function fireplace(ctx: AudioContext, out: AudioNode): () => void {
  const rumble = noiseBed(ctx, out, { level: 0.05, lowpassHz: 220 });
  let alive = true;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const crackle = () => {
    if (!alive) return;
    const burst = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.08));
    }
    burst.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1200 + Math.random() * 2400;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.12 + Math.random() * 0.25;
    burst.connect(bp).connect(g).connect(out);
    burst.start();
    const next = setTimeout(crackle, 40 + Math.random() * 320);
    timers.add(next);
  };
  crackle();

  return () => {
    alive = false;
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    rumble();
  };
}

export const AMBIENT_LAYERS: AmbientLayer[] = [
  {
    id: "rain",
    label: "Rain (no thunder)",
    start: (ctx, out) =>
      noiseBed(ctx, out, {
        level: 0.16,
        lowpassHz: 4200,
        highpassHz: 500,
        q: 0.5,
        swellDepth: 0.35,
        swellPeriod: 11,
      }),
  },
  {
    id: "heavy-rain",
    label: "Heavy rain",
    start: (ctx, out) =>
      noiseBed(ctx, out, {
        level: 0.24,
        lowpassHz: 6000,
        highpassHz: 300,
        q: 0.4,
        swellDepth: 0.3,
        swellPeriod: 7,
      }),
  },
  {
    id: "ocean",
    label: "Ocean waves",
    start: (ctx, out) =>
      noiseBed(ctx, out, {
        level: 0.2,
        lowpassHz: 900,
        q: 0.6,
        swellDepth: 0.8,
        swellPeriod: 14,
      }),
  },
  {
    id: "wind",
    label: "Wind",
    start: (ctx, out) =>
      noiseBed(ctx, out, {
        level: 0.15,
        lowpassHz: 600,
        q: 2.2,
        swellDepth: 0.9,
        swellPeriod: 9,
      }),
  },
  {
    id: "fireplace",
    label: "Fireplace",
    start: (ctx, out) => fireplace(ctx, out),
  },
  {
    id: "brown",
    label: "Brown noise",
    start: (ctx, out) => {
      // Brown noise = integrated white noise, generated directly.
      const seconds = 6;
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      const gain = ctx.createGain();
      gain.gain.value = 0.18;
      src.connect(gain).connect(out);
      return () => src.stop();
    },
  },
  {
    id: "pink",
    label: "Pink noise",
    start: (ctx, out) => {
      const seconds = 6;
      const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
      const data = buf.getChannelData(0);
      // Paul Kellet's economical pink filter.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < data.length; i += 1) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      const gain = ctx.createGain();
      gain.gain.value = 0.18;
      src.connect(gain).connect(out);
      return () => src.stop();
    },
  },
];

// ------------------------------------------------------------- state

export interface AmbientState {
  /** Layer id → volume 0..1 (only non-zero entries are "on"). */
  volumes: Record<string, number>;
  master: number;
}

const AMBIENT_KEY = "buzzagent.ambient";

export function loadAmbientState(): AmbientState {
  try {
    const raw = localStorage.getItem(AMBIENT_KEY);
    if (!raw) return { volumes: {}, master: 0.7 };
    const parsed = JSON.parse(raw) as Partial<AmbientState>;
    return {
      volumes:
        parsed.volumes && typeof parsed.volumes === "object" ? parsed.volumes : {},
      master: typeof parsed.master === "number" ? parsed.master : 0.7,
    };
  } catch {
    return { volumes: {}, master: 0.7 };
  }
}

export function saveAmbientState(state: AmbientState): void {
  try {
    localStorage.setItem(AMBIENT_KEY, JSON.stringify(state));
  } catch {
    // Best-effort.
  }
}

// --------------------------------------------------------- engine

type StopFn = () => void;

class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private running = new Map<string, StopFn>();

  private ensure(): { ctx: AudioContext; out: GainNode } {
    if (!this.ctx || !this.master) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error("WebAudio is unavailable");
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume().catch(() => undefined);
    return { ctx: this.ctx, out: this.master };
  }

  setMaster(v: number): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
    }
  }

  isActive(id: string): boolean {
    return this.running.has(id);
  }

  /** Ids of all currently running layers — used to re-sync UI after remounts. */
  activeIds(): string[] {
    return [...this.running.keys()];
  }

  /** Start a layer at `volume` (0..1). Restarting an active layer is a no-op. */
  start(id: string, volume: number): void {
    const layer = AMBIENT_LAYERS.find((l) => l.id === id);
    if (!layer || this.running.has(id) || volume <= 0) return;
    const { ctx, out } = this.ensure();
    // Per-layer gain node so mixer volume changes are a live ramp; the layer
    // synthesis itself always runs at its natural internal level.
    const layerGain = ctx.createGain();
    layerGain.gain.value = volume;
    layerGain.connect(out);
    const stop = layer.start(ctx, layerGain);
    this.layerGains.set(id, layerGain);
    this.running.set(id, () => {
      try {
        layerGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        window.setTimeout(() => {
          stop();
          layerGain.disconnect();
        }, 400);
      } catch {
        stop();
      }
    });
  }

  /** Live volume ramp for a running layer. */
  setVolume(id: string, volume: number): void {
    if (!this.ctx) return;
    const gainNode = this.layerGains.get(id);
    if (gainNode) gainNode.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.08);
  }

  stop(id: string): void {
    const stop = this.running.get(id);
    if (!stop) return;
    this.running.delete(id);
    this.layerGains.delete(id);
    stop();
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  private layerGains = new Map<string, GainNode>();
}

export const ambientEngine = new AmbientEngine();
