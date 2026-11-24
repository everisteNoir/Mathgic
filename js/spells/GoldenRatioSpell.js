import * as THREE from 'three';
import { fxState } from '../core/FXState.js?v=23';
import { renderMathInElementSafe } from '../core/MathRenderer.js?v=26';
import { PHI } from '../solids/PlatonicMath.js?v=23';

const GOLDEN_ANGLE = 137.50776405; // degrees = 360° / φ²
const TILT = -0.55; // flat patterns lean toward the camera so they stay readable while the stage spins
const FLAT_LAYERS = ['spiral', 'phyllotaxis', 'pentagram', 'cut'];
const shouldAnimateIntro = () =>
  fxState.enabled && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * GoldenRatioSpell.js — Mathgic 2: The Golden Ratio (φ = 1.6180339...)
 * A standalone portal (the polyhedron is hidden) with five interactive φ patterns, one shown at a time:
 *  - Rectangles: 3 mutually orthogonal Golden Rectangles, with an adjustable spin
 *  - Spiral: Fibonacci squares + golden spiral; "Auto-grow" builds it square by square
 *  - Seeds: sunflower phyllotaxis by the golden angle; highlight the Fibonacci spiral arms; "Auto-grow" plants seeds
 *  - Pentagram: nested pentagrams, each shrinking by φ²
 *  - Cut: drag a division point along a line and chase the golden section
 */
