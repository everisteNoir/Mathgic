/**
 * AudioEngine.js — Procedural Harmonic Synthesizer (Web Audio API)
 * Generates crystalline harmonic chimes when touching edges, selecting faces,
 * or triggering elemental resonance without external audio files.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled && !this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.enabled && this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (this.enabled) {
      this.playChime(3, 0.14);
    }
    return this.enabled;
  }

  playChime(index = 0, volume = 0.1) {
    if (!this.enabled || !this.ctx) return;

    const now = this.ctx.currentTime;
    const freq = this.scale[Math.abs(index) % this.scale.length];

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.005, now + 0.6);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.9);
  }

  /** Continuous hum while a solid is held: pitch and volume rise with charge level (0..1). */
  setCharge(level, baseFreq = 130.81) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (level > 0.03 && !this._hum) {
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc2.type = 'sine';
      gain.gain.value = 0.0001;
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc2.start();
      this._hum = { osc, osc2, gain };
    }
    if (!this._hum) return;
    const { osc, osc2, gain } = this._hum;
    const f = baseFreq * (1 + level * 1.6);
    osc.frequency.setTargetAtTime(f, now, 0.05);
    osc2.frequency.setTargetAtTime(f * 2.005, now, 0.05);
    gain.gain.setTargetAtTime(level > 0.03 ? 0.01 + level * 0.05 : 0.0001, now, 0.08);
    if (level <= 0.03) {
      const hum = this._hum;
      this._hum = null;
      setTimeout(() => {
        hum.osc.stop();
        hum.osc2.stop();
      }, 400);
    }
  }

  /** Bright rising burst played when a fully charged solid is released. */
  playRelease(baseFreq = 130.81, strength = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    [1, 2, 3, 4.01].forEach((ratio, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(baseFreq * ratio, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * ratio * 1.5, now + 0.5);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime((0.12 * strength) / (i + 1), now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 1.25);
    });
  }

  playResonance(baseFreq = 130.81) {
    if (!this.enabled || !this.ctx) return;

    const now = this.ctx.currentTime;
    [1, 1.5, 2].forEach((ratio, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(baseFreq * ratio, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.08 / (i + 1), now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 1.45);
    });
  }
}
