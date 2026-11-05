import type { AttackRequest, FighterSide } from './arena-combat';
import type { ArenaOutcome } from './arena-outcome';

export type AudioPreferences = { muted: boolean; music: number; effects: number };
export type AudioSnapshot = {
  preferences: AudioPreferences;
  unlocked: boolean;
  available: boolean;
};
const DEFAULTS: AudioSnapshot = {
  preferences: { muted: false, music: 0.32, effects: 0.8 },
  unlocked: false,
  available: true,
};
const STORAGE_KEY = 'duelvault.arena.audio.v1';
const ROOT = '/arena/audio/';
const FILES = {
  music: 'heartfelt-battle-loop.ogg',
  'basic-charge': 'basic-charge.wav',
  'basic-release': 'basic-release.wav',
  'basic-hit': 'basic-hit.wav',
  'medium-charge': 'medium-charge.wav',
  'medium-release': 'medium-release.wav',
  'medium-hit': 'medium-hit.wav',
  'ultimate-charge': 'ultimate-charge.wav',
  'ultimate-release': 'ultimate-release.wav',
  'ultimate-hit': 'ultimate-hit.wav',
  ui: 'ui-open.wav',
  'intro-round': 'intro-round.wav',
  'intro-3': 'intro-3.wav',
  'intro-2': 'intro-2.wav',
  'intro-1': 'intro-1.wav',
  'intro-fight': 'intro-fight.wav',
  'announcer-fight': 'announcer-fight.wav',
} as const;
type Sample = keyof typeof FILES;
const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

/** One local audio graph per arena. Created only after a real user interaction. */
export class ArenaAudio {
  private snapshot = DEFAULTS;
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private music: AudioBufferSourceNode | null = null;
  private buffers = new Map<Sample, AudioBuffer>();
  private downloads = new Map<Sample, Promise<ArrayBuffer | null>>();
  private decoding: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private closed = true;
  private ducking = false;
  private introducing = true;
  private attackId = 0;
  private variation = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => DEFAULTS;
  private publish(update: Partial<AudioSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    this.listeners.forEach((listener) => listener());
  }

