import { fxState } from '../core/FXState.js?v=13';
import { CurvedBook3D } from './CurvedBook3D.js?v=13';

const SOLIDS = [
  { id: 'tetrahedron', greek: 'PYR', name: 'Fire', accent: '#ff5722', secondary: '#fbbf24' },
  { id: 'cube', greek: 'GĒ', name: 'Earth', accent: '#10b981', secondary: '#a7f3d0' },
  { id: 'octahedron', greek: 'AĒR', name: 'Air', accent: '#38bdf8', secondary: '#e0f2fe' },
  { id: 'icosahedron', greek: 'HYDŌR', name: 'Water', accent: '#3b82f6', secondary: '#93c5fd' },
  { id: 'dodecahedron', greek: 'KOSMOS', name: 'Aether', accent: '#c084fc', secondary: '#fde68a' }
];

// Chapters in reading order. Spell chapters take their pages from the spell's page control (an option list).
const CHAPTERS = [
  { id: 'prologue', letter: 'α', title: 'Prologue' },
  { id: 'polyhedra', letter: 'Δ', title: 'Polyhedra' },
  { id: 'golden-ratio', letter: 'φ', title: 'Golden Ratio', spell: 'golden-ratio', pageControl: 'mode' },
  { id: 'projection', letter: 'π', title: 'Projection', spell: 'projection', pageControl: 'mode' },
  { id: 'infinity', letter: 'ℵ', title: 'Infinity', spell: 'infinity', pageControl: 'page' },
  { id: 'non-euclidean', letter: 'κ', title: 'Non-Euclidean', spell: 'non-euclidean' }
];

/**
 * Grimoire.js — static 3D book, physical page turns, and floating arcane interfaces.
 * Reading content and controls live as unboxed text on either side of the central book.
 */
export class Grimoire {
  constructor({ engine, eventBus, audio, spellManager, fantasy }) {
    this.engine = engine;
    this.eventBus = eventBus;
    this.audio = audio;
    this.spells = spellManager;
    this.fantasy = fantasy;

    this.el = document.getElementById('grimoire');
    this.cover = document.getElementById('book-cover');
    this.bookStage = document.getElementById('book-3d-stage');
    this.leftInner = document.getElementById('page-left');
    this.rightInner = document.getElementById('page-right');
    this.chapterRibbons = document.getElementById('chapter-ribbons');
    this.pageRibbons = document.getElementById('page-ribbons');
    this.leftChapterHeading = document.getElementById('left-chapter-heading');
    this.rightChapterHeading = document.getElementById('right-chapter-heading');
    this.store = document.getElementById('page-store');
    this.leftPanelCrown = document.querySelector('#floating-left .crown-label');
    this.rightPanelCrown = document.querySelector('#floating-right .crown-label');

    this.index = -1; // flat page index
    this.activeChapterId = null;
    this.opened = false;
    this.onChange = null;
    this.lastPage = {}; // chapter id -> page index within the chapter

    this.book3D = new CurvedBook3D(this.engine, this.bookStage, {
      onPrev: () => this.prev(),
      onNext: () => this.next()
    });

    this._buildPages();
    this._buildDualBlock();
    this._buildChapterRibbons();
    this._bind();
  }

  // ------------------------------------------------------------------ structure
  _buildPages() {
    this.chapters = [];
    this.pages = [];
    const polyLeft = document.getElementById('pg-poly-left');
    const polyRight = document.getElementById('pg-poly-right');

    for (const def of CHAPTERS) {
      const chapter = { ...def, pages: [] };
      if (def.id === 'prologue') {
        chapter.pages.push({
          label: 'Introduction',
          left: document.getElementById('pg-prologue-left'),
          right: document.getElementById('pg-prologue-right')
        });
        chapter.pages.push({
          label: 'References',
          isReferences: true,
          left: document.getElementById('pg-prologue-ref-left'),
          right: document.getElementById('pg-prologue-ref-right')
        });
      } else if (def.id === 'polyhedra') {
        SOLIDS.forEach((s) =>
          chapter.pages.push({
            label: s.name,
            sub: s.greek,
            accent: s.accent,
            secondary: s.secondary,
            solid: s.id,
            left: polyLeft,
            right: polyRight
          })
        );
      } else {
        const spell = this.spells.spells.get(def.spell);
        const pageCtrl = def.pageControl ? spell.controls.find((c) => c.id === def.pageControl) : null;
        const defs = pageCtrl
          ? pageCtrl.options.map((o) => ({ label: o.label, value: o.value, legend: o.legend, formula: o.formula, note: o.note }))
          : [{ label: def.title, legend: spell.description }];
        defs.forEach((d) => {
          const page = { ...d, spell, pageControl: def.pageControl || null };
          this._buildSpellPage(chapter, page);
          chapter.pages.push(page);
        });
      }
      chapter.pages.forEach((p, i) => {
        p.chapter = chapter;
        p.indexInChapter = i;
        p.flat = this.pages.length;
        this.pages.push(p);
      });
      this.chapters.push(chapter);
    }
  }

