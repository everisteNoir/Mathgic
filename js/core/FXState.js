/**
 * FXState.js — global on/off switch for visual effects ("static mode" when off).
 * Default: on, unless the operating system asks for reduced motion. The choice is remembered.
 */
const KEY = 'mathgic-fx';
const prefersReduced =
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let enabled = !prefersReduced;
try {
  const saved = localStorage.getItem(KEY);
  if (saved !== null) enabled = saved === 'on';
} catch {
  /* storage unavailable: keep default */
}

const listeners = new Set();

export const fxState = {
  get enabled() {
    return enabled;
  },
  set(value) {
    enabled = !!value;
    try {
      localStorage.setItem(KEY, enabled ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    this.applyToBody();
    listeners.forEach((fn) => fn(enabled));
  },
  toggle() {
    this.set(!enabled);
    return enabled;
  },
  applyToBody() {
    document.body.classList.toggle('fx-off', !enabled);
  },
  onChange(fn) {
    listeners.add(fn);
  }
};
