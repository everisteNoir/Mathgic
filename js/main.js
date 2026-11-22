import { EventBus } from './core/EventBus.js?v=7';
import { AudioEngine } from './core/AudioEngine.js?v=7';
import { Engine } from './core/Engine.js?v=7';
import { SpellManager } from './spells/SpellManager.js?v=7';
import { UIController } from './ui/UIController.js?v=7';

// Import Mathgic Spell Modules
import { DualMorphSpell } from './spells/DualMorphSpell.js?v=7';
import { GoldenRatioSpell } from './spells/GoldenRatioSpell.js?v=7';
import { Tesseract4DSpell } from './spells/Tesseract4DSpell.js?v=7';
import { NonEuclideanSpell } from './spells/NonEuclideanSpell.js?v=7';
import { ProjectionSpell } from './spells/ProjectionSpell.js?v=7';

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');
  const panel = document.getElementById('grimoire-panel');

  // 1. Initialize Core Engine Layer
  const eventBus = new EventBus();
  const audioEngine = new AudioEngine();
  const engine = new Engine(container, eventBus);

  // 2. Initialize Plug-and-Play Mathgic System & register modules
  const spellManager = new SpellManager(engine, eventBus, panel);
  spellManager.register(DualMorphSpell);
  spellManager.register(GoldenRatioSpell);
  spellManager.register(ProjectionSpell);
  spellManager.register(Tesseract4DSpell);
  spellManager.register(NonEuclideanSpell);

  // 3. Initialize UI Controller & restore state from URL hash (if any)
  const ui = new UIController(engine, eventBus, audioEngine, spellManager);
  ui.restoreFromURL();

  // 4. Start 60fps 3D Render Loop
  engine.start();
});
