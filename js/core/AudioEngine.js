/**
 * AudioEngine.js — Procedural Harmonic Synthesizer (Web Audio API)
 * Generates crystalline harmonic chimes when touching edges, selecting faces,
 * or triggering elemental resonance without external audio files.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    // Mystical pentatonic / Pythagorean harmonic scale
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

  /**
   * Play a gentle harmonic chime mapped to a geometric index
   */
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

  /**
   * Deep resonant chord when switching solids or pulsing elements
   */
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
