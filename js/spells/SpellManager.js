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
        if ((spell.active || spell.leaving) && typeof spell.onUpdate === 'function') {
          spell.onUpdate(elapsed, delta);
        }
        // A spell with an outro stays alive until its exit animation finishes, then it is really removed
        if (spell.leaving) {
          spell._leaveT += delta;
          if (spell._leaveT >= spell.outroDuration) {
            spell.leaving = false;
            spell.onDeactivate?.(this.engine, this.eventBus);
          }
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
    spell.leaving = false;
    spell.wanted = false; // for userToggle spells: the user's own on/off choice
    spell.params = {};
    if (Array.isArray(spell.controls)) {
      spell.controls.forEach((c) => {
        spell.params[c.id] = c.default;
      });
    }

    this.spells.set(spell.id, spell);
    this._renderSpellCard(spell);
  }

  setSpellActive(spellId, isActive, { instant = false } = {}) {
    const spell = this.spells.get(spellId);
    if (!spell) return;

    // Skip a running exit animation when asked to remove right now
    if (!isActive && instant && spell.leaving) {
      spell.leaving = false;
      spell.onDeactivate?.(this.engine, this.eventBus);
      return;
    }
    if (spell.active === isActive) return;

    // Spells with an exit animation: turn off now, but really remove only after the outro has played
    if (!isActive && spell.outroDuration && !instant) {
      spell.active = false;
      spell.leaving = true;
      spell._leaveT = 0;
      this._paintCard(spell, false);
      spell.onOutro?.(this.engine, this.eventBus);
      this.eventBus.emit('SPELL_TOGGLED', { spellId, active: false });
      return;
    }

    // Re-summoned while still leaving: finish the old instance first
    if (isActive && spell.leaving) {
      spell.leaving = false;
      spell.onDeactivate?.(this.engine, this.eventBus);
    }

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
    this._paintCard(spell, isActive);

    if (isActive) {
      spell.onActivate?.(this.engine, this.eventBus);
    } else {
      spell.onDeactivate?.(this.engine, this.eventBus);
    }

    this.eventBus.emit('SPELL_TOGGLED', { spellId, active: isActive });
  }

  _paintCard(spell, isActive) {
    const card = this.containerEl.querySelector(`[data-spell-id="${spell.id}"]`);
    if (!card) return;
    card.classList.toggle('active', isActive);
    const btn = card.querySelector('.summon-btn');
    if (btn) {
      btn.textContent = isActive ? 'Dismiss Twin' : 'Summon Twin';
      btn.classList.toggle('active', isActive);
    }
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
    const summon = spell.userToggle
      ? '<button type="button" class="summon-btn">Summon Twin</button>'
      : '';
    const tagClass = spell.isolateStage ? 'spell-tag portal' : 'spell-tag';

    card.innerHTML = `
      <div class="spell-card-header">
        <div>
          <div class="spell-title">${spell.name}</div>
          <span class="${tagClass}">${tagLabel}</span>
          <div class="spell-desc">${spell.description}</div>
        </div>
      </div>
      ${summon}
      <div class="spell-controls"></div>
    `;

    card.querySelector('.summon-btn')?.addEventListener('click', () => {
      spell.wanted = !spell.wanted;
      this.setSpellActive(spell.id, spell.wanted);
    });

    const controlsWrap = card.querySelector('.spell-controls');
    const rows = [];
    // Controls may define showWhen(params) to appear only in certain modes
    const refreshRows = () => {
      rows.forEach((r) => {
        r.style.display = r._ctrl.showWhen && !r._ctrl.showWhen(spell.params) ? 'none' : '';
      });
    };

    if (Array.isArray(spell.controls)) {
      spell.controls.forEach((ctrl) => {
        const row = document.createElement('div');
        row._ctrl = ctrl;

        if (ctrl.type === 'choice') {
          // Segmented buttons: one option selected at a time
          row.innerHTML = `
            <div class="control-header"><label>${ctrl.label}</label></div>
            <div class="choice-group"></div>
          `;
          const group = row.querySelector('.choice-group');
          ctrl.options.forEach((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'choice-btn' + (opt.value === ctrl.default ? ' active' : '');
            btn.textContent = opt.label;
            btn.addEventListener('click', () => {
              spell.params[ctrl.id] = opt.value;
              group.querySelectorAll('.choice-btn').forEach((b) => b.classList.toggle('active', b === btn));
              spell.onParamChange?.(ctrl.id, opt.value);
              refreshRows();
            });
            group.appendChild(btn);
          });
        } else if (ctrl.type === 'toggle') {
          // Single On/Off button
          row.innerHTML = `
            <div class="control-header"><label>${ctrl.label}</label></div>
            <div class="choice-group"><button type="button" class="choice-btn"></button></div>
          `;
          const btn = row.querySelector('button');
          const paint = () => {
            btn.textContent = spell.params[ctrl.id] ? 'On' : 'Off';
            btn.classList.toggle('active', !!spell.params[ctrl.id]);
          };
          paint();
          btn.addEventListener('click', () => {
            spell.params[ctrl.id] = !spell.params[ctrl.id];
            paint();
            spell.onParamChange?.(ctrl.id, spell.params[ctrl.id]);
            refreshRows();
          });
        } else {
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
            refreshRows();
          });
        }
        rows.push(row);
        controlsWrap.appendChild(row);
      });
      refreshRows();
    }

    if (spell.hasLiveReadout) {
      const readout = document.createElement('div');
      readout.className = 'spell-live-readout';
      readout.textContent = spell.initialReadout || '';
      spell._readoutEl = readout;
      controlsWrap.appendChild(readout);
    }

    // Each spell lives in its own section panel (#panel-<spellId>); fall back to the container if missing
    const slot = this.containerEl.querySelector(`#panel-${spell.id}`) || this.containerEl;
    slot.appendChild(card);
  }
}
