import type { ExhaustStyle } from '../types';

export class MopedAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private oscMain: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;
  private muted = false;
  private started = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.36, this.ctx.currentTime, 0.04);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public ensureStarted(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.36;
      master.connect(ctx.destination);
      this.masterGain = master;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 380;
      filter.Q.value = 2.4;

      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.0;
      filter.connect(engineGain);
      engineGain.connect(master);

      // Primary 2-stroke firing sawtooth + sub-harmonic pulse
      const oscMain = ctx.createOscillator();
      oscMain.type = 'sawtooth';
      oscMain.frequency.value = 26;
      oscMain.connect(filter);
      oscMain.start();

      const oscSub = ctx.createOscillator();
      oscSub.type = 'triangle';
      oscSub.frequency.value = 52;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.45;
      oscSub.connect(subGain);
      subGain.connect(filter);
      oscSub.start();

      this.exhaustFilter = filter;
      this.engineGain = engineGain;
      this.oscMain = oscMain;
      this.oscSub = oscSub;
      this.started = true;
    } catch {
      // Audio blocked or unsupported in headless environment
    }
  }

  public updateEngine(
    rpm: number,
    throttle: number,
    exhaustStyle: ExhaustStyle,
    misfiring: boolean,
    active: boolean
  ): void {
    if (!this.ctx || !this.oscMain || !this.oscSub || !this.exhaustFilter || !this.engineGain) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    // 2-stroke single cylinder fires once per revolution: RPM / 60 Hz
    const baseHz = Math.max(18, Math.min(210, rpm / 60));
    const toneMult =
      exhaustStyle === 'titanium'
        ? 1.18
        : exhaustStyle === 'expansion'
          ? 1.1
          : exhaustStyle === 'touring'
            ? 1.02
            : 0.94;

    this.oscMain.frequency.setTargetAtTime(baseHz * toneMult, now, 0.03);
    this.oscSub.frequency.setTargetAtTime(baseHz * 2 * toneMult, now, 0.03);

    const filterCut =
      (exhaustStyle === 'titanium' ? 780 : exhaustStyle === 'expansion' ? 640 : 380) +
      throttle * 520 +
      (rpm / 9000) * 450;
    this.exhaustFilter.frequency.setTargetAtTime(filterCut, now, 0.04);

    const targetGain = misfiring ? 0.02 : 0.09 + throttle * 0.14;
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.03);
  }

  public playWrenchSound(): void {
    this.ensureStarted();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(620 + i * 160, now + i * 0.065);
      gain.gain.setValueAtTime(0.14, now + i * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.065 + 0.055);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + i * 0.065);
      osc.stop(now + i * 0.065 + 0.06);
    }
  }

  public playCashChime(): void {
    this.ensureStarted();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 880, 1174.66];
    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.18, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.24);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.26);
    });
  }

  public playScavengeChime(): void {
    this.ensureStarted();
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [392, 523.25].forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.16, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.2);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.22);
    });
  }

  public dispose(): void {
    try {
      this.oscMain?.stop();
      this.oscSub?.stop();
      void this.ctx?.close();
    } catch {
      // ignore
    }
    this.started = false;
  }
}
