import * as THREE from 'three';

/**
 * _TemplateSpell.js — BOILERPLATE TEMPLATE FOR NEW MATHEMATICAL SPELLS
 *
 * How to add a new spell (no coding experience required):
 * 1. Share this template with an AI and ask it to write a new spell following this structure.
 * 2. Save the new file inside `js/spells/` (e.g., `CymaticsSpell.js`).
 * 3. Open `js/main.js`, import the new file, and call `spellManager.register(CymaticsSpell);`.
 */
export const TemplateSpell = {
  id: 'template-spell',
  icon: '✨',
  name: 'New Mathematical Spell',
  description: 'Short description of the mathematical phenomenon this spell manifests.',

  // Define sliders that automatically appear in the UI when toggled on
  controls: [
    {
      id: 'intensity',
      label: 'Spell intensity',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.5,
      format: (v) => `${Math.round(v * 100)}%`
    }
  ],

  mesh: null,

  // Runs once when the user toggles the spell ON
  onActivate(engine, eventBus) {
    this.engine = engine;
    const geo = new THREE.TorusKnotGeometry(1.3, 0.02, 120, 16);
    const mat = new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.engine.spellLayer.add(this.mesh);
  },

  // Runs 60 times per second while the spell is active
  onUpdate(elapsed, delta) {
    if (this.mesh) {
      this.mesh.rotation.z = elapsed * (this.params.intensity ?? 0.5);
    }
  },

  // Runs once when the user toggles the spell OFF (clean up GPU resources)
  onDeactivate() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.engine.spellLayer.remove(this.mesh);
      this.mesh = null;
    }
  }
};
