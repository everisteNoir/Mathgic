import { fxState } from '../core/FXState.js?v=7';

const PRESS_TARGETS = 'button';

/**
 * FantasyUI.js — smooth, magical micro-interactions for the whole interface:
 * button ripples, glowing slider fills, a sliding glow under chosen options, spark bursts on toggles,
 * the portal flash between sections, text-swap fades and soft UI chimes. Everything respects the FX switch.
 */
export class FantasyUI {
  constructor(audio) {
    this.audio = audio;
    this.panel = document.getElementById('grimoire-panel');
    this.portal = document.getElementById('portal-fx');
    this._raf = 0;
    this._bind();
    this._observe();
    this._initAll();
  }

  /** Re-run a CSS animation class on an element (used for text swaps and value bumps). */
  retrigger(el, cls = 'swap') {
    if (!el || !fxState.enabled) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  portalTransition() {
    if (!fxState.enabled || !this.portal) return;
    this.portal.classList.remove('go');
    void this.portal.offsetWidth;
    this.portal.classList.add('go');
  }

  sparkBurst(x, y, count = 12) {
    if (!fxState.enabled) return;
    for (let i = 0; i < count; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const d = 18 + Math.random() * 26;
      s.style.left = `${x}px`;
      s.style.top = `${y}px`;
      s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
      s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 750);
    }
  }

  _bind() {
    // Ripple spreading from the exact point of contact
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest(PRESS_TARGETS);
      if (!btn || btn.disabled || !fxState.enabled) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.6;
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${e.clientX - r.left - size / 2}px`;
      ripple.style.top = `${e.clientY - r.top - size / 2}px`;
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest(PRESS_TARGETS);
      if (!btn) return;
      // Soft chime for interface actions (silent unless sound is on)
      if (btn.id !== 'btn-audio') this.audio.playChime(2 + Math.floor(Math.random() * 4), 0.035);
      // Spark burst on switches
      const isSwitch =
        (btn.classList.contains('choice-btn') && btn.parentElement.querySelectorAll('.choice-btn').length === 1) ||
        btn.classList.contains('summon-btn') ||
        btn.id === 'btn-fx';
      if (isSwitch) {
        const r = btn.getBoundingClientRect();
        this.sparkBurst(r.left + r.width / 2, r.top + r.height / 2);
      }
      const group = btn.closest('.choice-group');
      if (group) requestAnimationFrame(() => this._placeGlider(group));
    });

    // Sliders: glowing fill + value bump
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (el.type !== 'range') return;
      this._fillSlider(el);
      this.retrigger(el.parentElement?.querySelector('.control-val'), 'bump');
    });

    window.addEventListener('resize', () => this._placeAll());
  }

  _fillSlider(el) {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--p', `${p}%`);
  }

  _placeGlider(group) {
    const glider = group.querySelector('.choice-glider');
    const active = group.querySelector('.choice-btn.active');
    if (!glider || !active || !group.offsetParent) return;
    glider.style.width = `${active.offsetWidth}px`;
    glider.style.height = `${active.offsetHeight}px`;
    glider.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    glider.classList.add('ready');
  }

  _placeAll() {
    document.querySelectorAll('.choice-group').forEach((g) => this._placeGlider(g));
  }

  _initAll() {
    document.querySelectorAll('input[type="range"]').forEach((el) => this._fillSlider(el));
    document.querySelectorAll('.choice-group').forEach((g) => {
      if (!g.querySelector('.choice-glider')) {
        const glider = document.createElement('span');
        glider.className = 'choice-glider';
        g.prepend(glider);
      }
    });
    this._placeAll();
  }

  _observe() {
    if (!this.panel) return;
    const own = '.choice-glider, input[type="range"]';
    new MutationObserver((mutations) => {
      // Ignore the changes this class makes itself (glider placement, slider fill)
      if (mutations.every((m) => m.target.nodeType === 1 && m.target.matches(own))) return;
      cancelAnimationFrame(this._raf);
      this._raf = requestAnimationFrame(() => this._initAll());
    }).observe(this.panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  }
}
