import { renderInlineMathText } from '../core/MathRenderer.js?v=26';

/**
 * SpellManager.js — Plug-and-Play Mathgic Plugin Manager
 * Manages inscribed spells (which nest inside the transparent Platonic solid)
 * and hyper-spatial portals (which isolate the stage so there is zero overlap).
 */
export class SpellManager {
  constructor(engine, eventBus) {
    this.engine = engine;
    this.eventBus = eventBus;
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
      spell.onOutro?.(this.engine, this.eventBus);
      this.eventBus.emit('SPELL_TOGGLED', { spellId, active: false });
      return;
    }

    // Re-summoned while still leaving: finish the old instance first
    if (isActive && spell.leaving) {
      spell.leaving = false;
      spell.onDeactivate?.(this.engine, this.eventBus);
    }

    // If activating a hyper-spatial portal (e.g., Projection or Non-Euclidean Space),
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

  /**
   * Builds the control rows of a spell for one page of the grimoire.
   * pageCtrlId: the control whose options are the book pages (it is not drawn); pageValue: this page's option.
   * Returns { el, refresh }; refresh() re-syncs every row with the spell's parameters and applies showWhen.
   */
  buildControls(spell, pageCtrlId = null, pageValue = null) {
    const wrap = document.createElement('div');
    wrap.className = 'page-controls';
    const rows = [];
    const sections = new Map();
    const ctx = () => (pageCtrlId ? { ...spell.params, [pageCtrlId]: pageValue } : spell.params);
    const setControlText = (element, text) => renderInlineMathText(element, text);
    const getSection = (label) => {
      if (!sections.has(label)) {
        const section = document.createElement('section');
        section.className = 'spell-control-section';
        const heading = document.createElement('h3');
        heading.className = 'spell-control-section-title';
        setControlText(heading, label);
        section.appendChild(heading);
        sections.set(label, { element: section, rows: [] });
        wrap.appendChild(section);
      }
      return sections.get(label);
    };
    const refresh = () => {
      rows.forEach((r) => {
        r._sync?.();
        r.style.display = r._ctrl.showWhen && !r._ctrl.showWhen(ctx()) ? 'none' : '';
      });
      sections.forEach(({ element, rows: sectionRows }) => {
        element.style.display = sectionRows.some((row) => row.style.display !== 'none') ? '' : 'none';
      });
    };

    (spell.controls || []).forEach((ctrl) => {
      if (ctrl.id === pageCtrlId) return;
      const row = document.createElement('div');
      row._ctrl = ctrl;

      row.className = 'control-group spell-control-row';
      const section = ctrl.group ? getSection(ctrl.group) : null;
      if (ctrl.type === 'choice') {
        // Segmented buttons: one option selected at a time
        row.innerHTML = `
          <div class="control-header"><label></label></div>
          <div class="choice-group"></div>
        `;
        setControlText(row.querySelector('label'), ctrl.label);
        const group = row.querySelector('.choice-group');
        ctrl.options.forEach((opt) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'choice-btn';
          setControlText(btn, opt.label);
          btn.addEventListener('click', () => {
            spell.params[ctrl.id] = opt.value;
            spell.onParamChange?.(ctrl.id, opt.value);
            refresh();
          });
          group.appendChild(btn);
        });
        row._sync = () => {
          group.querySelectorAll('.choice-btn').forEach((b, i) =>
            b.classList.toggle('active', ctrl.options[i].value === spell.params[ctrl.id])
          );
        };
      } else if (ctrl.type === 'action') {
        row.innerHTML = `
          <div class="control-header"><label></label></div>
          <button type="button" class="action-btn spell-action-btn"></button>
        `;
        setControlText(row.querySelector('label'), ctrl.label);
        const btn = row.querySelector('button');
        row._sync = () => {
          setControlText(btn, typeof ctrl.buttonLabel === 'function'
            ? ctrl.buttonLabel(spell, ctx())
            : (ctrl.buttonLabel || 'Activate'));
          btn.disabled = typeof ctrl.disabled === 'function' ? !!ctrl.disabled(spell, ctx()) : !!ctrl.disabled;
        };
        btn.addEventListener('click', () => {
          spell.onAction?.(ctrl.id, ctx());
          refresh();
        });
      } else if (ctrl.type === 'toggle') {
        // Single On/Off button
        row.innerHTML = `
          <div class="control-header"><label></label></div>
          <div class="choice-group"><button type="button" class="choice-btn"></button></div>
        `;
        setControlText(row.querySelector('label'), ctrl.label);
        const btn = row.querySelector('button');
        row._sync = () => {
          btn.textContent = spell.params[ctrl.id] ? 'On' : 'Off';
          btn.classList.toggle('active', !!spell.params[ctrl.id]);
        };
        btn.addEventListener('click', () => {
          spell.params[ctrl.id] = !spell.params[ctrl.id];
          spell.onParamChange?.(ctrl.id, spell.params[ctrl.id]);
          refresh();
        });
      } else {
        row.innerHTML = `
          <div class="control-header">
            <label></label>
            <span class="control-val"></span>
          </div>
          <input type="range" min="${ctrl.min}" max="${ctrl.max}" step="${ctrl.step}" />
        `;
        setControlText(row.querySelector('label'), ctrl.label);
        const input = row.querySelector('input');
        const valSpan = row.querySelector('.control-val');
        const fmt = (v) => (ctrl.format ? ctrl.format(v) : v);
        row._sync = () => {
          const v = spell.params[ctrl.id];
          input.value = v;
          setControlText(valSpan, fmt(v));
          input.style.setProperty('--p', `${((v - ctrl.min) / (ctrl.max - ctrl.min)) * 100}%`);
        };
        input.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          spell.params[ctrl.id] = val;
          setControlText(valSpan, fmt(val));
          spell.onParamChange?.(ctrl.id, val);
          refresh();
        });
      }
      rows.push(row);
      if (section) {
        section.rows.push(row);
        section.element.appendChild(row);
      } else {
        wrap.appendChild(row);
      }
    });
    refresh();
    return { el: wrap, refresh };
  }
}