  _buildSpellPage(chapter, page) {
    const left = document.createElement('div');
    left.className = 'page-face';
    left.dataset.real = '';
    left.innerHTML = `
      <h3 class="page-title"></h3>
      <p class="legend"></p>
      <div class="concept-formula" hidden></div>
      <p class="concept-note" hidden></p>
    `;
    left.querySelector('.page-title').textContent = page.label;
    left.querySelector('.legend').textContent = page.legend || page.spell.description;
    if (page.formula) {
      const formula = left.querySelector('.concept-formula');
      formula.hidden = false;
      formula.textContent = page.formula;
    }
    if (page.note) {
      const note = left.querySelector('.concept-note');
      note.hidden = false;
      note.textContent = page.note;
    }
    if (page.spell.hasLiveReadout) {
      const readout = document.createElement('div');
      readout.className = 'spell-live-readout';
      readout.textContent = page.spell.initialReadout || '';
      left.appendChild(readout);
      page.readoutEl = readout;
    }
    const right = document.createElement('div');
    right.className = 'page-face';
    right.dataset.real = '';
    const controls = this.spells.buildControls(page.spell, page.pageControl, page.value);
    right.appendChild(controls.el);
    page.left = left;
    page.right = right;
    page.refresh = controls.refresh;
    this.store.append(left, right);
  }

  _buildDualBlock() {
    const dual = this.spells.spells.get('dual-morph');
    const block = document.getElementById('dual-block');
    const btn = document.getElementById('btn-summon');
    document.getElementById('dual-controls').appendChild(this.spells.buildControls(dual).el);
    const paint = (on) => {
      block.classList.toggle('on', on);
      btn.textContent = on ? 'Dismiss Twin' : 'Summon Twin';
    };
    btn.addEventListener('click', () => {
      dual.wanted = !dual.wanted;
      this.spells.setSpellActive('dual-morph', dual.wanted);
    });
    this.eventBus.on('SPELL_TOGGLED', ({ spellId, active }) => {
      if (spellId === 'dual-morph') paint(active);
    });
  }

  _buildChapterRibbons() {
    this.chapters.forEach((ch, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab chapter-tab';
      b.dataset.chapter = ch.id;
      // Accessible label remains available to screen readers; no visible name or native tooltip.
      b.removeAttribute('title');
      b.setAttribute('aria-label', ch.title);
      b.setAttribute('aria-current', 'false');
      b.innerHTML = `<span class="tab-orb"><span class="tab-letter">${ch.letter}</span></span>`;
      b.addEventListener('click', () => this.goToChapter(ch.id));
      this.chapterRibbons.appendChild(b);
    });
  }

