import * as THREE from 'three';

/**
 * _TemplateSpell.js — BOILERPLATE TEMPLATE FOR NEW MATHGIC MODULES
 *
 * How to add a new Mathgic spell:
 * 1. Copy this template inside `js/spells/` (e.g., `CymaticsSpell.js`).
 * 2. Set `isolateStage: true` if it is a standalone spatial portal (auto-hides the central Platonic solid),
 *    or `isolateStage: false` if it inscribes inside the transparent Platonic solid.
 * 3. Import and register it in `js/main.js` via `spellManager.register(YourSpell)`.
 * 4. Give it a place in the menu: add a `<button class="section-btn" data-section="your-id">` to `#side-menu`
 *    and an empty `<div id="panel-your-id" class="tab-content"></div>` inside `#grimoire-panel` in `index.html`.
 *
 * Control types: a slider (default), `type: 'choice'` (options: [{ value, label }]) and `type: 'toggle'`.
 * Any control may define `showWhen: (params) => boolean` to appear only in certain modes.
 */
export const TemplateSpell = {
  id: 'template-spell',
  name: 'New Mathgic Module',
  isolateStage: false,
  description: 'Short description of the mathematical phenomenon this module manifests.',

  controls: [
    {
      id: 'intensity',
      label: 'Intensity',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      format: (v) => `${Math.round(v * 100)}%`
    }
  ],

  mesh: null,

  onActivate(engine, eventBus) {
    this.engine = engine;
    const geo = new THREE.TorusKnotGeometry(1.3, 0.02, 120, 16);
    const mat = new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.engine.spellLayer.add(this.mesh);
  },

  onUpdate(elapsed, delta) {
    if (this.mesh) {
      this.mesh.rotation.z = elapsed * (this.params.intensity ?? 0.5);
    }
  },

  onDeactivate() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.engine.spellLayer.remove(this.mesh);
      this.mesh = null;
    }
  }
};
