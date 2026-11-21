/**
 * UIController.js — User Interface, Telemetry HUD & URL State Serialization
 */
export class UIController {
  constructor(engine, eventBus, audioEngine, spellManager) {
    this.engine = engine;
    this.eventBus = eventBus;
    this.audio = audioEngine;
    this.spellManager = spellManager;
    this.lastEdgeAudioTime = 0;

    this._cacheDOM();
    this._bindEvents();
    this._bindEngineTelemetry();
  }

  _cacheDOM() {
    this.dockItems = document.querySelectorAll('.dock-item');
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.tabContents = document.querySelectorAll('.tab-content');
    this.panel = document.getElementById('grimoire-panel');

    this.btnSolidVis = document.getElementById('btn-solid-vis');
    this.solidVisIcon = document.getElementById('solid-vis-icon');
    this.solidVisLabel = document.getElementById('solid-vis-label');

    this.btnTogglePanel = document.getElementById('btn-toggle-panel');
    this.btnAudio = document.getElementById('btn-audio');
    this.audioIcon = document.getElementById('audio-icon');
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

    this.telType = document.getElementById('telemetry-type');
    this.telMain = document.getElementById('telemetry-main');
    this.telSub = document.getElementById('telemetry-sub');
    this.chargeWrap = document.getElementById('charge-bar-wrap');
    this.chargeFill = document.getElementById('charge-bar-fill');

    this.toastEl = document.getElementById('toast');
  }

  _bindEvents() {
    // Select one of the 5 Platonic solids from bottom dock
    this.dockItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const solidId = btn.dataset.solid;
        // If user clicks a Platonic element while a hyper-spatial portal is active,
        // automatically turn off the portal so they immediately see the selected element
        for (const spell of this.spellManager.spells.values()) {
          if (spell.active && spell.isolateStage) {
            this.spellManager.setSpellActive(spell.id, false);
          }
        }
        this.engine.setManualSolidVisible(true);
        this.engine.loadSolid(solidId);
        this.audio.playResonance(this.engine.activeSolid?.meta.baseFreq || 150);
        this.syncURLState();
      });
    });

    // Toggle Solid Frame Visibility manually
    this.btnSolidVis.addEventListener('click', () => {
      const next = !this.engine.manualSolidVisible;
      this.engine.setManualSolidVisible(next);
      this.showToast(next ? 'Platonic solid frame visible' : 'Platonic solid frame hidden');
    });

    // Switch tabs inside Mathgic Panel
    this.tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        this.tabBtns.forEach((b) => b.classList.toggle('active', b === btn));
        this.tabContents.forEach((c) => c.classList.toggle('active', c.id === target));
      });
    });

    this.btnTogglePanel.addEventListener('click', () => {
      this.panel.classList.toggle('collapsed');
    });

    this.btnAudio.addEventListener('click', () => {
      const enabled = this.audio.toggle();
      this.audioIcon.textContent = enabled ? '🔊' : '🔇';
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

  _bindEngineTelemetry() {
    this.eventBus.on('SOLID_VISIBILITY_CHANGED', ({ visible, autoHidden }) => {
      this.solidVisIcon.textContent = visible ? '👁️' : '🙈';
      this.solidVisLabel.textContent = autoHidden
        ? 'Portal Mode'
        : visible
          ? 'Solid: On'
          : 'Solid: Off';
      this.btnSolidVis.classList.toggle('muted-state', !visible);
    });

    this.eventBus.on('SOLID_CHANGED', ({ solidId, meta, geoData }) => {
      this.dockItems.forEach((b) => b.classList.toggle('active', b.dataset.solid === solidId));

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

    this.eventBus.on('VERTEX_HOVER', ({ vertexIndex, coords }) => {
      this.telType.textContent = `GEOMETRIC VERTEX #${vertexIndex + 1}`;
      this.telMain.textContent = `Coordinates: (${coords.x.toFixed(3)}, ${coords.y.toFixed(3)}, ${coords.z.toFixed(3)})`;
      this.telSub.textContent = 'Convergence point of luminous edges';
    });

    this.eventBus.on('EDGE_HOVER', ({ edgeVertices }) => {
      this.telType.textContent = `LUMINOUS EDGE [${edgeVertices[0] + 1} — ${edgeVertices[1] + 1}]`;
      this.telMain.textContent = 'Harmonic geometric string';
      this.telSub.textContent = 'Plucking harmonic chime proportional to edge length';

      const now = performance.now();
      if (now - this.lastEdgeAudioTime > 180) {
        this.audio.playChime(edgeVertices[0] + edgeVertices[1], 0.06);
        this.lastEdgeAudioTime = now;
      }
    });

    this.eventBus.on('FACE_HOVER', ({ faceIndex }) => {
      this.telType.textContent = `CRYSTAL FACE #${faceIndex + 1}`;
      this.telMain.textContent = 'Click to align camera directly with this face';
      this.telSub.textContent = 'Click & hold to energize the elemental core';
    });

    this.eventBus.on('FACE_CLICK', ({ faceIndex }) => {
      this.audio.playChime(faceIndex, 0.12);
      this.showToast(`Aligned camera view with Face #${faceIndex + 1}`);
    });

    this.eventBus.on('HOVER_CLEAR', () => {
      this.telType.textContent = 'GEOMETRIC EXPLORATION';
      this.telMain.textContent = 'Drag to rotate • Touch vertices, edges, or faces';
      this.telSub.textContent = 'Scroll wheel to zoom in and out of space';
    });

    this.eventBus.on('ENERGY_UPDATE', ({ energy }) => {
      if (energy > 0.02) {
        this.chargeWrap.classList.add('active');
        this.chargeFill.style.width = `${Math.round(energy * 100)}%`;
      } else {
        this.chargeWrap.classList.remove('active');
        this.chargeFill.style.width = '0%';
      }
    });

    this.eventBus.on('SPELL_TOGGLED', ({ spellId, active }) => {
      const spell = this.spellManager.spells.get(spellId);
      if (active && spell?.isolateStage) {
        this.showToast(`Opened ${spell.name} — Platonic frame tucked away to prevent overlap`);
      }
      this.syncURLState();
    });
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
    const spells = this.spellManager.getActiveSpellIds();
    if (spells.length > 0) {
      params.set('spells', spells.join(','));
    }
    window.history.replaceState(null, '', `#${params.toString()}`);
  }

  restoreFromURL() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) {
      this.engine.loadSolid('tetrahedron');
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

    const spells = params.get('spells');
    if (spells) {
      spells.split(',').forEach((id) => this.spellManager.setSpellActive(id, true));
    }
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
