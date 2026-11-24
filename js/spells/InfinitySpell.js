import * as THREE from 'three';
import { fxState } from '../core/FXState.js?v=23';
import { renderMathInElementSafe } from '../core/MathRenderer.js?v=26';

const shouldAnimateIntro = () =>
  fxState.enabled && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const material = (color, opacity = 0.9, size = 0.06) => new THREE.PointsMaterial({
  color,
  size,
  transparent: true,
  opacity,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true
});

function pointsObject(points, color, size = 0.055, opacity = 0.95) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap((p) => p), 3));
  return new THREE.Points(geo, material(color, opacity, size));
}

function lineObject(segments, color, opacity = 0.68, lineWidth = 1) {
  const coords = [];
  segments.forEach(([a, b]) => coords.push(...a, ...b));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    linewidth: lineWidth
  }));
}

function circlePoint(radius, angle, y = 0) {
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function disposeTree(root) {
  if (!root) return;
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.filter(Boolean).forEach((m) => m.dispose?.());
  });
}

function setOpacity(root, opacity) {
  root.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.filter(Boolean).forEach((m) => {
      if (m.transparent) m.opacity = opacity * (m.userData.baseOpacity ?? 1);
    });
  });
}

function rememberOpacity(root) {
  root.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.filter(Boolean).forEach((m) => {
      m.userData.baseOpacity = m.opacity ?? 1;
      m.transparent = true;
      m.depthWrite = false;
    });
  });
}

function sphere(color, radius = 0.07, opacity = 0.95) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
}

/**
 * InfinitySpell — four interactive visual studies of cardinal infinity.
 * All particle counts and densities are visual metaphors, never literal cardinalities.
 */
