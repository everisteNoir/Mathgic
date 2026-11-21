/**
 * SpellManager.js — Plug-and-Play Mathematical Spell Plugin Manager
 * Automatically builds toggle switches and parameter sliders for any registered spell module.
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

  /**
   * Register a new mathematical spell module into the Grimoire
   */
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

    card.innerHTML = `
      <div class="spell-card-header">
        <div>
          <div class="spell-title">${spell.icon || '✦'} ${spell.name}</div>
          <div class="spell-desc">${spell.description}</div>
        </div>
        <label class="spell-toggle" title="Toggle Spell">
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

    this.containerEl.appendChild(card);
  }
}
