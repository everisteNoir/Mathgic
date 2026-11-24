import { fxState } from '../core/FXState.js?v=23';

const PRESS_TARGETS = 'button';
const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

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
    this._panelGlyphObservers = new Map();
    this._glyphObserverByTarget = new WeakMap();
    this._visiblePanelGlyphs = new Set();
    this._activeGlyphBatch = [];
    this._glyphAnimationCursor = 0;
    this._glyphAnimationTimer = 0;
    this._raf = 0;
    this._panelSwapToken = 0;
    this._chapterTransitionToken = 0;
    fxState.onChange((enabled) => {
      if (enabled) this._schedulePanelGlyphAnimation();
      else this._clearPanelGlyphAnimation();
    });
    this._initPanelGlyphObservers();
    this._bind();
    this._observe();
    this._initAll();
    this._bindSpatialPointer();
  }

  _shouldAnimate() {
    return fxState.enabled && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /** Re-run a CSS animation class on an element (used for text swaps and value bumps). */
  retrigger(el, cls = 'swap') {
    if (!el || !this._shouldAnimate()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  portalTransition() {
    if (!this._shouldAnimate() || !this.portal) return;
    this.portal.classList.remove('go');
    void this.portal.offsetWidth;
    this.portal.classList.add('go');
  }

  /** A short, synchronized depth swap for the two floating AR information panes. */
  transitionPanels(containers, swap) {
    if (!this._shouldAnimate()) {
      this.cancelPanelTransition(containers);
      swap?.();
      return;
    }
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
      }, 780);
    }, 205);
  }

  /** Chapter changes stage their heading first, then reveal the page content. */
  transitionChapterPanels(headings, contents, swapHeading, swapContent) {
    if (!this._shouldAnimate()) {
      this.cancelPanelTransition([...headings, ...contents]);
      swapHeading?.();
      swapContent?.();
      return;
    }
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
        }, 780);
      }, 145);
    }, 205);
  }

  cancelPanelTransition(containers) {
    this._panelSwapToken++;
    containers.forEach((el) => {
      el?.classList.remove('content-leaving', 'content-enter');
    });
  }

  chapterTransition(theme, chapterId = 'prologue') {
    if (theme?.primary) this.panel?.style.setProperty('--grimoire-accent', theme.primary);
    if (theme?.secondary) this.panel?.style.setProperty('--grimoire-secondary', theme.secondary);
    if (!this.panel) return;
    const token = ++this._chapterTransitionToken;
    const classes = ['chapter-arrival', 'signature-prologue', 'signature-polyhedra', 'signature-golden-ratio', 'signature-projection', 'signature-infinity', 'signature-non-euclidean'];
    this.panel.classList.remove(...classes);
    if (!this._shouldAnimate()) return;
    void this.panel.offsetWidth;
    const signature = `signature-${chapterId}`;
    this.panel.classList.add('chapter-arrival', signature);
    window.setTimeout(() => {
      if (token !== this._chapterTransitionToken) return;
      this.panel?.classList.remove('chapter-arrival', signature);
    }, 1500);
  }

  /** Pointer-driven CSS 3D tilt. No animation loop and no extra WebGL context. */
  _bindSpatialPointer() {
    const panels = Array.from(document.querySelectorAll('.floating-panel'));
    if (!panels.length || !window.matchMedia('(pointer: fine)').matches) return;
    const rects = new Map();
    const lastRotation = new WeakMap();
    let rectsDirty = true;
    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;
    const measurePanels = () => {
      rects.clear();
      panels.forEach((panel) => {
        const { left, top, width, height } = panel.getBoundingClientRect();
        rects.set(panel, { left, top, width, height });
      });
      rectsDirty = false;
    };
    const update = (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (rectsDirty) measurePanels();
        panels.forEach((panel) => {
          const rect = rects.get(panel);
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          const nx = Math.max(-1, Math.min(1, (pointerX - (rect.left + rect.width / 2)) / rect.width));
          const ny = Math.max(-1, Math.min(1, (pointerY - (rect.top + rect.height / 2)) / rect.height));
          const base = panel.classList.contains('floating-left') ? 8 : -8;
          const rotateX = (-ny * 2.3).toFixed(1);
          const rotateY = (base + nx * 2.8).toFixed(1);
          const previous = lastRotation.get(panel);
          if (previous?.x !== rotateX) panel.style.setProperty('--ar-rotate-x', `${rotateX}deg`);
          if (previous?.y !== rotateY) panel.style.setProperty('--ar-rotate-y', `${rotateY}deg`);
          lastRotation.set(panel, { x: rotateX, y: rotateY });
        });
      });
    };
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      panels.forEach((panel) => {
        panel.style.setProperty('--ar-rotate-x', '0deg');
        const rotateY = panel.classList.contains('floating-left') ? '8' : '-8';
        panel.style.setProperty('--ar-rotate-y', `${rotateY}deg`);
        lastRotation.set(panel, { x: '0.0', y: rotateY });
      });
    };
    const invalidateRects = () => {
      rectsDirty = true;
    };
    if (typeof ResizeObserver === 'function') {
      this._panelResizeObserver = new ResizeObserver(invalidateRects);
      panels.forEach((panel) => this._panelResizeObserver.observe(panel));
    }
    window.addEventListener('resize', invalidateRects);
    window.addEventListener('scroll', invalidateRects, { passive: true });
    window.addEventListener('pointermove', update, { passive: true });
    window.addEventListener('blur', reset);
    document.addEventListener('pointerleave', reset);
  }


  _bind() {
    // Ripple spreading from the exact point of contact
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest(PRESS_TARGETS);
      if (!btn || btn.disabled || !this._shouldAnimate()) return;
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
      // No particle bursts on UI controls: the ripple and subtle state glow are enough.
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

  refreshPanelText(scope = null) {
    if (!graphemeSegmenter) return;
    const scopes = scope ? [scope] : Array.from(document.querySelectorAll('.floating-panel'));
    const headingSelector = '.chapter-heading-name, .page-title';
    scopes.forEach((target) => {
      if (!target.isConnected || target.nodeType !== Node.ELEMENT_NODE) return;
      if (!target.closest('.floating-panel')) return;
      const headingRoots = new Set([
        ...(target.matches(headingSelector) ? [target] : []),
        ...target.querySelectorAll(headingSelector)
      ]);
      const ancestorHeading = target.closest(headingSelector);
      if (ancestorHeading) headingRoots.add(ancestorHeading);

      headingRoots.forEach((heading) => {
        heading.classList.add('glyph-heading');
        let glyphIndex = 0;
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);

        textNodes.forEach((textNode) => {
          const parent = textNode.parentElement;
          if (!parent || parent.closest('.floating-glyph, .katex, .math-inline')) return;
          const text = textNode.nodeValue;
          if (!text || !text.trim()) return;

          const fragment = document.createDocumentFragment();
          let word = null;
          for (const { segment } of graphemeSegmenter.segment(text)) {
            if (/^\s+$/u.test(segment)) {
              if (word) {
                fragment.appendChild(word);
                word = null;
              }
              fragment.appendChild(document.createTextNode(segment));
              continue;
            }
            if (!word) {
              word = document.createElement('span');
              word.className = 'floating-word';
            }
            const glyph = document.createElement('span');
            glyph.className = 'floating-glyph';
            glyph.style.setProperty('--glyph-phase', String(glyphIndex++ % 19));
            glyph.textContent = segment;
            word.appendChild(glyph);
          }
          if (word) fragment.appendChild(word);
          textNode.replaceWith(fragment);
        });

        heading.querySelectorAll('.katex:not(.floating-math-unit)').forEach((math, index) => {
          math.classList.add('floating-math-unit');
          math.style.setProperty('--glyph-phase', String((glyphIndex + index) % 19));
        });
        this._observePanelGlyphs(heading);
      });
    });
  }

  _initPanelGlyphObservers() {
    if (!this.panel || typeof IntersectionObserver !== 'function') return;
    this.panel.querySelectorAll('.panel-content-viewport').forEach((viewport) => {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          target.classList.toggle('glyph-in-view', isIntersecting);
          if (isIntersecting) this._visiblePanelGlyphs.add(target);
          else {
            this._visiblePanelGlyphs.delete(target);
            target.classList.remove('glyph-animate');
          }
        });
        this._schedulePanelGlyphAnimation();
      }, { root: viewport, threshold: 0 });
      this._panelGlyphObservers.set(viewport, observer);
    });
  }

  _observePanelGlyphs(scope) {
    const selector = '.floating-glyph:not(.glyph-observed), .floating-math-unit:not(.glyph-observed)';
    const targets = [
      ...(scope.matches(selector) ? [scope] : []),
      ...scope.querySelectorAll(selector)
    ];
    targets.forEach((target) => {
      const viewport = target.closest('.panel-content-viewport');
      const observer = viewport ? this._panelGlyphObservers.get(viewport) : null;
      if (!observer) {
        target.classList.add('glyph-in-view');
        this._visiblePanelGlyphs.add(target);
        return;
      }
      target.classList.add('glyph-observed');
      this._glyphObserverByTarget.set(target, observer);
      observer.observe(target);
    });
    this._schedulePanelGlyphAnimation();
  }

  _schedulePanelGlyphAnimation() {
    if (!this._shouldAnimate() || !this.panel?.classList.contains('open')
      || this.panel.classList.contains('prologue-reading')
      || this._glyphAnimationTimer || this._activeGlyphBatch.length) return;
    const headings = new Set();
    this._visiblePanelGlyphs.forEach((target) => {
      const heading = target.closest('.glyph-heading');
      if (heading?.isConnected && target.classList.contains('glyph-in-view')) headings.add(heading);
    });
    const candidates = Array.from(headings);
    if (!candidates.length) return;

    const heading = candidates[this._glyphAnimationCursor % candidates.length];
    this._glyphAnimationCursor = (this._glyphAnimationCursor + 1) % candidates.length;
    const batch = Array.from(heading.querySelectorAll(
      '.floating-glyph.glyph-in-view, .floating-math-unit.glyph-in-view'
    )).slice(0, 96);
    if (!batch.length) return;
    this._activeGlyphBatch = batch;
    batch.forEach((target) => target.classList.add('glyph-animate'));
    this._glyphAnimationTimer = window.setTimeout(() => {
      this._activeGlyphBatch.forEach((target) => target.classList.remove('glyph-animate'));
      this._activeGlyphBatch = [];
      this._glyphAnimationTimer = window.setTimeout(() => {
        this._glyphAnimationTimer = 0;
        this._schedulePanelGlyphAnimation();
      }, 12000 + Math.random() * 8000);
    }, 2600);
  }

  _clearPanelGlyphAnimation() {
    if (this._glyphAnimationTimer) window.clearTimeout(this._glyphAnimationTimer);
    this._glyphAnimationTimer = 0;
    this._activeGlyphBatch.forEach((target) => target.classList.remove('glyph-animate'));
    this._activeGlyphBatch = [];
  }

  _unobservePanelGlyphs(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const targets = [
      ...(root.matches('.glyph-observed') ? [root] : []),
      ...root.querySelectorAll('.glyph-observed')
    ];
    targets.forEach((target) => {
      this._glyphObserverByTarget.get(target)?.unobserve(target);
      this._glyphObserverByTarget.delete(target);
      this._visiblePanelGlyphs.delete(target);
      target.classList.remove('glyph-observed', 'glyph-in-view', 'glyph-animate');
    });
    this._schedulePanelGlyphAnimation();
  }

  _observe() {
    if (!this.panel) return;
    const own = '.choice-glider, input[type="range"], .floating-glyph, .floating-math-unit';
    new MutationObserver((mutations) => {
      // Ignore the changes this class makes itself (glider placement, slider fill)
      if (mutations.every((m) => m.target.nodeType === 1 && m.target.matches(own))) return;
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target === this.panel
          && mutation.attributeName === 'class') {
          if (this.panel.classList.contains('open')) this._schedulePanelGlyphAnimation();
          else this._clearPanelGlyphAnimation();
          return;
        }
        if (mutation.type === 'childList') {
          mutation.removedNodes.forEach((node) => this._unobservePanelGlyphs(node));
        }
        if (mutation.type !== 'childList' && mutation.type !== 'characterData') return;
        const target = mutation.target.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target.parentElement;
        if (!target || !target.closest('.floating-panel')) return;
        if (!this._panelTextScopes) this._panelTextScopes = new Set();
        this._panelTextScopes.add(target);
      });
      if (!this._raf) {
        this._raf = requestAnimationFrame(() => {
          this._raf = 0;
          this._initAll();
          const scopes = this._panelTextScopes;
          this._panelTextScopes = null;
          scopes?.forEach((scope) => this.refreshPanelText(scope));
        });
      }
    }).observe(this.panel, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }
}
