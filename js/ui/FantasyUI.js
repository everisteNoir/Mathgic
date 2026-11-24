import { fxState } from '../core/FXState.js?v=13';

const PRESS_TARGETS = 'button';

/**
 * FantasyUI.js — smooth, magical micro-interactions for the whole interface:
 * button ripples, glowing slider fills, a sliding glow under chosen options, spark bursts on toggles,
 * the portal flash between sections, text-swap fades and soft UI chimes. Everything respects the FX switch.
 */
export class FantasyUI {
  constructor(audio) {
    this.audio = audio;
    this.panel = document.getElementById('grimoire');
    this.portal = document.getElementById('portal-fx');
    this._raf = 0;
    this._bind();
    this._observe();
    this._initAll();
    this._bindSpatialPointer();
    this._panelSwapToken = 0;
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

  /** A short, synchronized depth swap for the two floating AR information panes. */
  transitionPanels(containers, swap) {
    const token = ++this._panelSwapToken;
    containers.forEach((el) => el?.classList.add('content-leaving'));
    window.setTimeout(() => {
      if (token !== this._panelSwapToken) return;
      swap?.();
      containers.forEach((el) => {
        el?.classList.remove('content-leaving');
        el?.classList.add('content-enter');
      });
      window.setTimeout(() => {
        if (token !== this._panelSwapToken) return;
        containers.forEach((el) => el?.classList.remove('content-enter'));
      }, 500);
    }, 155);
  }

  /** Chapter changes stage their heading first, then reveal the page content. */
  transitionChapterPanels(headings, contents, swapHeading, swapContent) {
    const token = ++this._panelSwapToken;
    const all = [...headings, ...contents];
    all.forEach((el) => el?.classList.add('content-leaving'));

    window.setTimeout(() => {
      if (token !== this._panelSwapToken) return;
      swapHeading?.();
      headings.forEach((el) => {
        el?.classList.remove('content-leaving');
        el?.classList.add('content-enter');
      });

      // The chapter title gets a short visual lead over its information.
      window.setTimeout(() => {
        if (token !== this._panelSwapToken) return;
        swapContent?.();
        contents.forEach((el) => {
          el?.classList.remove('content-leaving');
          el?.classList.add('content-enter');
        });

        window.setTimeout(() => {
          if (token !== this._panelSwapToken) return;
          all.forEach((el) => el?.classList.remove('content-enter', 'content-leaving'));
        }, 500);
      }, 105);
    }, 155);
  }

  cancelPanelTransition(containers) {
    this._panelSwapToken++;
    containers.forEach((el) => {
      el?.classList.remove('content-leaving', 'content-enter');
    });
  }

  chapterTransition(theme) {
    if (theme?.primary) this.panel?.style.setProperty('--grimoire-accent', theme.primary);
    if (theme?.secondary) this.panel?.style.setProperty('--grimoire-secondary', theme.secondary);
    this.portalTransition();
  }

  /** Pointer-driven CSS 3D tilt. No animation loop and no extra WebGL context. */
  _bindSpatialPointer() {
    const panels = Array.from(document.querySelectorAll('.floating-panel'));
    if (!panels.length || !window.matchMedia('(pointer: fine)').matches) return;
    const update = (event) => {
      panels.forEach((panel) => {
        const rect = panel.getBoundingClientRect();
        const nx = Math.max(-1, Math.min(1, (event.clientX - (rect.left + rect.width / 2)) / Math.max(1, rect.width)));
        const ny = Math.max(-1, Math.min(1, (event.clientY - (rect.top + rect.height / 2)) / Math.max(1, rect.height)));
        const base = panel.classList.contains('floating-left') ? 8 : -8;
        panel.style.setProperty('--ar-rotate-x', `${(-ny * 2.3).toFixed(2)}deg`);
        panel.style.setProperty('--ar-rotate-y', `${(base + nx * 2.8).toFixed(2)}deg`);
      });
    };
    const reset = () => panels.forEach((panel) => {
      panel.style.setProperty('--ar-rotate-x', '0deg');
      panel.style.setProperty('--ar-rotate-y', panel.classList.contains('floating-left') ? '8deg' : '-8deg');
    });
    window.addEventListener('pointermove', update, { passive: true });
    window.addEventListener('blur', reset);
    document.addEventListener('pointerleave', reset);
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
