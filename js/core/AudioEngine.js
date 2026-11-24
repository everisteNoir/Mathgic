/**
 * AudioEngine.js — Procedural Harmonic Synthesizer (Web Audio API)
 * Generates crystalline harmonic chimes when touching edges, selecting faces,
 * or triggering elemental resonance without external audio files.
 */
const CHARGE_PROFILES = {
  fire: {
    wave: 'triangle', overtone: 'sine', ratio: 1.5, cutoff: 1500, volume: 0.72,
    texture: 'bandpass', textureFrequency: 1550, textureQ: 0.7, textureVolume: 0.03, textureMode: 'flicker'
  },
  earth: {
    wave: 'sine', overtone: 'triangle', ratio: 1.5, cutoff: 520, volume: 0.78,
    texture: 'lowpass', textureFrequency: 360, textureQ: 0.7, textureVolume: 0.024, textureMode: 'steady'
  },
  air: {
    wave: 'sine', overtone: 'sine', ratio: 2.01, cutoff: 3200, volume: 0.7,
    texture: 'highpass', textureFrequency: 1050, textureQ: 0.5, textureVolume: 0.014, textureMode: 'steady'
  },
  water: {
    wave: 'sine', overtone: 'triangle', ratio: 1.33, cutoff: 1050, volume: 0.72,
    texture: 'bandpass', textureFrequency: 620, textureQ: 1.6, textureVolume: 0.022, textureMode: 'flow'
  },
  aether: {
    wave: 'sine', overtone: 'sine', ratio: 2.71, cutoff: 3200, volume: 0.7,
    texture: 'bandpass', textureFrequency: 2300, textureQ: 1.8, textureVolume: 0.009, textureMode: 'steady'
  }
};

