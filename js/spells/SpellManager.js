/**
 * SpellManager.js — Plug-and-Play Mathgic Plugin Manager
 * Manages inscribed spells (which nest inside the transparent Platonic solid)
 * and hyper-spatial portals (which isolate the stage so there is zero overlap).
 */
export class SpellManager {
  constructor(engine, eventBus, containerEl) {
    this.engine = engine;
    this.eventBus = eventBus;
    this.containerEl = containerEl;
    this.spells = new Map();

    this.eventBus.on('TICK', ({ elapsed, delta }) => {
      for (const spell of this.spells.values()) {
        if (spell.active && typeof spell.onUpdate === 'function') {
          spell.onUpdate(elapsed, delta);
        }
      }
    });

    this.eventBus.on('SOLID_CHANGED', (payload) => {
      for (const spell of this.spells.values()) {
        if (spell.active && typeof spell.onSolidChanged === 'function') {
          spell.onSolidChanged(payload);
        }
      }
    });
  }

  register(spell) {
    spell.active = false;
    spell.params = {};
    if (Array.isArray(spell.controls)) {
      spell.controls.forEach((c) => {
        spell.params[c.id] = c.default;
      });
    }

    this.spells.set(spell.id, spell);
    this._renderSpellCard(spell);
  }

  setSpellActive(spellId, isActive) {
    const spell = this.spells.get(spellId);
    if (!spell || spell.active === isActive) return;

    // If activating a hyper-spatial portal (e.g., 4D Tesseract or Non-Euclidean Space),
    // automatically deactivate other portals and isolate the stage so nothing collides
    if (isActive && spell.isolateStage) {
      for (const other of this.spells.values()) {
        if (other.id !== spellId && other.active && other.isolateStage) {
          this.setSpellActive(other.id, false);
        }
      }
      this.engine.pushPortalIsolation();
    } else if (!isActive && spell.isolateStage) {
      this.engine.popPortalIsolation();
    }

    spell.active = isActive;
    const card = this.containerEl.querySelector(`[data-spell-id="${spellId}"]`);
    if (card) {
      card.classList.toggle('active', isActive);
      const checkbox = card.querySelector('input[type="checkbox"]');
      if (checkbox) checkbox.checked = isActive;
    }

    if (isActive) {
      spell.onActivate?.(this.engine, this.eventBus);
    } else {
      spell.onDeactivate?.(this.engine, this.eventBus);
    }

    this.eventBus.emit('SPELL_TOGGLED', { spellId, active: isActive });
  }

  getActiveSpellIds() {
    return Array.from(this.spells.values())
      .filter((s) => s.active)
      .map((s) => s.id);
  }

  _renderSpellCard(spell) {
    const card = document.createElement('div');
    card.className = 'spell-card';
    card.dataset.spellId = spell.id;

    const tagLabel = spell.isolateStage ? 'HYPER-SPATIAL PORTAL' : 'INSCRIBED GEOMETRY';
    const tagClass = spell.isolateStage ? 'spell-tag portal' : 'spell-tag';

    card.innerHTML = `
      <div class="spell-card-header">
        <div>
          <div class="spell-title">${spell.icon || '✦'} ${spell.name}</div>
          <span class="${tagClass}">${tagLabel}</span>
          <div class="spell-desc">${spell.description}</div>
        </div>
        <label class="spell-toggle" title="Toggle Mathgic Module">
          <input type="checkbox" />
          <span class="spell-toggle-slider"></span>
        </label>
      </div>
      <div class="spell-controls"></div>
    `;

    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
      this.setSpellActive(spell.id, e.target.checked);
    });

    const controlsWrap = card.querySelector('.spell-controls');
    if (Array.isArray(spell.controls)) {
      spell.controls.forEach((ctrl) => {
        const row = document.createElement('div');
        row.innerHTML = `
          <div class="control-header">
            <label>${ctrl.label}</label>
            <span class="control-val">${ctrl.format ? ctrl.format(ctrl.default) : ctrl.default}</span>
          </div>
          <input type="range" min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step}" value="${ctrl.default}" />
        `;
        const input = row.querySelector('input');
        const valSpan = row.querySelector('.control-val');
        input.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          spell.params[ctrl.id] = val;
          valSpan.textContent = ctrl.format ? ctrl.format(val) : val;
          spell.onParamChange?.(ctrl.id, val);
        });
        controlsWrap.appendChild(row);
      });
    }

    if (spell.hasLiveReadout) {
      const readout = document.createElement('div');
      readout.className = 'spell-live-readout';
      readout.textContent = spell.initialReadout || '';
      spell._readoutEl = readout;
      controlsWrap.appendChild(readout);
    }

    this.containerEl.appendChild(card);
  }
}
