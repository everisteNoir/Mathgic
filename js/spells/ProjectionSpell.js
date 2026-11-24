import * as THREE from 'three';

const sstep = THREE.MathUtils.smoothstep;
const lerp = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;
const ADD = THREE.AdditiveBlending;

const _col = new THREE.Color();
const hsl = (h, s, l) => {
  _col.setHSL(h, s, l);
  return [_col.r, _col.g, _col.b];
};

/** Dynamic line segments with per-vertex colors (re-filled every frame). */
class DynLines {
  constructor(max, opacity = 1) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.obj = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, blending: ADD, depthWrite: false })
    );
    this.obj.frustumCulled = false;
  }
  reset() {
    this.n = 0;
  }
  add(a, b, c1, c2 = c1) {
    if (this.n >= this.max) return;
    const o = this.n * 6;
    this.pos[o] = a[0]; this.pos[o + 1] = a[1]; this.pos[o + 2] = a[2];
    this.pos[o + 3] = b[0]; this.pos[o + 4] = b[1]; this.pos[o + 5] = b[2];
    this.col[o] = c1[0]; this.col[o + 1] = c1[1]; this.col[o + 2] = c1[2];
    this.col[o + 3] = c2[0]; this.col[o + 4] = c2[1]; this.col[o + 5] = c2[2];
    this.n++;
  }
  flush() {
    const g = this.obj.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.n * 2);
  }
}

/** Dynamic colored points. */
class DynPoints {
  constructor(max, size) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.obj = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, blending: ADD, depthWrite: false })
    );
    this.obj.frustumCulled = false;
  }
  reset() {
    this.n = 0;
  }
  add(p, c) {
    if (this.n >= this.max) return;
    const o = this.n * 3;
    this.pos[o] = p[0]; this.pos[o + 1] = p[1]; this.pos[o + 2] = p[2];
    this.col[o] = c[0]; this.col[o + 1] = c[1]; this.col[o + 2] = c[2];
    this.n++;
  }
  flush() {
    const g = this.obj.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.n);
  }
}

const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const glowSphere = (color, r) =>
  new THREE.Mesh(
    new THREE.SphereGeometry(r, 14, 14),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: ADD, depthWrite: false })
  );

const MULTIPLES = [-1.25, -0.85, -0.45, 0.45, 0.85, 1.25];
const GOLD = [1.0, 0.8, 0.25];
const view = { vector: 'vector', side: 'side', proj: 'proj' };

/**
 * ProjectionSpell.js — Dimensional Projection (standalone portal, polyhedra hidden)
 *  - Shadows: an n-cube (2D…6D) projected down to 3D, then to a 2D floor shadow and a 1D line shadow
 *  - Quotient: the space of vectors where v ~ λv, shown next to its projectivization (RP¹ from R², RP² from R³)
 *  - Geometry Ladder: Euclidean ⊂ Affine ⊂ Projective maps acting on a plane, with the horizon line
 */
