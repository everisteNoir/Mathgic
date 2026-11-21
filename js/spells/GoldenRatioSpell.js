import * as THREE from 'three';
import { PHI } from '../solids/PlatonicMath.js?v=5';

const GOLDEN_ANGLE = 137.50776405; // degrees = 360° / φ²
const TILT = -0.55; // flat patterns lean toward the camera so they stay readable while the stage spins
const FLAT_LAYERS = ['spiral', 'phyllotaxis', 'pentagram', 'cut'];

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
  icon: '📐',
  name: 'The Golden Ratio (φ = 1.618)',
  isolateStage: true,
  hasLiveReadout: true,
  initialReadout: 'φ = 1.6180339887 • Long side ÷ short side = φ • Three rectangles meet at right angles',
  description:
    'Explore where φ appears: orthogonal Golden Rectangles, the Fibonacci spiral, sunflower seed spirals, nested pentagrams and the golden cut.',
  controls: [
    {
      id: 'mode',
      type: 'choice',
      label: 'Pattern',
      default: 'rectangles',
      options: [
        { value: 'rectangles', label: 'Rectangles' },
        { value: 'spiral', label: 'Spiral' },
        { value: 'phyllotaxis', label: 'Seeds' },
        { value: 'pentagram', label: 'Pentagram' },
        { value: 'cut', label: 'Golden Cut' }
      ]
    },
    // --- Rectangles ---
    {
      id: 'scale',
      label: 'Golden field scale',
      min: 0.45, max: 1.35, step: 0.02, default: 0.96,
      format: (v) => `${v.toFixed(2)} φ`,
      showWhen: (p) => p.mode === 'rectangles'
    },
    {
      id: 'spin',
      label: 'Gyroscope spin',
      min: 0, max: 2, step: 0.05, default: 0,
      format: (v) => (v === 0 ? 'Still' : `${v.toFixed(2)} rad/s`),
      showWhen: (p) => p.mode === 'rectangles'
    },
    // --- Spiral ---
    {
      id: 'squares',
      label: 'Fibonacci squares',
      min: 4, max: 11, step: 1, default: 9,
      format: (v) => `${v}`,
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
      format: (v) => `${v}`,
      showWhen: (p) => p.mode === 'phyllotaxis'
    },
    {
      id: 'angle',
      label: 'Divergence angle',
      min: 125, max: 150, step: 0.01, default: 137.51,
      format: (v) => `${v.toFixed(2)}°`,
      showWhen: (p) => p.mode === 'phyllotaxis'
    },
    {
      id: 'arms',
      type: 'choice',
      label: 'Highlight spiral arms (Fibonacci)',
      default: 0,
      options: [
        { value: 0, label: 'Off' },
        { value: 8, label: '8' },
        { value: 13, label: '13' },
        { value: 21, label: '21' },
        { value: 34, label: '34' }
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
      format: (v) => `${v}`,
      showWhen: (p) => p.mode === 'pentagram'
    },
    // --- Golden Cut ---
    {
      id: 'cut',
      label: 'Division point (long part ÷ whole)',
      min: 0.3, max: 0.7, step: 0.002, default: 0.52,
      format: (v) => `${Math.max(v, 1 - v).toFixed(3)}`,
      showWhen: (p) => p.mode === 'cut'
    }
  ],

  group: null,
  layers: null,
  _growT: 0,
  _seedT: 0,
  _spiralShown: 0,

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
    this._applyMode();
    this.engine.spellLayer.add(this.group);
  },

  onParamChange(id) {
    switch (id) {
      case 'mode': this._applyMode(); break;
      case 'scale': this.layers.rectangles.scale.setScalar(this.params.scale); break;
      case 'squares':
      case 'growSpiral': this._buildSpiral(); break;
      case 'seeds':
      case 'angle':
      case 'arms':
      case 'growSeeds': this._updateSeeds(); break;
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

    // Gyroscope: the three golden rectangles turn around the vertical axis
    if (p.spin > 0) this.layers.rectangles.rotation.y += delta * p.spin;

    // Spiral auto-grow: rebuild only when the number of squares changes
    if (p.mode === 'spiral' && p.growSpiral) {
      this._growT += delta * 1.1;
      const shown = 2 + Math.floor(this._growT % (p.squares - 1));
      if (shown !== this._spiralShown) {
        this._buildSpiral(shown);
        this._updateReadout();
      }
    }

    // Seed auto-grow: reveal seeds one by one, then hold the full flower for a moment
    if (p.mode === 'phyllotaxis' && p.growSeeds) {
      this._seedT += delta * p.seeds * 0.18;
      const count = Math.min(p.seeds, Math.floor(this._seedT % (p.seeds * 1.25)));
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
    }
  },

  _applyMode() {
    const mode = this.params.mode ?? 'rectangles';
    Object.entries(this.layers).forEach(([key, layer]) => {
      layer.visible = key === mode;
    });
    this._updateReadout();
  },

  _updateReadout() {
    if (!this._readoutEl) return;
    const p = this.params;
    const mode = p.mode ?? 'rectangles';
    let text;
    if (mode === 'rectangles') {
      text = 'φ = 1.6180339887 • Long side ÷ short side = φ • Three rectangles meet at right angles';
    } else if (mode === 'spiral') {
      const n = this._spiralShown || p.squares;
      const f = this._fib(n);
      const ratio = f[n - 1] / f[n - 2];
      text = `F(${n}) ÷ F(${n - 1}) = ${f[n - 1]} ÷ ${f[n - 2]} = ${ratio.toFixed(6)} • φ − ratio = ${Math.abs(PHI - ratio).toExponential(2)}`;
    } else if (mode === 'phyllotaxis') {
      const golden = Math.abs(p.angle - GOLDEN_ANGLE) < 0.03;
      const arms = p.arms ? ` • ${p.arms} arms visible (Fibonacci)` : '';
      text = golden
        ? `GOLDEN ANGLE ${GOLDEN_ANGLE.toFixed(3)}° • No seed ever lines up → dense, even packing${arms}`
        : `${p.angle.toFixed(2)}° is not golden • Seeds fall into radial arms with gaps${arms}`;
    } else if (mode === 'pentagram') {
      text = `Diagonal ÷ side = φ • Each nested pentagram is 1/φ² = ${(1 / (PHI * PHI)).toFixed(4)} the size of the last`;
    } else {
      const a = Math.max(p.cut, 1 - p.cut);
      const b = 1 - a;
      const whole = 1 / a;
      const part = a / b;
      text = this._isGoldenCut()
        ? `✨ GOLDEN SECTION • whole ÷ long = ${whole.toFixed(4)} = long ÷ short = ${part.toFixed(4)} = φ`
        : `whole ÷ long = ${whole.toFixed(4)} • long ÷ short = ${part.toFixed(4)} • Equal only at φ — try 0.618`;
    }
    this._readoutEl.textContent = text;
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

    planes.forEach(({ color, pts: raw }) => {
      const pts = raw.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      for (let i = 0; i < 4; i++) g.add(this._strut(pts[i], pts[(i + 1) % 4], color));
      pts.forEach((pt) => g.add(this._dot(pt, color)));

      const triGeo = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]]);
      g.add(
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
    });
    return g;
  },

  _buildSpiral(count = this.params.squares ?? 9) {
    const layer = this.layers.spiral;
    this._clear(layer);
    this._spiralShown = count;

    const sizes = this._fib(count);
    const squares = [];
    const arc = [];
    let p = new THREE.Vector2(0, 0); // arc start
    let h = new THREE.Vector2(1, 0); // heading
    sizes.forEach((s) => {
      const L = new THREE.Vector2(-h.y, h.x); // heading rotated +90°
      const c = p.clone().addScaledVector(L, s); // quarter-circle center = square corner
      const b = c.clone().addScaledVector(L, -s);
      squares.push([c.clone(), b, b.clone().addScaledVector(h, s), c.clone().addScaledVector(h, s)]);
      for (let k = 0; k < 24; k++) {
        const t = (k / 24) * (Math.PI / 2);
        arc.push(
          c.clone()
            .addScaledVector(L, -s * Math.cos(t))
            .addScaledVector(h, s * Math.sin(t))
        );
      }
      p = c.clone().addScaledVector(h, s);
      h = L;
    });
    arc.push(p);

    // Center and fit the whole construction inside the stage
    const box = new THREE.Box2().setFromPoints(squares.flat());
    const center = box.getCenter(new THREE.Vector2());
    const size = box.getSize(new THREE.Vector2());
    const k = 2.7 / Math.max(size.x, size.y);
    const to3 = (v) => new THREE.Vector3((v.x - center.x) * k, (v.y - center.y) * k, 0);

    const linePts = [];
    squares.forEach((sq) => {
      for (let i = 0; i < 4; i++) linePts.push(to3(sq[i]), to3(sq[(i + 1) % 4]));
    });
    layer.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(linePts),
        new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.75 })
      )
    );

    const curve = new THREE.CatmullRomCurve3(arc.map(to3));
    layer.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, arc.length * 2, 0.014, 6, false),
        new THREE.MeshBasicMaterial({
          color: '#fde047',
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
    );
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
