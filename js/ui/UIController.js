/**
 * UIController.js — chapter controls, geometric feedback audio and URL state.
 */
import { fxState } from '../core/FXState.js?v=13';
import { FantasyUI } from './FantasyUI.js?v=13';

export class UIController {
  constructor(engine, eventBus, audioEngine, spellManager) {
    this.engine = engine;
    this.eventBus = eventBus;
    this.audio = audioEngine;
    this.spellManager = spellManager;
    this.lastEdgeAudioTime = 0;
    this.grimoire = null;
    this.fantasy = new FantasyUI(audioEngine);

    this._cacheDOM();
    this._bindEvents();
    this._bindEngineFeedback();
  }

  _cacheDOM() {
    this.btnAudio = document.getElementById('btn-audio');
    this.audioLabel = document.getElementById('audio-label');
    this.fxButtons = document.querySelectorAll('[data-fx-toggle]');
    this.btnShare = document.getElementById('btn-share');
    this.btnPulse = document.getElementById('btn-element-pulse');

    this.sliderUnfold = document.getElementById('slider-unfold');
    this.valUnfold = document.getElementById('val-unfold');

    this.infoBadge = document.getElementById('info-element-badge');
    this.infoName = document.getElementById('info-solid-name');
    this.infoPhilosophy = document.getElementById('info-philosophy');
    this.statV = document.getElementById('stat-v');
    this.statE = document.getElementById('stat-e');
    this.statF = document.getElementById('stat-f');
    this.infoFaceShape = document.getElementById('info-face-shape');
    this.infoTip = document.getElementById('info-interaction-tip');


    this.toastEl = document.getElementById('toast');
  }

  _bindEvents() {
    // Effects switch (a pill in the corner and a button on the Prologue page): remembered between visits
    const paintFx = () => {
      const text = fxState.enabled ? 'FX: On' : 'FX: Off';
      this.fxButtons.forEach((b) => {
        const label = b.querySelector('[data-fx-label]');
        (label || b).textContent = text;
      });
    };
    paintFx();
    fxState.applyToBody();
    this.fxButtons.forEach((b) =>
      b.addEventListener('click', () => {
        const on = fxState.toggle();
        paintFx();
        this.showToast(on ? 'Visual effects awakened' : 'Static mode: effects are resting');
      })
    );

    this.btnAudio.addEventListener('click', () => {
      const enabled = this.audio.toggle();
      this.audioLabel.textContent = enabled ? 'Sound: Resonant' : 'Sound: Silent';
      this.showToast(enabled ? 'Harmonic geometric audio enabled' : 'Audio muted');
    });

    this.sliderUnfold.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      this.valUnfold.textContent = `${Math.round(v * 100)}%`;
      this.engine.setUnfold(v);
    });
    this.sliderUnfold.addEventListener('change', () => this.syncURLState());

    this.btnPulse.addEventListener('click', () => {
      this.engine.triggerPulse();
      this.audio.playResonance(this.engine.activeSolid?.meta.baseFreq || 160);
    });

    this.btnShare.addEventListener('click', async () => {
      this.syncURLState();
      try {
        await navigator.clipboard.writeText(window.location.href);
        this.showToast('Link to current Mathgic state copied!');
      } catch {
        this.showToast('State updated in browser address bar!');
      }
    });
  }

  _bindEngineFeedback() {
    this.eventBus.on('SOLID_CHANGED', ({ solidId, meta, geoData }) => {
      [this.infoBadge, this.infoName, this.infoPhilosophy, this.infoFaceShape, this.infoTip].forEach((el) =>
        this.fantasy.retrigger(el)
      );
      this.infoBadge.textContent = `${meta.element.toUpperCase()} • ${meta.elementGreek}`;
      this.infoBadge.style.color = meta.secondaryColor;
      this.infoName.textContent = meta.name;
      this.infoPhilosophy.textContent = meta.philosophy;
      this.infoPhilosophy.style.borderLeftColor = meta.secondaryColor;

      this.statV.textContent = geoData.vertices.length;
      this.statE.textContent = geoData.edges.length;
      this.statF.textContent = geoData.faces.length;
      this.infoFaceShape.textContent = meta.faceShape;
      this.infoTip.textContent = meta.interactionTip;
    });

    // Geometric hover feedback is intentionally no longer shown in a telemetry HUD.
    // Keep the polyhedral edge chime as the lightweight tactile feedback.
    this.eventBus.on('EDGE_HOVER', ({ edgeVertices }) => {
      const now = performance.now();
      if (now - this.lastEdgeAudioTime > 180) {
        this.audio.playChime(edgeVertices[0] + edgeVertices[1], 0.06);
        this.lastEdgeAudioTime = now;
      }
    });

    this.eventBus.on('FACE_CLICK', ({ faceIndex }) => {
      this.audio.playChime(faceIndex, 0.12);
      this.showToast(`Aligned camera view with Face #${faceIndex + 1}`);
    });

    this.eventBus.on('CHARGE_RELEASE', ({ energy }) => {
      const meta = this.engine.activeSolid?.meta;
      this.audio.playRelease(meta?.baseFreq, energy);
    });

    this.eventBus.on('ENERGY_UPDATE', ({ energy }) => {
      this.audio.setCharge(energy, this.engine.activeSolid?.meta?.baseFreq);
    });

    this.eventBus.on('SPELL_TOGGLED', ({ spellId, active }) => {
      const spell = this.spellManager.spells.get(spellId);
      if (active && spell?.isolateStage) {
        this.showToast(`Opened ${spell.name} — Platonic frame tucked away to prevent overlap`);
      }
      this.syncURLState();
    });
  }

  /** The book decides the chapter and page; the controller mirrors them into the share link. */
  attachGrimoire(grimoire) {
    this.grimoire = grimoire;
    grimoire.onChange = () => this.syncURLState();
  }

  syncURLState() {
    const params = new URLSearchParams();
    if (this.engine.activeSolid) {
      params.set('solid', this.engine.activeSolid.solidId);
    }
    const unfold = this.engine.uniforms.uUnfold.value;
    if (unfold > 0.01) {
      params.set('unfold', unfold.toFixed(2));
    }
    const { section, page } = this.grimoire.state();
    if (section !== 'polyhedra') {
      params.set('section', section);
      if (page > 0) params.set('page', page);
    }
    if (this.spellManager.spells.get('dual-morph')?.wanted) {
      params.set('dual', '1');
    }
    window.history.replaceState(null, '', `#${params.toString()}`);
  }

  restoreFromURL() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) {
      this.engine.loadSolid('tetrahedron');
      this.grimoire.restore({});
      return;
    }
    const params = new URLSearchParams(hash);
    const solidId = params.get('solid') || 'tetrahedron';
    this.engine.loadSolid(solidId);

    const unfold = parseFloat(params.get('unfold'));
    if (!Number.isNaN(unfold) && unfold >= 0 && unfold <= 1) {
      this.sliderUnfold.value = unfold;
      this.valUnfold.textContent = `${Math.round(unfold * 100)}%`;
      this.engine.setUnfold(unfold);
    }

    // Older links: 'spells=dual-morph' or 'section=dual-morph' now mean "Polyhedra with the Dual Twin on"
    const legacy = (params.get('spells') || '').split(',')[0];
    const requested = params.get('section') || legacy || 'polyhedra';
    const dual = this.spellManager.spells.get('dual-morph');
    if (dual && (params.get('dual') === '1' || requested === 'dual-morph')) dual.wanted = true;
    this.grimoire.restore({ section: requested, page: params.get('page'), solid: solidId });
  }

  showToast(message) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 2800);
  }
}