  mount(scene: 'arena' | 'lobby' = 'arena') {
    this.closed = false;
    this.generation++;
    this.abort = new AbortController();
    try {
      const stored = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? 'null',
      ) as Partial<AudioPreferences> | null;
      if (stored)
        this.publish({
          preferences: {
            muted: typeof stored.muted === 'boolean' ? stored.muted : false,
            music: typeof stored.music === 'number' ? clamp(stored.music) : 0.32,
            effects: typeof stored.effects === 'number' ? clamp(stored.effects) : 0.8,
          },
        });
    } catch {
      /* Defaults also work when browser storage is unavailable. */
    }
    const samples: Sample[] =
      scene === 'lobby' ? ['music', 'ui'] : (Object.keys(FILES) as Sample[]);
    for (const key of samples) {
      this.downloads.set(
        key,
        fetch(ROOT + FILES[key], { signal: this.abort.signal })
          .then((response) => (response.ok ? response.arrayBuffer() : null))
          .catch(() => null),
      );
    }
  }

  setPreferences(update: Partial<AudioPreferences>) {
    const previous = this.snapshot.preferences;
    const preferences = {
      muted: update.muted ?? previous.muted,
      music: update.music === undefined ? previous.music : clamp(update.music),
      effects: update.effects === undefined ? previous.effects : clamp(update.effects),
    };
    this.publish({ preferences });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      /* Optional persistence. */
    }
    this.applyLevels(0.06);
  }

  private ramp(node: GainNode | null, value: number, seconds: number) {
    const context = this.context;
    if (!node || !context || context.state === 'closed') return;
    const now = context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(value, now + seconds);
  }
  private applyLevels(seconds = 0.15) {
    const settings = this.snapshot.preferences;
    this.ramp(this.master, settings.muted ? 0 : 0.85, 0.03);
    this.ramp(
      this.musicBus,
      this.introducing ? 0 : settings.music * (this.ducking ? 0.32 : 1),
      seconds,
    );
    this.ramp(this.effectsBus, settings.effects, 0.03);
  }

  async unlock() {
    if (this.closed || this.snapshot.preferences.muted || document.hidden) return;
    const generation = this.generation;
    try {
      if (!this.context) {
        const context = new AudioContext({ latencyHint: 'interactive' });
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = 0;
        this.compressor = context.createDynamicsCompressor();
        this.compressor.threshold.value = -8;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.2;
        this.musicBus = context.createGain();
        this.effectsBus = context.createGain();
        this.musicBus.gain.value = 0;
        this.effectsBus.gain.value = 0;
        this.musicBus.connect(this.compressor);
        this.effectsBus.connect(this.compressor);
        this.compressor.connect(this.master);
        this.master.connect(context.destination);
      }
      const context = this.context;
      if (!this.decoding) this.decoding = this.decode(context, generation);
      // resume() is invoked synchronously in the trusted interaction handler.
      if (context.state === 'suspended') await context.resume();
      if (this.closed || this.context !== context) return;
      this.publish({ unlocked: context.state === 'running' });
      this.applyLevels(0.45);
      await this.decoding;
      this.startMusic();
    } catch {
      if (!this.closed && generation === this.generation) this.publish({ available: false });
    }
  }

  private async decode(context: AudioContext, generation: number) {
    await Promise.all(
      (Object.keys(FILES) as Sample[]).map(async (key) => {
        try {
          const bytes = await this.downloads.get(key);
          if (!bytes || this.closed || generation !== this.generation) return;
          let buffer: AudioBuffer;
          try {
            buffer = await context.decodeAudioData(bytes.slice(0));
          } catch (error) {
            if (key !== 'music') throw error;
            const fallback = await fetch(ROOT + 'heartfelt-battle-fallback.mp3', {
              signal: this.abort?.signal,
            });
            if (!fallback.ok) return;
            buffer = await context.decodeAudioData(await fallback.arrayBuffer());
          }
          if (this.closed || generation !== this.generation || context !== this.context) return;
          this.buffers.set(key, buffer);
          if (key === 'music') this.startMusic();
        } catch {
          /* One unavailable sample never prevents gameplay or the other sounds. */
        }
      }),
    );
  }

  private startMusic() {
    const context = this.context;
    const buffer = this.buffers.get('music');
    if (
      !context ||
      context.state !== 'running' ||
      !buffer ||
      !this.musicBus ||
      this.music ||
      this.introducing ||
      this.closed
    )
      return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    source.connect(this.musicBus);
    source.start();
    this.music = source;
    this.applyLevels(0.8);
  }

  private play(key: Sample, pan: number, level = 1, pitch = 1) {
    const context = this.context;
    const buffer = this.buffers.get(key);
    if (
      !context ||
      context.state !== 'running' ||
      !buffer ||
      !this.effectsBus ||
      this.snapshot.preferences.muted ||
      this.closed
    )
      return;
    const source = context.createBufferSource();
    const panner = context.createStereoPanner();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = pitch;
    panner.pan.value = Math.max(-0.65, Math.min(0.65, pan));
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.effectsBus);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    source.start();
  }

  charge(request: AttackRequest) {
    this.attackId = request.id;
    this.ducking = request.kind === 'ultimate';
    this.applyLevels(0.12);
    void this.unlock().then(() => {
      if (this.attackId === request.id)
        this.play(
          `${request.kind}-charge`,
          this.pan(request.attacker),
          request.kind === 'ultimate' ? 0.8 : 0.65,
        );
    });
  }
  release(request: AttackRequest) {
    if (this.attackId !== request.id) return;
    this.play(
      `${request.kind}-release`,
      this.pan(request.attacker) * 0.6,
      request.kind === 'basic' ? 0.8 : 0.85,
    );
  }
  impact(request: AttackRequest) {
    if (this.attackId !== request.id) return;
    const pitch = request.kind === 'ultimate' ? 1 : [0.97, 1, 1.025][this.variation++ % 3]!;
    this.play(
      `${request.kind}-hit`,
      -this.pan(request.attacker),
      request.kind === 'ultimate' ? 0.95 : 0.85,
      pitch,
    );
  }
  finish() {
    this.attackId = 0;
    this.ducking = false;
    this.applyLevels(0.65);
  }
  ui() {
    this.play('ui', 0, 0.25);
  }
  introCue(cue: 'versus' | 'round' | '3' | '2' | '1' | 'fight') {
    if (cue === 'versus') {
      this.play('medium-charge', 0, 0.35, 0.85);
      return;
    }
    if (cue === 'fight') {
      this.play('announcer-fight', 0, 1);
      this.play('intro-fight', 0, 0.28);
    } else this.play(`intro-${cue}`, 0, cue === 'round' ? 0.65 : 0.7);
  }
  finishIntro() {
    this.introducing = false;
    this.startMusic();
    this.applyLevels(0.9);
  }
  outcome(outcome: ArenaOutcome) {
    const context = this.context;
    if (!context || context.state !== 'running' || !this.effectsBus || this.closed) return;
    this.ducking = true;
    this.applyLevels(0.3);
    const notes =
      outcome === 'win'
        ? [392, 493.88, 587.33, 783.99]
        : outcome === 'loss'
          ? [329.63, 293.66, 220]
          : [392, 440, 392];
    notes.forEach((frequency, index) => {
      const tone = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.18;
      tone.type = 'triangle';
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.75);
      tone.connect(gain);
      gain.connect(this.effectsBus!);
      tone.onended = () => {
        tone.disconnect();
        gain.disconnect();
      };
      tone.start(start);
      tone.stop(start + 0.8);
    });
  }
  private pan(side: FighterSide) {
    return side === 'left' ? -0.38 : 0.38;
  }

  toggle() {
    if (this.snapshot.preferences.muted) {
      this.setPreferences({ muted: false });
      void this.unlock();
    } else if (!this.snapshot.unlocked) void this.unlock();
    else this.setPreferences({ muted: true });
  }
  visibility() {
    const context = this.context;
    if (!context || context.state === 'closed') return;
    if (document.hidden) {
      void context.suspend().catch(() => {});
    } else if (!this.snapshot.preferences.muted) void this.unlock();
  }
  close() {
    this.closed = true;
    this.generation++;
    this.abort?.abort();
    this.music?.stop();
    this.music?.disconnect();
    this.music = null;
    this.sources.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    });
    this.sources.clear();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    this.buffers.clear();
    this.downloads.clear();
    this.decoding = null;
    this.master = this.musicBus = this.effectsBus = null;
    this.compressor = null;
    this.attackId = 0;
    this.ducking = false;
    this.introducing = true;
    this.publish({ unlocked: false });
  }
}
