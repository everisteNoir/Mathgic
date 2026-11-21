import { EventBus } from './core/EventBus.js';
import { AudioEngine } from './core/AudioEngine.js';
import { Engine } from './core/Engine.js';
import { SpellManager } from './spells/SpellManager.js';
import { UIController } from './ui/UIController.js';

// Import Mathematical Spell Modules (To add a new spell later, simply import and register it here!)
import { DualMorphSpell } from './spells/DualMorphSpell.js';
import { GoldenRatioSpell } from './spells/GoldenRatioSpell.js';
import { Tesseract4DSpell } from './spells/Tesseract4DSpell.js';

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');
  const spellsContainer = document.getElementById('spells-container');

  // 1. Initialize Core Engine Layer
  const eventBus = new EventBus();
  const audioEngine = new AudioEngine();
  const engine = new Engine(container, eventBus);

  // 2. Initialize Plug-and-Play Spell System & register built-in spells
  const spellManager = new SpellManager(engine, eventBus, spellsContainer);
  spellManager.register(DualMorphSpell);
  spellManager.register(GoldenRatioSpell);
  spellManager.register(Tesseract4DSpell);

  // 3. Initialize UI Controller & restore state from URL hash (if any)
  const ui = new UIController(engine, eventBus, audioEngine, spellManager);
  ui.restoreFromURL();

  // 4. Start 60fps 3D Render Loop
  engine.start();
});