export const ProjectionSpell = {
  id: 'projection',
  name: 'Dimensional Projection',
  isolateStage: true,
  hasLiveReadout: true,
  initialReadout: 'v ~ λv  ⇒  [x : y : z] — every multiple of a vector is the same projective point',
  description:
    'Follow a space as it casts shadows into fewer dimensions, and watch what happens when every vector is identified with all of its multiples.',
  controls: [
    {
      id: 'mode',
      type: 'choice',
      label: 'Lens',
      default: 'quotient',
      options: [
        { value: 'shadows', label: 'Shadows', legend: 'An n-dimensional cube cast down one dimension at a time: first to 3D, then to a flat shadow, then to a line.' },
        { value: 'quotient', label: 'Quotient v ~ λv', legend: 'Identify every vector v with all of its multiples λv. What remains is projective space.' },
        { value: 'ladder', label: 'Geometry Ladder', legend: 'Euclidean, Affine, Projective: three geometries, each keeping less than the one before.' }
      ]
    },
    // ---------------- Shadows ----------------
    { id: 'dim', label: 'Dimension of the cube', min: 2, max: 6, step: 1, default: 4, format: (v) => `${v}D`, showWhen: (p) => p.mode === 'shadows' },
    {
      id: 'proj', type: 'choice', label: 'Projection', default: 'persp',
      options: [{ value: 'persp', label: 'Perspective' }, { value: 'para', label: 'Parallel' }],
      showWhen: (p) => p.mode === 'shadows'
    },
    {
      id: 'dist', label: 'Eye distance d', min: 0.9, max: 6, step: 0.01, default: 2.6, format: (v) => v.toFixed(2),
      showWhen: (p) => p.mode === 'shadows' && p.proj === 'persp'
    },
    {
      id: 'plane', type: 'choice', label: 'Rotation plane', default: 'auto',
      options: [{ value: 'auto', label: 'All' }, { value: 'XW', label: 'XW' }, { value: 'YW', label: 'YW' }, { value: 'ZW', label: 'ZW' }],
      showWhen: (p) => p.mode === 'shadows'
    },
    { id: 'speed', label: 'Rotation speed', min: 0, max: 2, step: 0.05, default: 0.6, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'shadows' },
    { id: 'extrude', label: 'Extrusion of the last axis', min: 0, max: 1, step: 0.01, default: 1, format: (v) => `${Math.round(v * 100)}%`, showWhen: (p) => p.mode === 'shadows' },
    { id: 'cascade', type: 'toggle', label: 'Shadow cascade (3D → 2D → 1D)', default: true, showWhen: (p) => p.mode === 'shadows' },
    // ---------------- Quotient ----------------
    {
      id: 'space', type: 'choice', label: 'Space', default: 3,
      options: [{ value: 2, label: 'R² → RP¹' }, { value: 3, label: 'R³ → RP²' }],
      showWhen: (p) => p.mode === 'quotient'
    },
    {
      id: 'view', type: 'choice', label: 'View', default: 'side',
      options: [{ value: 'vector', label: 'Vector space' }, { value: 'side', label: 'Side by side' }, { value: 'proj', label: 'Projectivized' }],
      showWhen: (p) => p.mode === 'quotient'
    },
    {
      id: 'model', type: 'choice', label: 'Model of P(V)', default: 'chart',
      options: [{ value: 'chart', label: 'Affine chart' }, { value: 'sphere', label: 'Sphere / ±' }],
      showWhen: (p) => p.mode === 'quotient'
    },
    { id: 'theta', label: 'Direction θ', min: 0, max: 360, step: 1, default: 50, format: (v) => `${v}°`, showWhen: (p) => p.mode === 'quotient' },
    { id: 'phi', label: 'Inclination φ', min: 5, max: 175, step: 1, default: 55, format: (v) => `${v}°`, showWhen: (p) => p.mode === 'quotient' && p.space === 3 },
    { id: 'len', label: 'Length |v|', min: 0.3, max: 1.2, step: 0.01, default: 0.8, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'quotient' },
    { id: 'lambda', label: 'Scalar λ  (point λv)', min: -3, max: 3, step: 0.01, default: 1.6, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'quotient' },
    { id: 'collapse', label: 'Collapse classes to points', min: 0, max: 1, step: 0.01, default: 0, format: (v) => `${Math.round(v * 100)}%`, showWhen: (p) => p.mode === 'quotient' && p.view !== 'proj' },
    { id: 'parallels', type: 'toggle', label: 'Show parallels meeting at infinity', default: false, showWhen: (p) => p.mode === 'quotient' && p.space === 3 && !p.applyH },
    { id: 'alpha', label: 'Direction of the parallels', min: 0, max: 180, step: 1, default: 25, format: (v) => `${v}°`, showWhen: (p) => p.mode === 'quotient' && p.space === 3 && p.parallels && !p.applyH },
    { id: 'applyH', type: 'toggle', label: 'Act on V with the Ladder matrix H', default: false, showWhen: (p) => p.mode === 'quotient' && p.space === 3 },
    // ---------------- Ladder ----------------
    { id: 'rot', label: 'Euclid · rotation', min: -180, max: 180, step: 1, default: 0, format: (v) => `${v}°`, showWhen: (p) => p.mode === 'ladder' || p.applyH },
    { id: 'tx', label: 'Euclid · shift x', min: -1, max: 1, step: 0.01, default: 0, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'ladder' },
    { id: 'ty', label: 'Euclid · shift y', min: -1, max: 1, step: 0.01, default: 0, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'ladder' },
    { id: 'sx', label: 'Affine · stretch x', min: 0.4, max: 2, step: 0.01, default: 1, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'ladder' || p.applyH },
    { id: 'sy', label: 'Affine · stretch y', min: 0.4, max: 2, step: 0.01, default: 1, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'ladder' || p.applyH },
    { id: 'shear', label: 'Affine · shear', min: -1, max: 1, step: 0.01, default: 0, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'ladder' || p.applyH },
    { id: 'p1', label: 'Projective · tilt x', min: -0.6, max: 0.6, step: 0.01, default: 0, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'ladder' || p.applyH },
    { id: 'p2', label: 'Projective · tilt y', min: -0.6, max: 0.6, step: 0.01, default: 0, format: (v) => v.toFixed(2), showWhen: (p) => p.mode === 'ladder' || p.applyH }
  ],

  group: null,
  layers: null,
  _t: 0,

  // ======================================================================================
  onActivate(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.layers = { shadows: new THREE.Group(), quotient: new THREE.Group(), ladder: new THREE.Group() };
    Object.values(this.layers).forEach((l) => this.group.add(l));
    this.layers.ladder.rotation.x = -0.45;
    this._buildShadows();
    this._buildQuotient();
    this._buildLadder();
    this._applyMode();
    this.engine.spellLayer.add(this.group);
  },

  onDeactivate() {
    if (!this.group) return;
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    this.engine.spellLayer.remove(this.group);
    this.group = null;
    this.layers = null;
  },

  onParamChange(id) {
    if (id === 'mode') this._applyMode();
    else if (id === 'dim') this._buildCube();
    else if (['space', 'model', 'view', 'parallels', 'applyH'].includes(id)) this._rebuildQuotientFrames();
    this._dirty = true;
    this._updateReadout();
  },

  onUpdate(elapsed, delta) {
    if (!this.layers) return;
    const mode = this.params.mode;
    if (mode === 'shadows') this._updateShadows(delta);
    else if (mode === 'quotient') this._updateQuotient(elapsed);
    else if (this._dirty) this._updateLadder();
    this._dirty = false;
  },

  _applyMode() {
    Object.entries(this.layers).forEach(([k, l]) => (l.visible = k === this.params.mode));
    this._dirty = true;
    this._updateReadout();
  },

  // ======================================================================================
  // SHADOWS
  // ======================================================================================
  _buildShadows() {
    const L = this.layers.shadows;
    this.sh = {
      lines: new DynLines(1400, 0.95),
      pts: new DynPoints(70, 0.06),
      frame: new DynLines(8, 0.5)
    };
    L.add(this.sh.frame.obj, this.sh.lines.obj, this.sh.pts.obj);
    // Fixed frames for the 2D floor shadow and the 1D line shadow
    const f = this.sh.frame;
    const y = -1.2;
    const c = [0.25, 0.4, 0.6];
    f.add([-1.5, y, -1.5], [1.5, y, -1.5], c); f.add([1.5, y, -1.5], [1.5, y, 1.5], c);
    f.add([1.5, y, 1.5], [-1.5, y, 1.5], c); f.add([-1.5, y, 1.5], [-1.5, y, -1.5], c);
    f.add([-1.5, y, 1.7], [1.5, y, 1.7], [0.6, 0.45, 0.15]);
    f.flush();
    this._buildCube();
  },

  _buildCube() {
    const n = this.params.dim ?? 4;
    const count = 1 << n;
    this.cube = { n, count, edges: [] };
    for (let v = 0; v < count; v++) {
      for (let a = 0; a < n; a++) {
        if (!(v & (1 << a))) this.cube.edges.push([v, v | (1 << a)]);
      }
    }
  },

  _updateShadows(delta) {
    const p = this.params;
    const { n, count, edges } = this.cube;
    this._t += delta * p.speed;
    const t = this._t;
    const s = 0.75;
    const d = p.dist;
    const persp = p.proj === 'persp';

    // Which coordinate planes rotate
    const planes = [];
    if (n >= 4 && p.plane !== 'auto') {
      planes.push([{ XW: 0, YW: 1, ZW: 2 }[p.plane], 3, 0.9]);
    } else if (n >= 4) {
      for (let j = 3; j < n; j++) for (let i = 0; i < j; i++) planes.push([i, j, 0.35 + 0.17 * (i + j)]);
    } else if (n === 3) {
      planes.push([0, 2, 0.45], [1, 2, 0.3]);
    } else {
      planes.push([0, 1, 0.5]);
    }

    const P = [];
    const vis = [];
    const depth = [];
    const c = new Array(n);
    for (let v = 0; v < count; v++) {
      for (let a = 0; a < n; a++) {
        const sign = v & (1 << a) ? 1 : -1;
        c[a] = sign * s * (a === n - 1 ? p.extrude : 1);
      }
      for (const [i, j, w] of planes) {
        const ang = t * w;
        const ci = Math.cos(ang);
        const si = Math.sin(ang);
        const x = c[i] * ci - c[j] * si;
        const y = c[i] * si + c[j] * ci;
        c[i] = x;
        c[j] = y;
      }
      depth.push(n >= 4 ? c[3] / s : n === 3 ? c[2] / s : 0);
      // Project down one dimension at a time until 3D remains
      let v3 = 1;
      for (let k = n - 1; k >= 3; k--) {
        if (persp) {
          const den = d - c[k];
          v3 *= THREE.MathUtils.clamp((den - 0.12) / 0.3, 0, 1);
          const f = d / Math.max(den, 0.12);
          for (let i = 0; i < k; i++) c[i] *= f;
        }
      }
      P.push([c[0] * 1.15, (c[1] ?? 0) * 1.15, (c[2] ?? 0) * 1.15]);
      vis.push(v3);
    }

    const L = this.sh.lines;
    const pts = this.sh.pts;
    L.reset();
    pts.reset();
    const colorOf = (v) => (n >= 3 ? hsl(0.52 + 0.33 * (depth[v] * 0.5 + 0.5), 0.85, 0.6) : hsl(0.12, 0.85, 0.6));
    const floorY = -1.2;
    const lineZ = 1.7;
    const cascade = p.cascade;
    for (const [a, b] of edges) {
      const k = Math.min(vis[a], vis[b]);
      if (k < 0.02) continue;
      const ca = scale3(colorOf(a), vis[a]);
      const cb = scale3(colorOf(b), vis[b]);
      L.add(P[a], P[b], ca, cb);
      if (cascade) {
        const a2 = [P[a][0], floorY, P[a][2]];
        const b2 = [P[b][0], floorY, P[b][2]];
        L.add(a2, b2, scale3([0.35, 0.55, 0.9], vis[a] * 0.8), scale3([0.35, 0.55, 0.9], vis[b] * 0.8));
        L.add([a2[0], floorY, lineZ], [b2[0], floorY, lineZ], scale3(GOLD, vis[a] * 0.9), scale3(GOLD, vis[b] * 0.9));
      }
    }
    for (let v = 0; v < count; v++) {
      if (vis[v] < 0.02) continue;
      pts.add(P[v], scale3([1, 1, 1], vis[v]));
      if (cascade) {
        L.add(P[v], [P[v][0], floorY, P[v][2]], [0.1 * vis[v], 0.14 * vis[v], 0.2 * vis[v]]);
        L.add([P[v][0], floorY, P[v][2]], [P[v][0], floorY, lineZ], [0.1 * vis[v], 0.09 * vis[v], 0.04 * vis[v]]);
      }
    }
    L.flush();
    pts.flush();
    this.sh.frame.obj.visible = cascade;
    if (!this._ro || this._ro > 20) {
      this._ro = 0;
      this._updateReadout();
    }
    this._ro++;
  },

  // ======================================================================================
  // QUOTIENT  v ~ λv
  // ======================================================================================
  _buildQuotient() {
    const L = this.layers.quotient;
    const q = (this.q = {});
    q.gV = new THREE.Group();
    q.gP = new THREE.Group();
    L.add(q.gV, q.gP);
    q.link = new DynLines(6, 1);
    L.add(q.link.obj);

    // Classes: unit directions (one per line through the origin)
    q.dirs3 = [];
    const N3 = 44;
    for (let i = 0; i < N3; i++) {
      const z = (i + 0.5) / N3;
      const r = Math.sqrt(1 - z * z);
      const a = i * 2.399963;
      q.dirs3.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
    q.dirs2 = [];
    const N2 = 22;
    for (let i = 0; i < N2; i++) {
      const a = ((i + 0.5) / N2) * Math.PI;
      q.dirs2.push([Math.cos(a), Math.sin(a), 0]);
    }

    // Space V
    q.frameV = new DynLines(900, 0.55);
    q.classLines = new DynLines(60, 0.6);
    q.cloud = new DynPoints(300, 0.045);
    q.selLines = new DynLines(10, 1);
    q.ticks = new DynPoints(6, 0.07);
    q.parV = new DynLines(40, 0.9);
    q.head = glowSphere('#ffffff', 0.035);
    q.lam = glowSphere('#fbbf24', 0.045);
    q.origin = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.042, 24),
      new THREE.MeshBasicMaterial({ color: '#fbbf24', side: THREE.DoubleSide, transparent: true, opacity: 0.9, blending: ADD })
    );
    q.parPlanes = [0, 1].map((i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
      return new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({ color: i ? '#f472b6' : '#38bdf8', transparent: true, opacity: 0.1, side: THREE.DoubleSide, blending: ADD, depthWrite: false })
      );
    });
    q.gV.add(q.frameV.obj, q.classLines.obj, q.cloud.obj, q.selLines.obj, q.ticks.obj, q.parV.obj, q.head, q.lam, q.origin, ...q.parPlanes);

    // Space P(V)
    q.frameP = new DynLines(900, 0.6);
    q.ptsP = new DynPoints(100, 0.05);
    q.parP = new DynLines(300, 0.95);
    q.selP = glowSphere('#ffffff', 0.045);
    q.selP2 = glowSphere('#ffffff', 0.03);
    q.infMark = glowSphere('#fbbf24', 0.04);
    q.gP.add(q.frameP.obj, q.ptsP.obj, q.parP.obj, q.selP, q.selP2, q.infMark);

    this._rebuildQuotientFrames();
  },

  /** Static frames of V (chart plane / sphere) and of P(V) (disc / sphere / circle). */
  _rebuildQuotientFrames() {
    const q = this.q;
    const p = this.params;
    const dim = p.space;
    const chart = p.model === 'chart';
    const F = q.frameV;
    const G = q.frameP;
    F.reset();
    G.reset();
    const grey = [0.3, 0.34, 0.45];
    const blue = [0.18, 0.4, 0.7];
    const faint = [0.14, 0.2, 0.34];
    const ring = (dst, cx, cy, cz, ax, ay, r, color, segs = 64) => {
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU;
        const a1 = ((i + 1) / segs) * TAU;
        const pt = (a) => [cx + r * (Math.cos(a) * ax[0] + Math.sin(a) * ay[0]), cy + r * (Math.cos(a) * ax[1] + Math.sin(a) * ay[1]), cz + r * (Math.cos(a) * ax[2] + Math.sin(a) * ay[2])];
        dst.add(pt(a0), pt(a1), color);
      }
    };
    const X = [1, 0, 0];
    const Y = [0, 1, 0];
    const Z = [0, 0, 1];
    // axes of V
    const A = 1.35;
    F.add([-A, 0, 0], [A, 0, 0], grey); F.add([0, -A, 0], [0, A, 0], grey);
    if (dim === 3) F.add([0, 0, -A], [0, 0, A], grey);
    const H = 1.3; // half size of the chart plane
    if (dim === 3 && chart) {
      for (let k = -2; k <= 2; k++) {
        const u = (k / 2) * H;
        F.add([-H, u, 1], [H, u, 1], blue); F.add([u, -H, 1], [u, H, 1], blue);
      }
      ring(F, 0, 0, 0, X, Y, 1, [0.55, 0.42, 0.1]); // z = 0: directions that map to infinity
    } else if (dim === 3) {
      for (let k = -3; k <= 3; k++) {
        const z = k / 4;
        ring(F, 0, 0, z, X, Y, Math.sqrt(1 - z * z), faint, 48);
      }
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI;
        ring(F, 0, 0, 0, [Math.cos(a), Math.sin(a), 0], Z, 1, faint, 48);
      }
      ring(F, 0, 0, 0, X, Y, 1, [0.55, 0.42, 0.1]);
    } else if (chart) {
      F.add([-H, 1, 0], [H, 1, 0], blue);
      for (let k = -2; k <= 2; k++) F.add([(k / 2) * H, 0.94, 0], [(k / 2) * H, 1.06, 0], blue);
    } else {
      ring(F, 0, 0, 0, X, Y, 1, faint);
    }
    F.flush();

    // P(V)
    if (dim === 3 && chart) {
      [0.5, 1, 2, 4].forEach((R) => ring(G, 0, 0, 0, X, Y, R / (1 + R), [0.16, 0.34, 0.6], 64));
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        G.add([0, 0, 0], [Math.cos(a), Math.sin(a), 0], [0.12, 0.22, 0.4]);
      }
      ring(G, 0, 0, 0, X, Y, 1, GOLD, 96); // the line at infinity
    } else if (dim === 3) {
      for (let k = -3; k <= 3; k++) {
        const z = k / 4;
        ring(G, 0, 0, z, X, Y, Math.sqrt(1 - z * z), faint, 48);
      }
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI;
        ring(G, 0, 0, 0, [Math.cos(a), Math.sin(a), 0], Z, 1, faint, 48);
      }
      ring(G, 0, 0, 0, X, Y, 1, [0.9, 0.7, 0.2], 96);
    } else {
      ring(G, 0, 0, 0, X, Y, 1, [0.25, 0.4, 0.65], 96);
    }
    G.flush();
    q.infMark.visible = dim === 2;
    q.infMark.position.set(0, 1, 0);
  },

  _H() {
    const p = this.params;
    const r = THREE.MathUtils.degToRad(p.rot);
    const c = Math.cos(r);
    const s = Math.sin(r);
    // H = P · A · E (rotation + shift, then stretch + shear, then perspective tilt)
    const E = [[c, -s, p.tx], [s, c, p.ty], [0, 0, 1]];
    const A = [[p.sx, p.shear, 0], [0, p.sy, 0], [0, 0, 1]];
    const Pm = [[1, 0, 0], [0, 1, 0], [p.p1, p.p2, 1]];
    const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
    return mul(Pm, mul(A, E));
  },

  /** Canonical representative of the class of (x, y, z); returns [x, y, z, fade]. */
  _rep(x, y, z, dim, chart) {
    if (dim === 3 && chart) {
      if (Math.abs(z) < 1e-3) {
        const l = Math.hypot(x, y) || 1;
        return [(x / l) * 9, (y / l) * 9, 1, 0];
      }
      let rx = x / z;
      let ry = y / z;
      const R = Math.hypot(rx, ry);
      const fade = 1 - sstep(R, 1.6, 2.6);
      if (R > 4) {
        rx *= 4 / R;
        ry *= 4 / R;
      }
      return [rx, ry, 1, fade];
    }
    if (dim === 3) {
      const l = Math.hypot(x, y, z) || 1;
      const sg = z < 0 ? -1 : 1;
      return [(sg * x) / l, (sg * y) / l, (sg * z) / l, 1];
    }
    if (chart) {
      if (Math.abs(y) < 1e-3) return [(x < 0 ? -9 : 9), 1, 0, 0];
      let rx = x / y;
      const R = Math.abs(rx);
      const fade = 1 - sstep(R, 1.6, 2.6);
      rx = THREE.MathUtils.clamp(rx, -4, 4);
      return [rx, 1, 0, fade];
    }
    const l = Math.hypot(x, y) || 1;
    const sg = y < 0 ? -1 : 1;
    return [(sg * x) / l, (sg * y) / l, 0, 1];
  },

  _updateQuotient(elapsed) {
    const q = this.q;
    const p = this.params;
    const dim = p.space;
    const chart = p.model === 'chart';
    const vw = p.view;
    const c = vw === 'proj' ? 1 : p.collapse;
    const H = dim === 3 && p.applyH ? this._H() : null;
    const T = (x, y, z) => (H ? [H[0][0] * x + H[0][1] * y + H[0][2] * z, H[1][0] * x + H[1][1] * y + H[1][2] * z, H[2][0] * x + H[2][1] * y + H[2][2] * z] : [x, y, z]);
    const dirs = dim === 3 ? q.dirs3 : q.dirs2;
    const N = dirs.length;
    const hueOf = (i) => i / N;

    // Layout of the two spaces
    q.gV.visible = vw !== 'proj';
    q.gP.visible = vw !== 'vector';
    if (vw === 'vector') {
      q.gV.position.set(0, 0, 0); q.gV.scale.setScalar(1);
    } else if (vw === 'side') {
      q.gV.position.set(-1.55, 0, 0); q.gV.scale.setScalar(0.78);
      q.gP.position.set(1.5, 0, 0); q.gP.scale.setScalar(0.95);
    } else {
      q.gP.position.set(0, 0, 0); q.gP.scale.setScalar(1.15);
    }

    // The mapped position of a vector (collapsed toward its class representative)
    const place = (x, y, z) => {
      const [tx, ty, tz] = T(x, y, z);
      if (c <= 0) return { p: [tx, ty, tz], k: 1 };
      const r = this._rep(tx, ty, tz, dim, chart);
      return { p: [lerp(tx, r[0], c), lerp(ty, r[1], c), lerp(tz, r[2], c)], k: lerp(1, r[3], c) };
    };

    // --- cloud: every class carries several multiples λu
    q.cloud.reset();
    q.classLines.reset();
    for (let i = 0; i < N; i++) {
      const u = dirs[i];
      const col = hsl(hueOf(i), 0.8, 0.62);
      for (const lm of MULTIPLES) {
        const m = place(u[0] * lm, u[1] * lm, u[2] * lm);
        q.cloud.add(m.p, scale3(col, m.k));
      }
      if (c < 0.995) {
        const a = T(-u[0] * 1.4, -u[1] * 1.4, -u[2] * 1.4);
        const b = T(u[0] * 1.4, u[1] * 1.4, u[2] * 1.4);
        q.classLines.add(a, b, scale3(col, 0.32 * (1 - c)));
      }
    }
    q.cloud.flush();
    q.classLines.flush();

    // --- the chosen vector v, its multiples λv, and its class
    const th = THREE.MathUtils.degToRad(p.theta);
    const ph = THREE.MathUtils.degToRad(p.phi);
    const v0 = dim === 3 ? [p.len * Math.sin(ph) * Math.cos(th), p.len * Math.sin(ph) * Math.sin(th), p.len * Math.cos(ph)] : [p.len * Math.cos(th), p.len * Math.sin(th), 0];
    const head = place(...v0);
    const lamP = place(v0[0] * p.lambda, v0[1] * p.lambda, v0[2] * p.lambda);
    q.head.position.set(...head.p);
    q.lam.position.set(...lamP.p);
    q.lam.scale.setScalar(1 + 0.15 * Math.sin(elapsed * 4));
    q.selLines.reset();
    q.selLines.add([0, 0, 0], head.p, [1, 1, 1]);
    if (c < 0.995) {
      const a = T(-v0[0] * 2, -v0[1] * 2, -v0[2] * 2);
      const b = T(v0[0] * 2, v0[1] * 2, v0[2] * 2);
      q.selLines.add(a, b, scale3(GOLD, 0.8 * (1 - c)));
    }
    q.selLines.flush();
    q.ticks.reset();
    for (const k of [-2, -1, 2]) {
      const m = place(v0[0] * k, v0[1] * k, v0[2] * k);
      q.ticks.add(m.p, scale3(GOLD, 0.6 * m.k));
    }
    q.ticks.flush();
    q.origin.visible = true;
    q.origin.lookAt?.(this.engine.camera.position);

    // --- parallels (R³ only): two planes through O meeting along a line inside z = 0
    const showPar = dim === 3 && p.parallels && !H;
    q.parV.reset();
    q.parPlanes.forEach((m) => (m.visible = showPar));
    q.parP.reset();
    if (showPar) this._updateParallels(chart);
    q.parV.flush();
    q.parP.flush();

    // --- P(V): one point per class
    this._updateProjective(dirs, N, T, dim, chart, v0, hueOf);

    // --- link between the two spaces (side by side)
    q.link.reset();
    if (vw === 'side') {
      const toWorld = (g, pt) => [g.position.x + g.scale.x * pt[0], g.position.y + g.scale.x * pt[1], g.position.z + g.scale.x * pt[2]];
      const target = q.selP.position.toArray();
      const tw = toWorld(q.gP, target);
      q.link.add(toWorld(q.gV, head.p), tw, [0.9, 0.9, 0.9], GOLD);
      q.link.add(toWorld(q.gV, lamP.p), tw, [0.6, 0.45, 0.1], GOLD);
    }
    q.link.flush();
    this._ro = (this._ro || 0) + 1;
    if (this._ro > 10) {
      this._ro = 0;
      this._updateReadout();
    }
  },

  _updateProjective(dirs, N, T, dim, chart, v0, hueOf) {
    const q = this.q;
    const pts = q.ptsP;
    pts.reset();
    const toP = (x, y, z) => {
      if (dim === 3 && chart) {
        if (Math.abs(z) < 1e-4) {
          const l = Math.hypot(x, y) || 1;
          return [x / l, y / l, 0];
        }
        const X = x / z;
        const Y = y / z;
        const s = 1 / (1 + Math.hypot(X, Y));
        return [X * s, Y * s, 0];
      }
      if (dim === 3) {
        const l = Math.hypot(x, y, z) || 1;
        const sg = z < 0 ? -1 : 1;
        return [(sg * x) / l, (sg * y) / l, (sg * z) / l];
      }
      const psi = 2 * Math.atan2(y, x) + Math.PI / 2; // [x : y] with y = 0 sits at the top (infinity)
      return [Math.cos(psi), Math.sin(psi), 0];
    };
    for (let i = 0; i < N; i++) {
      const u = dirs[i];
      const [x, y, z] = T(u[0], u[1], u[2]);
      const col = hsl(hueOf(i), 0.8, 0.62);
      const pt = toP(x, y, z);
      pts.add(pt, col);
      if (dim === 3 && !chart) pts.add([-pt[0], -pt[1], -pt[2]], scale3(col, 0.45)); // identified antipode
    }
    pts.flush();
    const [vx, vy, vz] = T(...v0);
    const sp = toP(vx, vy, vz);
    q.selP.position.set(...sp);
    q.selP2.visible = dim === 3 && !chart;
    q.selP2.position.set(-sp[0], -sp[1], -sp[2]);
  },

  _updateParallels(chart) {
    const q = this.q;
    const p = this.params;
    const a = THREE.MathUtils.degToRad(p.alpha);
    const d = [Math.cos(a), Math.sin(a)];
    const nrm = [-Math.sin(a), Math.cos(a)];
    const h = 0.5;
    const S = 1.35;
    const colors = [[0.22, 0.65, 0.95], [0.95, 0.4, 0.7]];
    [1, -1].forEach((sg, i) => {
      // plane  n·(x, y) = sg·h·z   — corner points (s along d, z along the vertical)
      const pt = (s, z) => [s * d[0] + sg * h * z * nrm[0], s * d[1] + sg * h * z * nrm[1], z];
      const corners = [pt(-S, -S), pt(S, -S), pt(S, S), pt(-S, S)];
      const arr = q.parPlanes[i].geometry.attributes.position.array;
      [0, 1, 2, 0, 2, 3].forEach((ci, k) => arr.set(corners[ci], k * 3));
      q.parPlanes[i].geometry.attributes.position.needsUpdate = true;
      // the line of the chart (z = 1)
      q.parV.add(pt(-S, 1), pt(S, 1), colors[i]);
      // in P(V)
      if (chart) {
        let prev = null;
        for (let k = 0; k <= 60; k++) {
          const s = Math.tan(((k / 60) - 0.5) * Math.PI * 0.985) * 1.4;
          const X = s * d[0] + sg * h * nrm[0];
          const Y = s * d[1] + sg * h * nrm[1];
          const sc = 1 / (1 + Math.hypot(X, Y));
          const cur = [X * sc, Y * sc, 0];
          if (prev) q.parP.add(prev, cur, colors[i]);
          prev = cur;
        }
      } else {
        const N = [nrm[0], nrm[1], -sg * h];
        const l = Math.hypot(...N);
        const n3 = N.map((v) => v / l);
        const e1 = [d[0], d[1], 0];
        const e2 = [n3[1] * e1[2] - n3[2] * e1[1], n3[2] * e1[0] - n3[0] * e1[2], n3[0] * e1[1] - n3[1] * e1[0]];
        let prev = null;
        for (let k = 0; k <= 64; k++) {
          const t = (k / 64) * TAU;
          const cur = [Math.cos(t) * e1[0] + Math.sin(t) * e2[0], Math.cos(t) * e1[1] + Math.sin(t) * e2[1], Math.cos(t) * e1[2] + Math.sin(t) * e2[2]];
          if (prev) q.parP.add(prev, cur, colors[i]);
          prev = cur;
        }
      }
    });
    // where the planes meet: a line of directions in z = 0, i.e. one point at infinity
    q.parV.add([-S * d[0], -S * d[1], 0], [S * d[0], S * d[1], 0], GOLD);
    // mark the point at infinity (and its identified antipode) with a small gold cross
    [1, -1].forEach((sg) => {
      const P0 = [sg * d[0], sg * d[1], 0];
      const r = [d[0] * 0.05, d[1] * 0.05, 0];
      const t = [-d[1] * 0.05, d[0] * 0.05, 0];
      q.parP.add([P0[0] - r[0], P0[1] - r[1], 0], [P0[0] + r[0], P0[1] + r[1], 0], GOLD);
      q.parP.add([P0[0] - t[0], P0[1] - t[1], 0], [P0[0] + t[0], P0[1] + t[1], 0], GOLD);
    });
  },

  // ======================================================================================
  // GEOMETRY LADDER
  // ======================================================================================
  _buildLadder() {
    this.ld = { lines: new DynLines(1700, 0.9) };
    this.layers.ladder.add(this.ld.lines.obj);
    this._dirty = true;
  },

  _updateLadder() {
    const H = this._H();
    const L = this.ld.lines;
    L.reset();
    const map = (x, y) => {
      const X = H[0][0] * x + H[0][1] * y + H[0][2];
      const Y = H[1][0] * x + H[1][1] * y + H[1][2];
      const W = H[2][0] * x + H[2][1] * y + H[2][2];
      return [X / W, Y / W, W];
    };
    const ok = (a) => a[2] > 0.12 && Math.hypot(a[0], a[1]) < 2.8;
    const poly = (pts, color, fadeScale = 1) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = map(...pts[i]);
        const b = map(...pts[i + 1]);
        if (!ok(a) || !ok(b)) continue;
        const f = fadeScale * (1 - sstep(Math.hypot(a[0], a[1]), 1.6, 2.8));
        L.add([a[0], a[1], 0], [b[0], b[1], 0], scale3(color, f));
      }
    };
    const span = 2.4;
    const samples = 40;
    const line = (fixed, horizontal) =>
      Array.from({ length: samples + 1 }, (_, i) => {
        const t = -span + (i / samples) * 2 * span;
        return horizontal ? [t, fixed] : [fixed, t];
      });
    for (let k = -6; k <= 6; k++) {
      const v = k * 0.4;
      const axis = k === 0;
      poly(line(v, true), axis ? [0.5, 0.75, 1] : [0.14, 0.3, 0.55]);
      poly(line(v, false), axis ? [1, 0.5, 0.85] : [0.45, 0.16, 0.38]);
    }
    // unit circle and an "F" to expose reflections, shears and rotations
    const circle = Array.from({ length: 65 }, (_, i) => [0.8 * Math.cos((i / 64) * TAU), 0.8 * Math.sin((i / 64) * TAU)]);
    poly(circle, GOLD);
    poly([[0.25, 0.15], [0.25, 0.75], [0.6, 0.75]], [1, 1, 1]);
    poly([[0.25, 0.45], [0.5, 0.45]], [1, 1, 1]);

    // Horizon: the image of the line at infinity (only when the projective tilt is non-zero)
    const c1 = [H[0][0], H[1][0], H[2][0]];
    const c2 = [H[0][1], H[1][1], H[2][1]];
    const l = [c1[1] * c2[2] - c1[2] * c2[1], c1[2] * c2[0] - c1[0] * c2[2], c1[0] * c2[1] - c1[1] * c2[0]];
    this.ladderHorizon = Math.hypot(l[0], l[1]) > 1e-3;
    if (this.ladderHorizon) {
      const pts = [];
      for (let i = -1; i <= 1; i += 1) {
        const t = i * 3;
        pts.push(Math.abs(l[1]) > Math.abs(l[0]) ? [t, (-l[2] - l[0] * t) / l[1]] : [(-l[2] - l[1] * t) / l[0], t]);
      }
      L.add([pts[0][0], pts[0][1], 0], [pts[2][0], pts[2][1], 0], [1, 0.75, 0.2]);
    }
    L.flush();
    this._updateReadout();
  },

  // ======================================================================================
  _updateReadout() {
    if (!this._readoutEl) return;
    const p = this.params;
    const f = (v, d = 2) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(d);
    let text = '';
    if (p.mode === 'shadows') {
      const n = p.dim;
      const V = 2 ** n;
      const E = n * 2 ** (n - 1);
      text = `${n}-cube • ${V} vertices (2^n) • ${E} edges (n·2^(n−1)) • ` +
        (p.proj === 'persp'
          ? `x′ = x · d / (d − x_k), d = ${f(p.dist)}; vertices with d ≤ x_k escape to infinity`
          : 'parallel projection: the last coordinate is simply dropped');
    } else if (p.mode === 'quotient') {
      const dim = p.space;
      const th = THREE.MathUtils.degToRad(p.theta);
      const ph = THREE.MathUtils.degToRad(p.phi);
      const v = dim === 3 ? [p.len * Math.sin(ph) * Math.cos(th), p.len * Math.sin(ph) * Math.sin(th), p.len * Math.cos(ph)] : [p.len * Math.cos(th), p.len * Math.sin(th)];
      const w = v.map((x) => x * p.lambda);
      const last = v[dim - 1];
      const lam = f(p.lambda);
      const hom = `[${v.map((x) => f(x)).join(' : ')}]`;
      const chartPt = Math.abs(last) < 0.01 ? '∞  (last coordinate = 0)' : `(${v.slice(0, dim - 1).map((x) => f(x / last)).join(', ')})`;
      text = Math.abs(p.lambda) < 0.01
        ? 'λ = 0 sends v to the origin, which is excluded: 0 belongs to no line, so it is not a point of P(V)'
        : `v = (${v.map((x) => f(x)).join(', ')}) → ${hom} → chart ${chartPt} • λ = ${lam}: λv = (${w.map((x) => f(x)).join(', ')}) → same point ⇒ v ~ λv`;
      if (p.parallels && dim === 3 && !p.applyH) text += ' • two parallel lines = two planes through O, meeting in a direction of z = 0: a point at infinity';
    } else {
      const H = this._H();
      const m = (x, y) => {
        const W = H[2][0] * x + H[2][1] * y + H[2][2];
        return [(H[0][0] * x + H[0][1] * y + H[0][2]) / W, (H[1][0] * x + H[1][1] * y + H[1][2]) / W];
      };
      const e = 1e-3;
      const o = m(0, 0);
      const a = m(e, 0).map((x, i) => (x - o[i]) / e);
      const b = m(0, e).map((x, i) => (x - o[i]) / e);
      const ang = (Math.acos((a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))) * 180) / Math.PI;
      const det = a[0] * b[1] - a[1] * b[0];
      const affine = Math.abs(p.p1) < 0.005 && Math.abs(p.p2) < 0.005;
      const euclid = affine && Math.abs(p.sx - 1) < 0.01 && Math.abs(p.sy - 1) < 0.01 && Math.abs(p.shear) < 0.01;
      const kind = euclid
        ? 'EUCLIDEAN — lengths, angles, parallels and ratios are all preserved'
        : affine
          ? 'AFFINE — parallels and ratios along a line are preserved; lengths and angles are not'
          : 'PROJECTIVE — only straightness and the cross-ratio survive; parallels meet on the horizon (gold)';
      text = `${kind} • grid axes meet at ${f(ang, 1)}° • area × ${f(det)} • H = [${H.map((r) => r.map((x) => f(x)).join(' ')).join(' | ')}]`;
    }
    this._readoutEl.textContent = text;
  }
};
