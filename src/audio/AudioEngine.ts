import { clamp } from '../core/math';

/**
 * Placeholder sound, synthesized with Web Audio (no asset files).
 * The context is created on the first user gesture so iOS allows playback.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineOsc: OscillatorNode[] = [];
  private engineFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private skidFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private lastImpact = 0;
  muted = false;

  constructor() {
    const unlock = () => {
      this.unlock();
      if (this.ctx && this.ctx.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        window.removeEventListener('touchend', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchend', unlock, true);
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
    // iOS needs a sound started inside the gesture.
    const src = this.ctx.createBufferSource();
    src.buffer = this.ctx.createBuffer(1, 1, 22050);
    src.connect(this.ctx.destination);
    src.start(0);
  }

  private build(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Engine: two detuned oscillators through a low-pass.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    for (const [type, mul, gain] of [
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.35],
    ] as [OscillatorType, number, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 50 * mul;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.engineFilter);
      o.start();
      (o as OscillatorNode & { mul: number }).mul = mul;
      this.engineOsc.push(o);
    }

    // Tire skid: looping band-passed noise.
    const skid = ctx.createBufferSource();
    skid.buffer = this.noise;
    skid.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 900;
    this.skidFilter.Q.value = 0.8;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skid.connect(this.skidFilter).connect(this.skidGain).connect(this.master);
    skid.start();

    // Quiet desert wind.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    wind.playbackRate.value = 0.5;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 350;
    const wg = ctx.createGain();
    wg.gain.value = 0.05;
    wind.connect(wf).connect(wg).connect(this.master);
    wind.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  /** Per-frame engine and skid update from the player's car. */
  updateCar(speedFrac: number, throttle: number, slip: number, boosting: boolean, grounded: boolean, alive: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rev = clamp(speedFrac, 0, 1.3);
    const base = 42 + rev * 120 + throttle * 18 + (grounded ? 0 : 25);
    for (const o of this.engineOsc) o.frequency.setTargetAtTime(base * (o as OscillatorNode & { mul: number }).mul, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(350 + throttle * 700 + rev * 600 + (boosting ? 900 : 0), t, 0.08);
    this.engineGain.gain.setTargetAtTime(alive ? 0.06 + throttle * 0.06 + rev * 0.04 : 0, t, 0.1);
    this.skidGain.gain.setTargetAtTime(alive && grounded ? clamp(slip - 0.15, 0, 1) * 0.35 * Math.min(1, speedFrac * 3) : 0, t, 0.05);
    this.skidFilter.frequency.setTargetAtTime(700 + speedFrac * 600, t, 0.1);
  }

  private burst(duration: number, filterType: BiquadFilterType, freq: number, gain: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, duration + 0.05);
  }

  private thump(freq: number, duration: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  /** Impact thud scaled by strength (0..1); metal adds a clang. */
  impact(strength: number, metal: boolean, distance = 0): void {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastImpact < 60) return;
    this.lastImpact = now;
    const s = clamp(strength, 0, 1) / (1 + distance / 35);
    if (s < 0.03) return;
    this.thump(90 + Math.random() * 30, 0.25 + s * 0.2, 0.5 * s);
    this.burst(0.15 + s * 0.25, 'lowpass', 900 + s * 1500, 0.6 * s);
    if (metal) this.burst(0.12 + s * 0.2, 'bandpass', 2200 + Math.random() * 1500, 0.4 * s);
  }

  explosion(distance = 0): void {
    if (!this.ready) return;
    const s = 1 / (1 + distance / 40);
    this.thump(60, 1.0, 0.9 * s);
    this.burst(1.4, 'lowpass', 2500, 0.9 * s, 80);
  }

  wood(distance = 0): void {
    if (!this.ready) return;
    const s = 1 / (1 + distance / 30);
    this.burst(0.18, 'highpass', 900, 0.4 * s);
    this.burst(0.3, 'bandpass', 400, 0.3 * s);
  }
}
