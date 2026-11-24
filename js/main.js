import { EventBus } from './core/EventBus.js?v=23';
import { AudioEngine } from './core/AudioEngine.js?v=23';
import { Engine } from './core/Engine.js?v=23';
import { SpellManager } from './spells/SpellManager.js?v=23';
import { UIController } from './ui/UIController.js?v=23';
import { Grimoire } from './ui/Grimoire.js?v=23';

// Import Mathgic Spell Modules
import { DualMorphSpell } from './spells/DualMorphSpell.js?v=23';
import { GoldenRatioSpell } from './spells/GoldenRatioSpell.js?v=23';
import { InfinitySpell } from './spells/InfinitySpell.js?v=23';
import { NonEuclideanSpell } from './spells/NonEuclideanSpell.js?v=23';
import { ProjectionSpell } from './spells/ProjectionSpell.js?v=23';

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-container');

  // 1. Initialize Core Engine Layer
  const eventBus = new EventBus();
  const audioEngine = new AudioEngine();
  const engine = new Engine(container, eventBus);

  // 2. Initialize Plug-and-Play Mathgic System & register modules
  const spellManager = new SpellManager(engine, eventBus);
  spellManager.register(DualMorphSpell);
  spellManager.register(GoldenRatioSpell);
  spellManager.register(ProjectionSpell);
  spellManager.register(InfinitySpell);
  spellManager.register(NonEuclideanSpell);

  // 3. Initialize UI Controller & restore state from URL hash (if any)
  const ui = new UIController(engine, eventBus, audioEngine, spellManager);

  // 3b. The grimoire: every chapter and page of the interface lives in the book
  const grimoire = new Grimoire({ engine, eventBus, audio: audioEngine, spellManager, fantasy: ui.fantasy });
  ui.attachGrimoire(grimoire);
  ui.restoreFromURL();

  // 4. Start 60fps 3D Render Loop
  engine.start();
});