export const GoldenRatioSpell = {
  id: 'golden-ratio',
  name: 'The Golden Ratio (φ = 1.618)',
  isolateStage: true,
  hasLiveReadout: true,
  initialReadout: String.raw`\(\varphi=1.6180339887\) • Long side ÷ short side = \(\varphi\) • Three rectangles meet at right angles`,
  description:
    String.raw`Explore where \(\varphi\) appears: orthogonal Golden Rectangles, the Fibonacci spiral, sunflower seed spirals, nested pentagrams and the golden cut.`,
  controls: [
    {
      id: 'mode',
      type: 'choice',
      label: 'Pattern',
      default: 'rectangles',
      options: [
        { value: 'rectangles', label: 'Rectangles', legend: String.raw`Three golden rectangles, each with sides in the ratio \(\varphi:1\), meet at right angles. Spin them like a gyroscope.` },
        { value: 'spiral', label: 'Spiral', legend: String.raw`Squares with Fibonacci sides tile a rectangle, and a quarter circle in each draws the golden spiral. Neighbouring Fibonacci numbers close in on \(\varphi\).` },
        { value: 'phyllotaxis', label: 'Seeds', legend: String.raw`A sunflower plants each seed one golden angle (about \(137.5^\circ\)) after the last. Move the angle and the even packing breaks into radial arms.` },
        { value: 'pentagram', label: 'Pentagram', legend: String.raw`In a pentagram every diagonal is \(\varphi\) times a side, and each nested pentagram is \(1/\varphi^2\) the size of the one around it.` },
        { value: 'cut', label: 'Golden Cut', legend: String.raw`Cut a segment so that \(\text{whole}:\text{long}=\text{long}:\text{short}\). Only one cut works, and the ratio is \(\varphi\).` }
      ]
    },
    // --- Rectangles ---
    {
      id: 'scale',
      label: 'Golden field scale',
      min: 0.45, max: 1.35, step: 0.02, default: 0.96,
      format: (v) => String.raw`\(${v.toFixed(2)}\,\varphi\)`,
      showWhen: (p) => p.mode === 'rectangles'
    },
    {
      id: 'spin',
      label: 'Gyroscope spin',
      min: 0, max: 2, step: 0.05, default: 0,
      format: (v) => (v === 0 ? 'Still' : String.raw`\(${v.toFixed(2)}\,\mathrm{rad/s}\)`),
      showWhen: (p) => p.mode === 'rectangles'
    },
    // --- Spiral ---
    {
      id: 'squares',
      label: 'Fibonacci squares',
      min: 4, max: 11, step: 1, default: 9,
      format: (v) => String.raw`\(${v}\)`,
      showWhen: (p) => p.mode === 'spiral'
    },
    {
      id: 'growSpiral',
      type: 'toggle',
      label: 'Auto-grow the spiral',
      default: false,
      showWhen: (p) => p.mode === 'spiral'
    },
    // --- Seeds ---
    {
      id: 'seeds',
      label: 'Seed count',
      min: 60, max: 800, step: 10, default: 420,
      format: (v) => String.raw`\(${v}\)`,
      showWhen: (p) => p.mode === 'phyllotaxis'
    },
    {
      id: 'angle',
      label: 'Divergence angle',
      min: 125, max: 150, step: 0.01, default: 137.51,
      format: (v) => String.raw`\(${v.toFixed(2)}^\circ\)`,
      showWhen: (p) => p.mode === 'phyllotaxis'
    },
    {
      id: 'arms',
      type: 'choice',
      label: 'Highlight spiral arms (Fibonacci)',
      default: 0,
      options: [
        { value: 0, label: 'Off' },
        { value: 8, label: String.raw`\(8\)` },
        { value: 13, label: String.raw`\(13\)` },
        { value: 21, label: String.raw`\(21\)` },
        { value: 34, label: String.raw`\(34\)` }
      ],
      showWhen: (p) => p.mode === 'phyllotaxis'
    },
    {
      id: 'growSeeds',
      type: 'toggle',
      label: 'Auto-grow the seeds',
      default: false,
      showWhen: (p) => p.mode === 'phyllotaxis'
    },
    // --- Pentagram ---
    {
      id: 'depth',
      label: 'Nested pentagrams',
      min: 1, max: 5, step: 1, default: 3,
      format: (v) => String.raw`\(${v}\)`,
      showWhen: (p) => p.mode === 'pentagram'
    },
    // --- Golden Cut ---
    {
      id: 'cut',
      label: String.raw`Division point \(\text{long part}/\text{whole}\)`,
      min: 0.3, max: 0.7, step: 0.002, default: 0.52,
      format: (v) => String.raw`\(${Math.max(v, 1 - v).toFixed(3)}\)`,
      showWhen: (p) => p.mode === 'cut'
    }
  ],

  group: null,
  layers: null,
  _growT: 0,
  _seedT: 0,
  _spiralShown: 0,
  _currentMode: null,
  _modeTransition: null,
  _spiralReveal: 1,
  _seedReveal: 1,
  _rectangleReveal: 1,
  _introT: 1,

  onActivate(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.layers = {
      rectangles: this._buildRectangles(),
      spiral: new THREE.Group(),
      phyllotaxis: this._buildPhyllotaxis(),
      pentagram: new THREE.Group(),
      cut: new THREE.Group()
    };
    Object.values(this.layers).forEach((l) => this.group.add(l));
    FLAT_LAYERS.forEach((k) => (this.layers[k].rotation.x = TILT));

    this._buildSpiral();
    this._updateSeeds();
    this._buildPentagram();
    this._buildCut();
    this.layers.rectangles.scale.setScalar(this.params.scale ?? 0.96);
    this._currentMode = null;
    this._applyMode(false);
    this._introT = shouldAnimateIntro() ? 0 : 1;
    if (this.params.mode === 'rectangles') {
      this._rectangleReveal = this._introT < 1 ? 0 : 1;
      this.layers.rectangles.children.forEach((plane) => plane.scale.setScalar(this._introT < 1 ? 0.001 : 1));
    }
    this.group.scale.setScalar(this._introT < 1 ? 0.84 : 1);
    this.group.rotation.y = this._introT < 1 ? -0.09 : 0;
    this.engine.spellLayer.add(this.group);
  },

  onParamChange(id) {
    switch (id) {
      case 'mode': this._applyMode(true); break;
      case 'scale': this.layers.rectangles.scale.setScalar(this.params.scale); break;
      case 'squares':
        this._growT = 0;
        this._spiralReveal = this.params.growSpiral ? 0 : 1;
        this._buildSpiral();
        this._updateSpiralDrawRange();
        break;
      case 'growSpiral':
        this._growT = 0;
        this._spiralReveal = this.params.growSpiral ? 0 : 1;
        this._spiralShown = this.params.growSpiral ? 2 : (this.params.squares ?? 9);
        this._updateSpiralDrawRange();
        break;
      case 'seeds':
      case 'angle':
      case 'arms':
        this._updateSeeds();
        this._seedT = 0;
        this._seedReveal = 0;
        if (this.params.mode === 'phyllotaxis') this.layers.phyllotaxis.geometry.setDrawRange(0, 1);
        break;
      case 'growSeeds':
        this._seedT = 0;
        this._seedReveal = this.params.growSeeds ? 0 : 1;
        this.layers.phyllotaxis.geometry.setDrawRange(0, this.params.growSeeds ? 1 : (this.params.seeds ?? 420));
        break;
      case 'depth': this._buildPentagram(); break;
      case 'cut': this._buildCut(); break;
      default: break;
    }
    this._updateReadout();
  },

  onUpdate(elapsed, delta) {
    if (!this.layers) return;
    const p = this.params;
    this.layers.phyllotaxis.rotation.z = elapsed * 0.1;

    if (this._introT < 1) {
      if (!shouldAnimateIntro()) this._introT = 1;
      else this._introT = Math.min(1, this._introT + delta / 0.9);
      const eased = this._introT * this._introT * (3 - 2 * this._introT);
      this.group.scale.setScalar(0.84 + eased * 0.16);
      this.group.rotation.y = (1 - eased) * -0.09;
    }

    // Each Golden Ratio model materializes in its own visual language. The mode
    // swap is a short staged entrance, not an abrupt visible=true replacement.
    if (this._modeTransition) {
      const tr = this._modeTransition;
      tr.t = Math.min(1, tr.t + delta / 1.12);
      const e = tr.t * tr.t * (3 - 2 * tr.t);
      const outgoing = this.layers[tr.from];
      const incoming = this.layers[tr.to];
      outgoing.scale.setScalar(Math.max(0.001, 1 - e * 0.92));
      outgoing.rotation.z += delta * 0.5;
      incoming.scale.setScalar(0.06 + e * 0.94);
      incoming.rotation.z = (1 - e) * 0.12;
      if (tr.t >= 1) {
        outgoing.visible = false;
        outgoing.scale.setScalar(1);
        outgoing.rotation.z = 0;
        incoming.visible = true;
        incoming.scale.setScalar(1);
        incoming.rotation.z = 0;
        this._modeTransition = null;
      }
    }

    if (p.mode === 'rectangles' && this._rectangleReveal < 1) {
      this._rectangleReveal = Math.min(1, this._rectangleReveal + delta * 1.05);
      this.layers.rectangles.children.forEach((plane, i) => {
        const local = THREE.MathUtils.clamp((this._rectangleReveal - i * 0.22) / 0.62, 0, 1);
        plane.scale.setScalar(0.001 + local * 0.999);
      });
    }
    if (p.mode === 'spiral' && !p.growSpiral && this._spiralReveal < 1) {
      this._spiralReveal = Math.min(1, this._spiralReveal + delta * 0.68);
      this._updateSpiralDrawRange();
    }
    if (p.mode === 'phyllotaxis' && this._seedReveal < 1 && !p.growSeeds) {
      this._seedReveal = Math.min(1, this._seedReveal + delta * 1.25);
      const n = this.params.seeds ?? 420;
      this.layers.phyllotaxis.geometry.setDrawRange(0, Math.max(1, Math.floor(n * this._seedReveal)));
    }

    // Gyroscope: the three golden rectangles turn around the vertical axis
    if (p.spin > 0) this.layers.rectangles.rotation.y += delta * p.spin;

    // Spiral AutoGrow reveals a prebuilt buffer continuously. Geometry is not
    // removed or rebuilt during animation; only the draw range changes.
    if (p.mode === 'spiral' && p.growSpiral && this._spiralReveal < 1) {
      this._growT = Math.min(1, this._growT + delta / 6.0);
      const t = this._growT;
      this._spiralReveal = t * t * (3 - 2 * t);
      this._updateSpiralDrawRange();
      const shown = Math.max(2, Math.min(p.squares, Math.floor(this._spiralReveal * p.squares)));
      if (shown !== this._spiralShown) {
        this._spiralShown = shown;
        this._updateReadout();
      }
    }

    // Seed AutoGrow is a smooth one-shot growth: particles appear from the
    // centre outward, then remain in place instead of abruptly resetting.
    if (p.mode === 'phyllotaxis' && p.growSeeds && this._seedReveal < 1) {
      this._seedT = Math.min(1, this._seedT + delta / 5.8);
      const t = this._seedT;
      this._seedReveal = t * t * (3 - 2 * t);
      const count = Math.floor((p.seeds ?? 420) * this._seedReveal);
      this.layers.phyllotaxis.geometry.setDrawRange(0, Math.max(1, count));
    }
  },

  onDeactivate() {
    if (this.group) {
      this.group.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
      this.engine.spellLayer.remove(this.group);
      this.group = null;
      this.layers = null;
      this._introT = 1;
    }
  },

  _applyMode(animate = true) {
    const mode = this.params.mode ?? 'rectangles';
    const previous = this._currentMode;
    this._currentMode = mode;
    if (animate && previous && previous !== mode) {
      Object.entries(this.layers).forEach(([key, layer]) => {
        layer.visible = key === previous || key === mode;
        if (key === mode) layer.scale.setScalar(0.06);
      });
      this._modeTransition = { from: previous, to: mode, t: 0 };
      if (mode === 'rectangles') {
        this._rectangleReveal = 0;
        this.layers.rectangles.children.forEach((plane) => plane.scale.setScalar(0.001));
      }
      if (mode === 'spiral') {
        this._growT = 0;
        this._spiralReveal = this.params.growSpiral ? 0 : 0;
        this._updateSpiralDrawRange();
      }
      if (mode === 'phyllotaxis') {
        this._seedT = 0;
        this._seedReveal = 0;
        this.layers.phyllotaxis.geometry.setDrawRange(0, 1);
      }
    } else {
      Object.entries(this.layers).forEach(([key, layer]) => {
        layer.visible = key === mode;
        layer.scale.setScalar(1);
        layer.rotation.z = 0;
      });
      this._modeTransition = null;
      this._rectangleReveal = 1;
      this._spiralReveal = 1;
      this._seedReveal = 1;
      if (mode === 'rectangles') this.layers.rectangles.children.forEach((plane) => plane.scale.setScalar(1));
      if (mode === 'spiral') this._updateSpiralDrawRange();
      if (mode === 'phyllotaxis') this.layers.phyllotaxis.geometry.setDrawRange(0, this.params.seeds ?? 420);
    }
    this._updateReadout();
  },

  _updateReadout() {
    if (!this._readoutEl) return;
    const p = this.params;
    const mode = p.mode ?? 'rectangles';
    let text;
    if (mode === 'rectangles') {
      text = String.raw`\(\varphi=1.6180339887\)` + ' • Long side ÷ short side = ' + String.raw`\(\varphi\)` + ' • Three rectangles meet at right angles';
    } else if (mode === 'spiral') {
      const n = this._spiralShown || p.squares;
      const f = this._fib(n);
      const ratio = f[n - 1] / f[n - 2];
      text = String.raw`\(\frac{F(${n})}{F(${n - 1})}=\frac{${f[n - 1]}}{${f[n - 2]}}=${ratio.toFixed(6)}\)` + ' • ' + String.raw`\(\varphi-\text{ratio}=${Math.abs(PHI - ratio).toExponential(2)}\)`;
    } else if (mode === 'phyllotaxis') {
      const golden = Math.abs(p.angle - GOLDEN_ANGLE) < 0.03;
      const arms = p.arms ? String.raw` • \(${p.arms}\) arms visible (Fibonacci)` : '';
      text = golden
        ? String.raw`GOLDEN ANGLE \(${GOLDEN_ANGLE.toFixed(3)}^\circ\) • No seed ever lines up → dense, even packing${arms}`
        : String.raw`\(${p.angle.toFixed(2)}^\circ\) is not golden • Seeds fall into radial arms with gaps${arms}`;
    } else if (mode === 'pentagram') {
      text = String.raw`\(\frac{\text{diagonal}}{\text{side}}=\varphi\)` + ' • ' + String.raw`\(1/\varphi^2=${(1 / (PHI * PHI)).toFixed(4)}\)` + ' the size of the last';
    } else {
      const a = Math.max(p.cut, 1 - p.cut);
      const b = 1 - a;
      const whole = 1 / a;
      const part = a / b;
      text = this._isGoldenCut()
        ? String.raw`✨ GOLDEN SECTION • \(\frac{\text{whole}}{\text{long}}=${whole.toFixed(4)}=\frac{\text{long}}{\text{short}}=${part.toFixed(4)}=\varphi\)`
        : String.raw`\(\frac{\text{whole}}{\text{long}}=${whole.toFixed(4)}\) • \(\frac{\text{long}}{\text{short}}=${part.toFixed(4)}\) • Equal only at \(\varphi\) — try \(0.618\)`;
    }
    this._readoutEl.textContent = text;
    renderMathInElementSafe(this._readoutEl);
  },

  _isGoldenCut() {
    return Math.abs(Math.max(this.params.cut, 1 - this.params.cut) - 1 / PHI) < 0.004;
  },

  _fib(n) {
    const f = [1, 1];
    while (f.length < n) f.push(f[f.length - 1] + f[f.length - 2]);
    return f.slice(0, n);
  },

  _clear(layer) {
    while (layer.children.length > 0) {
      const c = layer.children[0];
      c.geometry?.dispose();
      c.material?.dispose();
      layer.remove(c);
    }
  },

  _strut(p1, p2, color, radius = 0.01, opacity = 0.9) {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const geo = new THREE.CylinderGeometry(radius, radius, dir.length(), 6, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const strut = new THREE.Mesh(geo, mat);
    strut.position.addVectors(p1, p2).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return strut;
  },

  _dot(p, color, radius = 0.025) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 10),
      new THREE.MeshBasicMaterial({ color })
    );
    dot.position.copy(p);
    return dot;
  },

  _buildRectangles() {
    const g = new THREE.Group();
    const norm = 1 / Math.sqrt(1 + PHI * PHI);
    const a = norm;
    const b = PHI * norm;
    const planes = [
      { color: '#fbbf24', pts: [[-a, b, 0], [a, b, 0], [a, -b, 0], [-a, -b, 0]] },
      { color: '#38bdf8', pts: [[0, -a, b], [0, a, b], [0, a, -b], [0, -a, -b]] },
      { color: '#f472b6', pts: [[b, 0, -a], [b, 0, a], [-b, 0, a], [-b, 0, -a]] }
    ];

    planes.forEach(({ color, pts: raw }, planeIndex) => {
      const plane = new THREE.Group();
      plane.userData.revealIndex = planeIndex;
      const pts = raw.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      for (let i = 0; i < 4; i++) plane.add(this._strut(pts[i], pts[(i + 1) % 4], color));
      pts.forEach((pt) => plane.add(this._dot(pt, color)));

      const triGeo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
      plane.add(
        new THREE.Mesh(
          triGeo,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.07,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending
          })
        )
      );
      g.add(plane);
    });
    return g;
  },

  _buildSpiral(count = this.params.squares ?? 9) {
    const layer = this.layers.spiral;
    this._clear(layer);
    const sizes = this._fib(count);
    const squares = [];
    const arc = [];
    let p = new THREE.Vector2(0, 0);
    let h = new THREE.Vector2(1, 0);
    sizes.forEach((side) => {
      const L = new THREE.Vector2(-h.y, h.x);
      const c = p.clone().addScaledVector(L, side);
      const b = c.clone().addScaledVector(L, -side);
      squares.push([c.clone(), b, b.clone().addScaledVector(h, side), c.clone().addScaledVector(h, side)]);
      for (let k = 0; k <= 24; k++) {
        const angle = (k / 24) * (Math.PI / 2);
        arc.push(c.clone().addScaledVector(L, -side * Math.cos(angle)).addScaledVector(h, side * Math.sin(angle)));
      }
      p = c.clone().addScaledVector(h, side);
      h = L;
    });
    const box = new THREE.Box2().setFromPoints(squares.flat());
    const center = box.getCenter(new THREE.Vector2());
    const size = box.getSize(new THREE.Vector2());
    const scale = 2.7 / Math.max(size.x, size.y);
    const to3 = (v) => new THREE.Vector3((v.x - center.x) * scale, (v.y - center.y) * scale, 0);

    const linePoints = [];
    squares.forEach((square) => {
      for (let i = 0; i < 4; i++) linePoints.push(to3(square[i]), to3(square[(i + 1) % 4]));
    });
    const squareGeo = new THREE.BufferGeometry().setFromPoints(linePoints);
    this._spiralLines = new THREE.LineSegments(
      squareGeo,
      new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.76 })
    );
    layer.add(this._spiralLines);

    // A simple Line buffer supports progressive drawRange without rebuilding a tube mesh.
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arc.map(to3));
    this._spiralArc = new THREE.Line(
      arcGeo,
      new THREE.LineBasicMaterial({ color: '#fde047', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    layer.add(this._spiralArc);
    this._spiralMaxSquares = count;
    this._spiralShown = Math.max(2, Math.floor(count * (this._spiralReveal ?? 1)));
    this._updateSpiralDrawRange();
  },

  _updateSpiralDrawRange() {
    const reveal = THREE.MathUtils.clamp(this._spiralReveal ?? 1, 0, 1);
    if (this._spiralLines?.geometry) {
      const total = this._spiralLines.geometry.attributes.position.count;
      // Each square contributes exactly eight vertices (four independent edges).
      const perSquare = 8;
      const shownSquares = Math.floor((this._spiralMaxSquares ?? this.params.squares ?? 9) * reveal);
      const count = Math.min(total, shownSquares * perSquare);
      this._spiralLines.geometry.setDrawRange(0, count);
    }
    if (this._spiralArc?.geometry) {
      const total = this._spiralArc.geometry.attributes.position.count;
      this._spiralArc.geometry.setDrawRange(0, Math.max(1, Math.floor(total * reveal)));
    }
  },

  _buildPhyllotaxis() {
    const max = 800;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    return new THREE.Points(geo, mat);
  },

  _updateSeeds() {
    const pts = this.layers.phyllotaxis;
    const n = this.params.seeds ?? 420;
    const arms = this.params.arms ?? 0;
    const step = THREE.MathUtils.degToRad(this.params.angle ?? 137.51);
    const pos = pts.geometry.attributes.position;
    const col = pts.geometry.attributes.color;
    const c = 1.4 / Math.sqrt(n);
    const inner = new THREE.Color('#fde047');
    const outer = new THREE.Color('#f472b6');
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const r = c * Math.sqrt(i + 0.5);
      const a = i * step;
      pos.setXYZ(i, r * Math.cos(a), r * Math.sin(a), 0);
      // With arms on, seeds whose index is congruent mod F share a color: the F spiral arms light up
      if (arms > 0) tmp.setHSL((i % arms) / arms, 0.85, 0.6);
      else tmp.copy(inner).lerp(outer, i / n);
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    pts.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  },

  _buildPentagram() {
    const layer = this.layers.pentagram;
    this._clear(layer);
    const depth = this.params.depth ?? 3;
    for (let level = 0; level < depth; level++) {
      // Each inner pentagon is inverted (36° turn) and 1/φ² as large
      const R = 1.4 / Math.pow(PHI, 2 * level);
      const fade = 1 - level * 0.14;
      const v = [];
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 + (level * Math.PI) / 5 + (i * 2 * Math.PI) / 5;
        v.push(new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0));
      }
      const w = Math.max(0.004, 0.011 / (1 + level * 0.6));
      for (let i = 0; i < 5; i++) {
        layer.add(this._strut(v[i], v[(i + 1) % 5], '#38bdf8', w, 0.9 * fade)); // sides
        layer.add(this._strut(v[i], v[(i + 2) % 5], '#fbbf24', w, 0.9 * fade)); // diagonals (side × φ)
      }
      if (level === 0) v.forEach((pt) => layer.add(this._dot(pt, '#fef3c7', 0.03)));
    }
  },

  _buildCut() {
    const layer = this.layers.cut;
    this._clear(layer);
    const W = 2.8; // whole segment length
    const x0 = -W / 2;
    const t = this.params.cut ?? 0.52;
    const golden = this._isGoldenCut();
    const split = x0 + W * t;
    const left = new THREE.Vector3(x0, 0.55, 0);
    const mid = new THREE.Vector3(split, 0.55, 0);
    const right = new THREE.Vector3(x0 + W, 0.55, 0);

    // The line being cut: the two parts get different colors; the longer one is gold
    const leftIsLong = t >= 0.5;
    layer.add(this._strut(left, mid, leftIsLong ? '#fbbf24' : '#38bdf8', 0.02));
    layer.add(this._strut(mid, right, leftIsLong ? '#38bdf8' : '#fbbf24', 0.02));
    layer.add(this._dot(left, '#e2e8f0', 0.03));
    layer.add(this._dot(right, '#e2e8f0', 0.03));
    layer.add(this._dot(mid, golden ? '#fef08a' : '#f87171', golden ? 0.075 : 0.045));

    // Reference ladder: exact golden cuts, each long part is cut again in the ratio φ
    let len = W;
    for (let i = 0; i < 5; i++) {
      const y = 0.1 - i * 0.22;
      const long = len / PHI;
      layer.add(this._strut(new THREE.Vector3(x0, y, 0), new THREE.Vector3(x0 + long, y, 0), '#fbbf24', 0.012, 0.8));
      layer.add(this._strut(new THREE.Vector3(x0 + long, y, 0), new THREE.Vector3(x0 + len, y, 0), '#38bdf8', 0.012, 0.8));
      len = long; // the long part becomes the next whole
    }
  }
};