export const InfinitySpell = {
  id: 'infinity',
  name: 'Infinity',
  isolateStage: true,
  hasLiveReadout: true,
  initialReadout: String.raw`\(\aleph_0\) — countable infinity: \(\mathbb{N}\), \(\mathbb{Z}\) and \(\mathbb{Q}\) have the same cardinality.`,
  description: 'Explore countable infinity, Cantor’s diagonal argument, the power-set theorem and the aleph hierarchy.',
  controls: [
    {
      id: 'page', type: 'choice', label: 'Study', default: 'aleph0',
      options: [
        { value: 'aleph0', label: String.raw`\(\aleph_0\) — Countable`, formula: String.raw`\lvert\mathbb{N}\rvert=\lvert\mathbb{Z}\rvert=\lvert\mathbb{Q}\rvert=\aleph_0`, legend: String.raw`A countably infinite set can be listed in a sequence. Explore the integer zigzag, enumerate reduced rational fractions by diagonals, and move every guest in Hilbert’s Hotel from \(n\) to \(n+1\).`, note: String.raw`Convention: this illustration uses \(\mathbb{N}_0=\{0,1,2,\ldots\}\). The rational lattice keeps \(q>0\) and \(\gcd(\lvert p\rvert,q)=1\), so each rational appears only once.` },
        { value: 'diagonal', label: 'Diagonal', formula: String.raw`2^{\aleph_0}>\aleph_0`, legend: String.raw`Assume a list of infinite binary sequences. Flip the \(i\)-th bit of row \(i\) to create a new sequence. It differs from every listed row in at least one position, so the list cannot be complete.`, note: String.raw`Only a finite prefix is drawn on screen; the proof concerns infinitely many bits. Binary sequences have cardinality \(2^{\aleph_0}\); the correspondence with reals requires care because some reals have two binary expansions.` },
        { value: 'power', label: 'Power Set', formula: String.raw`\lvert\mathcal{P}(A)\rvert=2^{\lvert A\rvert}>\lvert A\rvert`, legend: String.raw`Every subset of \(A\) is a vertex of \(\mathcal{P}(A)\). For a finite \(n\)-element set, the \(n\)-cube has \(2^n\) vertices. A diagonal subset \(D=\{a\in A:a\notin f(a)\}\) is not in the image of any proposed map \(f:A\to\mathcal{P}(A)\).`, note: String.raw`Edges join subsets that differ by one element. The finite \(n\)-cube links to Projection; the diagonal proof itself works for every set \(A\), finite or infinite.` },
        { value: 'ladder', label: 'Aleph Ladder', formula: String.raw`\aleph_0<\aleph_1<\aleph_2<\cdots`, legend: String.raw`Each successor aleph is the least cardinal strictly larger than the preceding cardinal. Choose \(k=0,\ldots,5\) to ascend through a displayed segment of the hierarchy.`, note: String.raw`Continuum Hypothesis: \(2^{\aleph_0}=\aleph_1\)? Assuming ZFC is consistent, neither this statement nor its negation is provable from ZFC (Gödel and Cohen). Particle density is metaphorical, not a cardinality scale.` }
      ]
    },
    {
      id: 'model', type: 'choice', label: 'Countable model', default: 'integers',
      options: [
        { value: 'integers', label: String.raw`\(\mathbb{Z}\) zigzag` },
        { value: 'rationals', label: String.raw`\(\mathbb{Q}\) lattice` },
        { value: 'hotel', label: 'Hilbert Hotel' }
      ],
      showWhen: (p) => p.page === 'aleph0'
    },
    {
      id: 'hotelShift', type: 'action', label: 'Hilbert Hotel', buttonLabel: (spell) => spell.hotelShifted ? 'Reset the hotel arrangement' : String.raw`Move every guest to \(n+1\)`,
      showWhen: (p) => p.page === 'aleph0' && p.model === 'hotel'
    },
    { id: 'rows', label: 'Listed sequences', min: 6, max: 14, step: 1, default: 10, format: (v) => String.raw`\(${v}\) rows`, showWhen: (p) => p.page === 'diagonal' },
    {
      id: 'shuffle', type: 'action', label: 'New candidate list', buttonLabel: 'Shuffle sequences',
      showWhen: (p) => p.page === 'diagonal'
    },
    { id: 'dimension', label: String.raw`Finite set size \(n\)`, min: 1, max: 5, step: 1, default: 4, format: (v) => String.raw`\(n=${v}\)`, showWhen: (p) => p.page === 'power' },
    {
      id: 'construct', type: 'action', label: 'Cantor construction', buttonLabel: String.raw`Construct diagonal set \(D\)`,
      showWhen: (p) => p.page === 'power'
    },
    { id: 'k', label: String.raw`Aleph index \(k\)`, min: 0, max: 5, step: 1, default: 0, format: (v) => String.raw`\(\aleph_{${v}}\)`, showWhen: (p) => p.page === 'ladder' }
  ],

  engine: null,
  root: null,
  visualGroup: null,
  outgoingGroup: null,
  transitionT: 1,
  randomSeed: 7,
  sequenceRows: [],
  hotelShifted: false,
  diagonalConstructed: false,
  diagonalMask: 0,

  onActivate(engine) {
    this.engine = engine;
    this.root = new THREE.Group();
    this.root.name = 'InfinityCantorWorld';
    this.engine.spellLayer.add(this.root);
    this.hotelShifted = false;
    this._buildVisual(false);
    this._updateReadout();
  },

  onParamChange(id) {
    if (id === 'dimension') this.diagonalConstructed = false;
    if (id === 'page' || id === 'model' || id === 'rows' || id === 'dimension' || id === 'k') {
      this._buildVisual(false);
      this._updateReadout();
    }
  },

  onAction(id) {
    if (id === 'hotelShift') {
      this.hotelShifted = !this.hotelShifted;
    } else if (id === 'shuffle') {
      this.randomSeed++;
      this._generateBinaryRows();
    } else if (id === 'construct') {
      this.diagonalConstructed = true;
      this._computeFiniteDiagonal();
    }
    this._buildVisual(false);
    this._updateReadout();
  },

  _rand() {
    // Deterministic per shuffle so a shared state is reproducible until the next Shuffle action.
    this.randomSeed = (this.randomSeed * 1664525 + 1013904223) >>> 0;
    return this.randomSeed / 4294967296;
  },

  _generateBinaryRows() {
    const count = this.params.rows || 10;
    const width = 16;
    this.sequenceRows = Array.from({ length: count }, () =>
      Array.from({ length: width }, () => (this._rand() > 0.5 ? 1 : 0))
    );
  },

  _computeFiniteDiagonal() {
    const n = this.params.dimension || 4;
    const size = 2 ** n;
    this.functionMasks = Array.from({ length: n }, () => Math.floor(this._rand() * size));
    let mask = 0;
    for (let i = 0; i < n; i++) {
      if ((this.functionMasks[i] & (1 << i)) === 0) mask |= (1 << i);
    }
    this.diagonalMask = mask;
  },

  _updateReadout() {
    if (!this._readoutEl) return;
    const page = this.params.page || 'aleph0';
    if (page === 'aleph0') {
      const model = this.params.model || 'integers';
      if (model === 'integers') {
        this._readoutEl.textContent = String.raw`\(\mathbb{Z}: 0,1,-1,2,-2,3,-3,\ldots\)` + ' Pair the ' + String.raw`\(n\)` + '-th entry with ' + String.raw`\(n\in\mathbb{N}\)` + '.';
      } else if (model === 'rationals') {
        this._readoutEl.textContent = String.raw`\(\mathbb{Q}: p/q,\quad q>0,\quad \gcd(|p|,q)=1\)` + ' — enumerate reduced fractions by diagonals; skip duplicates.';
      } else {
        this._readoutEl.textContent = this.hotelShifted
          ? String.raw`All guests moved \(n\mapsto n+1\). Room \(1\) is now available for the new guest.`
          : String.raw`Every room is occupied. Move guest \(n\) to room \(n+1\), then welcome a new guest into room \(1\).`;
      }
    } else if (page === 'diagonal') {
      if (!this.sequenceRows.length) this._generateBinaryRows();
      const bits = this.sequenceRows.map((row, i) => row[i % row.length] ? 0 : 1).join('');
      this._readoutEl.textContent = String.raw`Diagonal complement (first \(${bits.length}\) bits): \(${bits}\). It differs from row \(i\) at position \(i\).`;
    } else if (page === 'power') {
      const n = this.params.dimension || 4;
      if (this.diagonalConstructed) {
        this._readoutEl.textContent = String.raw`\(n=${n}: \lvert\mathcal{P}(A)\rvert=2^n=${2 ** n}\). The highlighted \(D\) is not hit by any arrow \(f(a)\).`;
      } else {
        this._readoutEl.textContent = String.raw`Choose \(n=${n}\): the \(n\)-cube has \(2^n=${2 ** n}\) vertices, one for each subset of \(A\). Then construct \(D=\{a\in A:a\notin f(a)\}\).`;
      }
    } else {
      const k = this.params.k || 0;
      const subscripts = ['₀','₁','₂','₃','₄','₅'];
      this._readoutEl.textContent = String.raw`Selected level \(\aleph_{${k}}\). Each step is the next aleph cardinal; particle density is illustrative, not a scale.`;
    }
    renderMathInElementSafe(this._readoutEl);
  },

  _buildVisual(initial = false) {
    if (!this.root) return;
    const animate = !initial && shouldAnimateIntro();
    if (!initial && this.visualGroup) {
      if (this.outgoingGroup) {
        this.root.remove(this.outgoingGroup);
        disposeTree(this.outgoingGroup);
      }
      this.outgoingGroup = this.visualGroup;
    }

    const next = new THREE.Group();
    next.name = `Infinity_${this.params.page || 'aleph0'}`;
    const page = this.params.page || 'aleph0';
    if (page === 'aleph0') this._buildCountable(next);
    else if (page === 'diagonal') this._buildDiagonal(next);
    else if (page === 'power') this._buildPowerSet(next);
    else this._buildAlephLadder(next);

    rememberOpacity(next);
    next.scale.setScalar(animate ? 0.78 : 1);
    if (animate) setOpacity(next, 0.02);
    this.root.add(next);
    this.visualGroup = next;
    this.transitionT = animate ? 0 : 1;
    if ((!animate || initial) && this.outgoingGroup) {
      this.root.remove(this.outgoingGroup);
      disposeTree(this.outgoingGroup);
      this.outgoingGroup = null;
    }
  },

  _buildCountable(group) {
    const model = this.params.model || 'integers';
    if (model === 'integers') {
      const pts = [];
      const segments = [];
      const sequence = [0];
      for (let n = 1; n <= 10; n++) sequence.push(n, -n);
      sequence.forEach((value, i) => {
        const x = (i - (sequence.length - 1) / 2) * 0.19;
        const y = value === 0 ? 0 : (value > 0 ? 0.34 : -0.34) * (0.72 + Math.min(1, Math.abs(value) / 8) * 0.28);
        const p = [x, y, 0];
        pts.push(p);
        if (i) segments.push([pts[i - 1], p]);
      });
      group.add(lineObject(segments, '#9e9aff', 0.72));
      group.add(pointsObject(pts, '#62d7ff', 0.1));
      const pairing = [];
      for (let i = 0; i < 10; i++) {
        const x = -1.72 + i * 0.38;
        pairing.push([[x, -0.83, -0.28], [x, 0.83, -0.28]]);
      }
      group.add(lineObject(pairing, '#f5c96b', 0.5));
      group.add(pointsObject(pairing.flatMap(([a, b]) => [a, b]), '#f5c96b', 0.045));
    } else if (model === 'rationals') {
      const ordered = [];
      for (let sum = 1; sum <= 12; sum++) {
        const candidates = [];
        for (let q = 1; q <= 7; q++) {
          const absP = sum - q;
          // Stay on the |p| + q = sum diagonal; q is always positive.
          if (absP < 0 || absP > 7) continue;
          const ps = absP === 0 ? [0] : [absP, -absP];
          ps.forEach((p) => {
            if (gcd(p, q) === 1) candidates.push({ p, q });
          });
        }
        if (sum % 2) candidates.reverse();
        ordered.push(...candidates);
      }
      const unique = [];
      const seen = new Set();
      ordered.forEach(({ p, q }) => {
        const key = `${p}/${q}`;
        if (!seen.has(key)) { seen.add(key); unique.push({ p, q }); }
      });
      const pts = unique.slice(0, 64).map(({ p, q }, i) => [p * 0.18, (q - 4) * 0.24, Math.sin(i * 0.3) * 0.13]);
      group.add(pointsObject(pts, '#73ddff', 0.06));
      const segments = pts.slice(1).map((p, i) => [pts[i], p]);
      group.add(lineObject(segments, '#b0a5ff', 0.42));
      const grid = [];
      for (let p = -4; p <= 4; p++) grid.push([[p * 0.18, -0.95, -0.15], [p * 0.18, 0.95, -0.15]]);
      for (let q = 1; q <= 7; q++) grid.push([[-0.85, (q - 4) * 0.24, -0.15], [0.85, (q - 4) * 0.24, -0.15]]);
      group.add(lineObject(grid, '#426c92', 0.18));
    } else {
      const doors = [];
      const guests = [];
      const guestPositions = [];
      const count = 12;
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * 0.31;
        const z = Math.cos((i / (count - 1) - 0.5) * Math.PI) * 0.22;
        const w = 0.22, h = 0.34;
        doors.push([[x - w, -0.42, z], [x - w, 0.42, z], [x + w, 0.42, z], [x + w, -0.42, z], [x - w, -0.42, z]]);
        // After n -> n+1, room 1 is left vacant; the new visitor occupies it.
        if (this.hotelShifted) {
          if (i > 0) guestPositions.push([x, -0.04, z + 0.035]);
        } else if (i === 0) {
          guests.push([x, -0.04, z + 0.035]);
        } else {
          guestPositions.push([x, -0.04, z + 0.035]);
        }
      }
      group.add(lineObject(doors.flatMap((door) => door.slice(1).map((p, i) => [door[i], p])), '#63d8ff', 0.62));
      group.add(pointsObject(guestPositions, '#9a96ff', 0.085));
      if (!this.hotelShifted) group.add(pointsObject(guests, '#f5c96b', 0.085));
      else {
        const newGuest = sphere('#f5c96b', 0.095);
        newGuest.position.set(-1.72, -0.04, 0.25);
        group.add(newGuest);
      }
    }

    // Central countability seal.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.008, 6, 72),
      new THREE.MeshBasicMaterial({ color: '#f5c96b', transparent: true, opacity: 0.64, blending: THREE.AdditiveBlending })
    );
    ring.position.set(0, 0, 0.38);
    group.add(ring);
  },

  _buildDiagonal(group) {
    if (!this.sequenceRows.length || this.sequenceRows.length !== (this.params.rows || 10)) this._generateBinaryRows();
    const rows = this.sequenceRows;
    const cols = rows[0].length;
    const zeros = [];
    const ones = [];
    const diagonal = [];
    const output = [];
    const lines = [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * 0.16;
        const y = (rows.length / 2 - r) * 0.17;
        const bit = rows[r][c];
        const p = [x, y, bit ? 0.13 : -0.13];
        if (r === c) {
          diagonal.push([x, y, bit ? 0.24 : -0.24]);
          output.push([x, -1.22, bit ? 0.28 : -0.08]);
        } else if (bit) ones.push(p);
        else zeros.push(p);
      }
      const x0 = (-((cols - 1) / 2)) * 0.16;
      const x1 = ((cols - 1) / 2) * 0.16;
      const y = (rows.length / 2 - r) * 0.17;
      lines.push([[x0, y, -0.05], [x1, y, -0.05]]);
    }
    group.add(lineObject(lines, '#567ca2', 0.18));
    group.add(pointsObject(zeros, '#5798c4', 0.043, 0.68));
    group.add(pointsObject(ones, '#9b8cff', 0.052, 0.86));
    group.add(pointsObject(diagonal, '#f5c96b', 0.108, 1));
    group.add(lineObject(diagonal.slice(1).map((p, i) => [diagonal[i], p]), '#f5c96b', 0.92));
    group.add(pointsObject(output, '#b7a3ff', 0.078, 1));
    group.add(lineObject([[[-1.18, -1.22, 0.24], [1.18, -1.22, 0.24]]], '#a78bfa', 0.56));

    // The diagonal complement differs from row i at its i-th bit.
    const complement = rows.map((row, i) => row[i % cols] ? 0 : 1);
    const bitPts = complement.map((bit, i) => [1.48 + (bit ? 0.08 : -0.08), 0.78 - i * 0.17, bit ? 0.25 : -0.12]);
    group.add(pointsObject(bitPts, '#9b8cff', 0.078, 0.98));
    group.add(lineObject(bitPts.slice(1).map((p, i) => [bitPts[i], p]), '#9b8cff', 0.55));
  },

  _buildPowerSet(group) {
    const n = this.params.dimension || 4;
    const count = 2 ** n;
    const basis = [
      [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.62, 0.62, 0.62], [-0.62, 0.62, -0.62]
    ];
    const positions = [];
    for (let mask = 0; mask < count; mask++) {
      const v = [0, 0, 0];
      for (let bit = 0; bit < n; bit++) {
        const sign = mask & (1 << bit) ? 1 : -1;
        for (let axis = 0; axis < 3; axis++) v[axis] += sign * basis[bit][axis];
      }
      positions.push(v.map((x) => x * 0.43));
    }
    const edgePairs = [];
    for (let mask = 0; mask < count; mask++) {
      for (let bit = 0; bit < n; bit++) {
        const next = mask ^ (1 << bit);
        if (mask < next) edgePairs.push([positions[mask], positions[next]]);
      }
    }
    group.add(lineObject(edgePairs, '#68cfff', 0.58));
    group.add(pointsObject(positions, '#75d9ff', 0.075, 0.95));

    // Show a finite function f: A -> P(A). The diagonal set is a highlighted vertex with no incoming arrow.
    const leftNodes = [];
    const mappingLines = [];
    const subsets = positions.map((p, i) => [p[0] + 1.25, p[1], p[2]]);
    const diagonalMask = this.diagonalMask;
    const masks = this.diagonalConstructed ? this.functionMasks : Array.from({ length: n }, (_, i) => (i * 3 + 1) % count);
    for (let i = 0; i < n; i++) {
      const from = [-2.15, (i - (n - 1) / 2) * 0.34, 0.12];
      leftNodes.push(from);
      const targetMask = masks[i] & (count - 1);
      mappingLines.push([from, subsets[targetMask]]);
    }
    group.add(lineObject(mappingLines, '#a78bfa', 0.5));
    group.add(pointsObject(leftNodes, '#f5c96b', 0.09));
    group.add(pointsObject(subsets, '#4ccfe7', 0.052, 0.78));

    if (this.diagonalConstructed) {
      const diagonal = sphere('#f5c96b', 0.13, 1);
      diagonal.position.set(...subsets[diagonalMask]);
      group.add(diagonal);
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.012, 6, 40),
        new THREE.MeshBasicMaterial({ color: '#f5c96b', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending })
      );
      halo.position.copy(diagonal.position);
      group.add(halo);
    }
  },

  _buildAlephLadder(group) {
    const k = this.params.k || 0;
    const steps = [];
    const particles = [];
    const lineSegs = [];
    for (let i = 0; i < 6; i++) {
      const x = -2.05 + i * 0.82;
      const y = -0.92 + i * 0.43;
      const z = 0;
      const platform = new THREE.Mesh(
        new THREE.BoxGeometry(0.56, 0.045, 0.52),
        new THREE.MeshBasicMaterial({
          color: i === k ? '#f5c96b' : '#4aaed1',
          transparent: true,
          opacity: i === k ? 0.78 : 0.32,
          blending: THREE.AdditiveBlending,
          wireframe: true
        })
      );
      platform.position.set(x, y, z);
      group.add(platform);
      steps.push([x, y, z]);
      if (i) lineSegs.push([steps[i - 1], steps[i]]);
      const count = 5 + i * 4; // Increasing density is explicitly an illustration, not a cardinality encoding.
      for (let j = 0; j < count; j++) {
        const a = j * 2.399963 + i * 0.31;
        const r = 0.12 + (j % 5) * 0.035;
        particles.push([x + Math.cos(a) * r, y + 0.12 + Math.sin(a * 1.31) * r, z + Math.sin(a) * r]);
      }
    }
    group.add(lineObject(lineSegs, '#f5c96b', 0.7));
    group.add(pointsObject(particles, '#9c9cff', 0.045, 0.7));
    group.add(pointsObject([steps[k].map((v, i) => i === 1 ? v + 0.19 : v)], '#fff0b0', 0.13, 1));

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.012, 6, 64),
      new THREE.MeshBasicMaterial({ color: '#f5c96b', transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending })
    );
    halo.position.set(steps[k][0], steps[k][1] + 0.15, steps[k][2]);
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
  },

  onUpdate(_elapsed, delta) {
    if (this.transitionT < 1 && this.visualGroup) {
      if (!shouldAnimateIntro()) this.transitionT = 1;
      else this.transitionT = Math.min(1, this.transitionT + delta / 0.95);
      const t = this.transitionT;
      const eased = t * t * (3 - 2 * t);
      this.visualGroup.scale.setScalar(shouldAnimateIntro() ? 0.78 + 0.22 * eased : 1);
      setOpacity(this.visualGroup, shouldAnimateIntro() ? Math.max(0.02, eased) : 1);
      if (this.outgoingGroup) {
        this.outgoingGroup.scale.setScalar(shouldAnimateIntro() ? 1 - 0.22 * eased : 0.001);
        setOpacity(this.outgoingGroup, shouldAnimateIntro() ? 1 - eased : 0);
        if (t >= 1) {
          this.root.remove(this.outgoingGroup);
          disposeTree(this.outgoingGroup);
          this.outgoingGroup = null;
        }
      }
    }
  },

  onDeactivate() {
    if (this.root) {
      this.engine.spellLayer.remove(this.root);
      disposeTree(this.root);
      this.root = null;
      this.visualGroup = null;
      this.outgoingGroup = null;
      this.engine = null;
    }
  }
};