const RELEASE_PROFILES = {
  fire: {
    impact: 'triangle', impactRatio: 0.8, impactEnd: 0.52, impactGain: 0.12, impactDecay: 0.42,
    tail: 'sine', tailRatio: 1.5, tailEnd: 1.0, tailGain: 0.035, tailDuration: 0.78, tailSweep: 0.52,
    noise: 'bandpass', noiseFrequency: 1800, noiseQ: 0.7, noiseGain: 0.06, noiseDuration: 0.24
  },
  earth: {
    impact: 'sine', impactRatio: 0.48, impactEnd: 0.32, impactGain: 0.15, impactDecay: 0.52,
    tail: 'sine', tailRatio: 0.65, tailEnd: 0.42, tailGain: 0.025, tailDuration: 0.68, tailSweep: 0.42,
    noise: 'lowpass', noiseFrequency: 420, noiseQ: 0.6, noiseGain: 0.04, noiseDuration: 0.22
  },
  air: {
    impact: 'triangle', impactRatio: 1.05, impactEnd: 0.72, impactGain: 0.09, impactDecay: 0.36,
    tail: 'sine', tailRatio: 2.1, tailEnd: 1.45, tailGain: 0.03, tailDuration: 0.72, tailSweep: 0.5,
    noise: 'highpass', noiseFrequency: 1400, noiseQ: 0.6, noiseGain: 0.06, noiseDuration: 0.28
  },
  water: {
    impact: 'sine', impactRatio: 0.72, impactEnd: 0.46, impactGain: 0.13, impactDecay: 0.52,
    tail: 'sine', tailRatio: 1.33, tailEnd: 0.88, tailGain: 0.04, tailDuration: 0.9, tailSweep: 0.62,
    noise: 'bandpass', noiseFrequency: 650, noiseQ: 1.8, noiseGain: 0.045, noiseDuration: 0.3
  },
  aether: {
    impact: 'triangle', impactRatio: 0.92, impactEnd: 0.6, impactGain: 0.11, impactDecay: 0.5,
    tail: 'sine', tailRatio: 2.4, tailEnd: 1.6, tailGain: 0.046, tailDuration: 1.05, tailSweep: 0.8,
    noise: 'bandpass', noiseFrequency: 2500, noiseQ: 2.2, noiseGain: 0.03, noiseDuration: 0.25
  }
};

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

  /** Soft paper rustle when a page of the grimoire turns. */
  playFlip() {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.sin((i / len) * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(4200, now + 0.45);
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(now);
  }

  /** Element-specific charge texture with pitch and volume tied to charge level (0..1). */
  setCharge(level, baseFreq = 130.81, element = 'Earth') {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const resolvedElement = String(element).toLowerCase();
    const profile = CHARGE_PROFILES[resolvedElement] || CHARGE_PROFILES.earth;
    if (level > 0.03 && !this._hum) {
      const osc = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const textureSource = this.ctx.createBufferSource();
      const textureFilter = this.ctx.createBiquadFilter();
      const textureGain = this.ctx.createGain();
      const textureBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
      const textureData = textureBuffer.getChannelData(0);
      for (let i = 0; i < textureData.length; i++) textureData[i] = Math.random() * 2 - 1;
      if (profile.textureMode === 'flicker') {
        for (let i = 0; i < textureData.length; i++) textureData[i] *= 0.22;
        for (let burst = 0; burst < 32; burst++) {
          const start = Math.floor(Math.random() * textureData.length);
          const width = Math.floor(this.ctx.sampleRate * (0.004 + Math.random() * 0.026));
          for (let i = 0; i < width && start + i < textureData.length; i++) {
            textureData[start + i] += (Math.random() * 2 - 1) * Math.pow(1 - i / width, 3) * 0.72;
          }
        }
      }
      osc.type = profile.wave;
      osc2.type = profile.overtone;
      gain.gain.value = 0.0001;
      filter.type = 'lowpass';
      filter.frequency.value = profile.cutoff;
      filter.Q.value = 0.7;
      textureSource.buffer = textureBuffer;
      textureSource.loop = true;
      textureFilter.type = profile.texture;
      textureFilter.frequency.value = profile.textureFrequency;
      textureFilter.Q.value = profile.textureQ;
      textureGain.gain.value = 0.0001;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      textureSource.connect(textureFilter);
      textureFilter.connect(textureGain);
      textureGain.connect(this.ctx.destination);
      osc.start();
      osc2.start();
      textureSource.start();
      this._hum = { osc, osc2, gain, filter, textureSource, textureFilter, textureGain, element: resolvedElement };
    }
    if (!this._hum) return;
    const { osc, osc2, gain, filter, textureFilter, textureGain } = this._hum;
    if (this._hum.element !== resolvedElement) {
      osc.type = profile.wave;
      osc2.type = profile.overtone;
      filter.frequency.setTargetAtTime(profile.cutoff, now, 0.08);
      textureFilter.type = profile.texture;
      textureFilter.frequency.setTargetAtTime(profile.textureFrequency, now, 0.08);
      textureFilter.Q.value = profile.textureQ;
      this._hum.element = resolvedElement;
    }
    const f = baseFreq * (1 + level * 1.6);
    const flowPitch = profile.textureMode === 'flow' ? 0.94 + Math.sin(now * 3.2) * 0.06 : 1;
    osc.frequency.setTargetAtTime(f, now, 0.05);
    osc2.frequency.setTargetAtTime(f * profile.ratio * flowPitch, now, 0.05);
    gain.gain.setTargetAtTime(level > 0.03 ? (0.008 + level * 0.042) * profile.volume : 0.0001, now, 0.08);
    const texturePulse = profile.textureMode === 'flicker'
      ? 0.72 + Math.random() * 0.28
      : profile.textureMode === 'flow' ? 0.82 + Math.sin(now * 2.4) * 0.18 : 1;
    const textureFrequency = profile.textureMode === 'flow'
      ? profile.textureFrequency * (0.82 + Math.sin(now * 2.2) * 0.18)
      : profile.textureFrequency;
    textureFilter.frequency.setTargetAtTime(textureFrequency, now, 0.08);
    textureGain.gain.setTargetAtTime(
      level > 0.03 ? profile.textureVolume * level * texturePulse : 0.0001,
      now,
      0.04
    );
    if (level <= 0.03) {
      const hum = this._hum;
      this._hum = null;
      setTimeout(() => {
        hum.osc.stop();
        hum.osc2.stop();
        hum.textureSource.stop();
      }, 400);
    }
  }

  /** Element-specific impact played when a fully charged solid is released. */
  playRelease(baseFreq = 130.81, strength = 1, element = 'Earth') {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const profile = RELEASE_PROFILES[String(element).toLowerCase()] || RELEASE_PROFILES.earth;
    const level = Math.max(0, Math.min(1, strength));

    const impact = this.ctx.createOscillator();
    const impactGain = this.ctx.createGain();
    impact.type = profile.impact;
    impact.frequency.setValueAtTime(baseFreq * profile.impactRatio, now);
    impact.frequency.exponentialRampToValueAtTime(baseFreq * profile.impactEnd, now + 0.18);
    impactGain.gain.setValueAtTime(0.0001, now);
    impactGain.gain.linearRampToValueAtTime(profile.impactGain * level, now + 0.008);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.impactDecay);
    impact.connect(impactGain);
    impactGain.connect(this.ctx.destination);
    impact.start(now);
    impact.stop(now + profile.impactDecay + 0.01);

    const tail = this.ctx.createOscillator();
    const tailGain = this.ctx.createGain();
    tail.type = profile.tail;
    tail.frequency.setValueAtTime(baseFreq * profile.tailRatio, now);
    tail.frequency.exponentialRampToValueAtTime(baseFreq * profile.tailEnd, now + profile.tailSweep);
    tailGain.gain.setValueAtTime(0.0001, now);
    tailGain.gain.linearRampToValueAtTime(profile.tailGain * level, now + 0.035);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.tailDuration);
    tail.connect(tailGain);
    tailGain.connect(this.ctx.destination);
    tail.start(now);
    tail.stop(now + profile.tailDuration + 0.01);

    const noiseLength = Math.floor(this.ctx.sampleRate * profile.noiseDuration);
    const noiseBuffer = this.ctx.createBuffer(1, noiseLength, this.ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLength; i++) {
      const envelope = 1 - i / noiseLength;
      noiseData[i] = (Math.random() * 2 - 1) * envelope * envelope;
    }
    const noise = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();
    noise.buffer = noiseBuffer;
    filter.type = profile.noise;
    filter.frequency.setValueAtTime(profile.noiseFrequency, now);
    filter.Q.value = profile.noiseQ;
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.linearRampToValueAtTime(profile.noiseGain * level, now + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + profile.noiseDuration);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noise.start(now);
    noise.stop(now + profile.noiseDuration);
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