  _renderPageRibbons() {
    const ch = this.pages[this.index].chapter;
    this.pageRibbons.replaceChildren();
    if (ch.pages.length < 2) return;
    ch.pages.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab page-tab';
      if (p.accent) b.style.setProperty('--accent', p.accent);
      b.innerHTML = p.sub
        ? `<span class="tab-letter">${p.sub}</span><span class="tab-name">${p.label}</span>`
        : `<span class="tab-name">${p.label}</span>`;
      b.addEventListener('click', () => this.goTo(p.flat));
      this.pageRibbons.appendChild(b);
    });
  }

  _paintRibbons() {
    const page = this.pages[this.index];
    this.chapterRibbons.querySelectorAll('.tab').forEach((b) => {
      const active = b.dataset.chapter === page.chapter.id;
      b.classList.toggle('active', active);
      b.setAttribute('aria-current', active ? 'page' : 'false');
    });
    this.pageRibbons.querySelectorAll('.tab').forEach((b, i) =>
      b.classList.toggle('active', i === page.indexInChapter)
    );
  }

  /** Maps the active chapter/page to an ethereal visual aura for the 3D curved book & levitating panels. */
  _themeForPage(page) {
    const chId = page.chapter.id;
    if (chId === 'prologue') {
      return { id: 'astral', primary: '#f59e0b', secondary: '#38bdf8' };
    }
    if (chId === 'polyhedra') {
      return {
        id: 'elemental',
        primary: page.accent || '#ff5722',
        secondary: page.secondary || '#fbbf24'
      };
    }
    if (chId === 'golden-ratio') {
      return { id: 'golden', primary: '#f59e0b', secondary: '#fde68a' };
    }
    if (chId === 'projection') {
      return { id: 'projection', primary: '#38bdf8', secondary: '#c084fc' };
    }
    if (chId === 'infinity') {
      return { id: 'infinity', primary: '#a78bfa', secondary: '#55d8ff' };
    }
    if (chId === 'non-euclidean') {
      return { id: 'non-euclidean', primary: '#10b981', secondary: '#38bdf8' };
    }
    return { id: 'astral', primary: '#fbbf24', secondary: '#38bdf8' };
  }

  _applyThemeVars(theme) {
    if (!this.el || !theme) return;
    this.el.style.setProperty('--grimoire-accent', theme.primary || '#fbbf24');
    this.el.style.setProperty('--grimoire-secondary', theme.secondary || '#38bdf8');
    this.el.dataset.chapter = this.activeChapterId || 'prologue';
  }

  // ------------------------------------------------------------------ open / close
  open() {
    if (this.opened) return;
    this.opened = true;
    this.el.classList.replace('closed', 'open');
    this.cover.setAttribute('aria-expanded', 'true');
    this.book3D.setOpen(true);
    if (this.index >= 0) {
      const theme = this._themeForPage(this.pages[this.index]);
      this._applyThemeVars(theme);
      this.book3D.setTheme(theme);
    }
    requestAnimationFrame(() => {
      this.book3D.resize();
      this._updateBookMetrics();
    });
    this.audio.playFlip();
  }

  close() {
    if (!this.opened) return;
    this.book3D.finishFlip({ render: false });
    this.opened = false;
    this.book3D.setOpen(false);
    this.el.classList.replace('open', 'closed');
    this.cover.setAttribute('aria-expanded', 'false');
    this._updateBookMetrics();
  }

  toggle() {
    this.opened ? this.close() : this.open();
  }

  _updateBookMetrics() {
    document.body.classList.toggle('book-is-open', this.opened);
    this.engine.setBookView(0, 1);
    this.book3D.updateAnchor();
  }

  _updateChapterHeadings(page) {
    if (!page?.chapter) return;
    const chapterIndex = this.chapters.findIndex((chapter) => chapter.id === page.chapter.id);
    const chapterNumber = String(Math.max(1, chapterIndex + 1)).padStart(2, '0');
    [this.leftChapterHeading, this.rightChapterHeading].forEach((heading) => {
      if (!heading) return;
      const symbol = heading.querySelector('.chapter-heading-symbol');
      const kicker = heading.querySelector('.chapter-heading-kicker');
      const name = heading.querySelector('.chapter-heading-name');
      if (symbol) symbol.textContent = page.chapter.letter;
      if (kicker) kicker.textContent = `CHAPTER ${chapterNumber}`;
      if (name) name.textContent = page.chapter.title.toUpperCase();
      heading.dataset.chapter = page.chapter.id;
    });
  }

  // ------------------------------------------------------------------ navigation
  goToChapter(chapterId) {
    const ch = this.chapters.find((c) => c.id === chapterId);
    if (!ch) return;
    const idx = this.lastPage[ch.id] ?? 0;
    this.goTo(ch.pages[Math.min(idx, ch.pages.length - 1)].flat);
  }

  goTo(i, { instant = false } = {}) {
    i = Math.max(0, Math.min(this.pages.length - 1, i));
    if (i === this.index) return;

    const dir = i > this.index ? 1 : -1;
    const animate = this.opened && this.index >= 0 && !instant;
    const page = this.pages[i];
    const prevChapter = this.activeChapterId;
    const chapterChanged = page.chapter.id !== prevChapter;

    this.index = i;
    this._enter(page);
    if (chapterChanged || !this.pageRibbons.childElementCount) this._renderPageRibbons();
    this._paintRibbons();
    this.lastPage[page.chapter.id] = page.indexInChapter;

    const nextTheme = this._themeForPage(page);
    this._applyThemeVars(nextTheme);

    // Switch side content as a pair: both spatial panes leave, swap together, and re-enter.
    const shouldSwap = animate;
    const contents = [this.leftInner, this.rightInner];
    const headings = [this.leftChapterHeading, this.rightChapterHeading];
    const transitionNodes = chapterChanged ? [...headings, ...contents] : contents;
    const swapContent = () => this._mount(page);

    if (shouldSwap && chapterChanged && this.fantasy.transitionChapterPanels) {
      this.fantasy.transitionChapterPanels(
        headings,
        contents,
        () => this._updateChapterHeadings(page),
        swapContent
      );
    } else if (shouldSwap && this.fantasy.transitionPanels) {
      this.fantasy.transitionPanels(contents, swapContent);
    } else {
      this.fantasy.cancelPanelTransition?.(transitionNodes);
      if (chapterChanged) this._updateChapterHeadings(page);
      swapContent();
    }

    if (animate) {
      this.book3D.triggerFlip(dir, nextTheme);
      this.audio.playFlip();
    } else {
      this.book3D.setTheme(nextTheme);
    }

    if (animate && chapterChanged) {
      this.fantasy.chapterTransition?.(nextTheme);
    } else if (this.opened && fxState.enabled) {
      this.fantasy.retrigger(this.leftInner, 'swap');
      this.fantasy.retrigger(this.rightInner, 'swap');
    }

    this.onChange?.();
  }

  next() { this.goTo(this.index + 1); }
  prev() { this.goTo(this.index - 1); }

  /** Switches the 3D stage and the spells to match the page now being read. */
  _enter(page) {
    const ch = page.chapter;
    const spell = page.spell || null;
    if (spell && page.pageControl) spell.params[page.pageControl] = page.value;

    this.engine.setHoldInteractionEnabled(ch.id === 'polyhedra');

    if (ch.id !== this.activeChapterId) {
      const first = this.activeChapterId !== null;
      this.activeChapterId = ch.id;
      const stageSpell = ch.spell ? this.spells.spells.get(ch.spell) : null;
      this.engine.setStageSolidVisible(!stageSpell?.isolateStage);
      for (const s of this.spells.spells.values()) {
        if (s.userToggle) {
          this.spells.setSpellActive(s.id, !stageSpell && s.wanted, { instant: !!stageSpell });
        } else if (s !== stageSpell) {
          this.spells.setSpellActive(s.id, false);
        }
      }
      if (stageSpell) this.spells.setSpellActive(stageSpell.id, true);
      document.body.dataset.stage = stageSpell?.isolateStage ? 'portal' : 'solid';
      // Chapter-level portal transition is triggered after both content panes are staged in goTo().
    } else if (spell && page.pageControl) {
      spell.onParamChange?.(page.pageControl, page.value);
    }

    if (page.solid && this.engine.activeSolid?.solidId !== page.solid) {
      this.engine.setManualSolidVisible(true);
      this.engine.loadSolid(page.solid);
      this.audio.playResonance(this.engine.activeSolid?.meta.baseFreq || 150);
    }
    if (spell) {
      spell._readoutEl = page.readoutEl || null;
      page.refresh?.();
      spell._updateReadout?.();
    }
  }

  // ------------------------------------------------------------------ mounting to floating side panels
  _unmount(container) {
    Array.from(container.children).forEach((c) => {
      if ('real' in c.dataset) this.store.appendChild(c);
      else c.remove();
    });
  }

  _mount(page) {
    this._unmount(this.leftInner);
    this._unmount(this.rightInner);
    this.leftInner.appendChild(page.left);
    this.rightInner.appendChild(page.right);

    const isReferences = !!page.isReferences;
    if (this.leftPanelCrown) this.leftPanelCrown.textContent = isReferences ? 'Selected Reading' : 'Arcane Knowledge';
    if (this.rightPanelCrown) this.rightPanelCrown.textContent = isReferences ? 'Source Notes' : 'Spell Controls';
    this.el.dataset.page = `${page.chapter.id}-${page.indexInChapter}`;
  }

  // ------------------------------------------------------------------ input
  _bind() {
    this.cover.addEventListener('click', () => this.open());
    document.getElementById('book-close').addEventListener('click', () => this.close());

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        this.close();
        return;
      }
      if (!this.opened) {
        if (e.key === 'Enter' && document.activeElement === document.body) this.open();
        return;
      }
      const t = e.target;
      const typing = t instanceof HTMLElement && t.matches('input, textarea, select');
      if (!typing && e.key === 'ArrowRight') this.next();
      else if (!typing && e.key === 'ArrowLeft') this.prev();
      else if (/^[1-6]$/.test(e.key) && !typing) this.goToChapter(this.chapters[Number(e.key) - 1].id);
    });

    window.addEventListener('resize', () => {
      this.book3D.resize();
      this._updateBookMetrics();
    });
  }

  // ------------------------------------------------------------------ state for share links
  state() {
    const page = this.pages[this.index];
    return { section: page.chapter.id, page: page.indexInChapter };
  }

  /** Opens at the page named by the URL parameters (the book itself stays closed). */
  restore({ section, page, solid }) {
    let ch = this.chapters.find((c) => c.id === section) || this.chapters.find((c) => c.id === 'polyhedra');
    let idx = 0;
    if (ch.id === 'polyhedra') {
      idx = Math.max(0, SOLIDS.findIndex((s) => s.id === solid));
    } else if (ch.pages.length > 1) {
      idx = Math.max(0, Math.min(ch.pages.length - 1, parseInt(page, 10) || 0));
    }
    this.goTo(ch.pages[idx].flat, { instant: true });
  }
}
