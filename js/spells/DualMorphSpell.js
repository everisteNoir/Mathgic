import * as THREE from 'three';

const sstep = THREE.MathUtils.smoothstep;
const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

// Shared shader for the dual's faces and edges: a bright band sweeps up (appear) or down (vanish),
// revealing the geometry below it. The dual's circumradius is 1, so height h = y/2 + 0.5 spans 0..1.
const SWEEP_VERT = `
  varying float vH;
  void main() {
    vH = position.y * 0.5 + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SWEEP_FRAG = `
  uniform vec3 uColor;
  uniform float uReveal;
  uniform float uOpacity;
  uniform float uBand;
  varying float vH;
  void main() {
    float below = 1.0 - smoothstep(uReveal - 0.02, uReveal + 0.02, vH);
    float front = exp(-pow((vH - uReveal) * 9.0, 2.0));
    float a = below * uOpacity + front * uBand;
    gl_FragColor = vec4(uColor + front * vec3(0.55), a);
  }
`;

function sweepMaterial(color, opacity, band, side) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uReveal: { value: 0 },
      uOpacity: { value: opacity },
      uBand: { value: band }
    },
    vertexShader: SWEEP_VERT,
    fragmentShader: SWEEP_FRAG,
    transparent: true,
    side,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}

/**
 * DualMorphSpell.js — Dual Twin (part of the Polyhedra section, switched on from the Mathgic Lab panel)
 * Connects the face centers of the active Platonic solid to manifest its dual twin inside the crystal frame.
 * Materializes with a rising light sweep, a spark burst and implosion flash, and dematerializes in reverse.
 */
export const DualMorphSpell = {
  id: 'dual-morph',
  name: 'Dual Twin',
  isolateStage: false,
  userToggle: true, // switched on/off by a button in the Polyhedra panel (not a menu section)
  outroDuration: 0.9,
  description:
    'The face centers of every Platonic solid form the vertices of its dual solid. Summon the geometric twin nested inside.',
  controls: [
    {
      id: 'morph',
      label: 'Dual summoning ratio',
      min: 0.2,
      max: 1.35,
      step: 0.01,
      default: 0.68,
      format: (v) => `${Math.round(v * 100)}%`
    }
  ],

  group: null,
  phase: 0, // 0 = not manifested, 1 = fully formed
  dir: 1, // +1 materializing, -1 dematerializing

  onActivate(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.engine.spellLayer.add(this.group);
    this._rebuildDual();
    this.phase = 0;
    this.dir = 1;
    this._apply(0);
  },

  onOutro() {
    this.dir = -1;
  },

  onSolidChanged() {
    if (!this.active) return;
    this._rebuildDual();
    this.phase = 0; // re-materialize for the new solid
    this.dir = 1;
  },

  onParamChange() {
    this._apply(0);
  },

  _clearGroup() {
    while (this.group.children.length > 0) {
      const c = this.group.children[0];
      c.geometry?.dispose();
      c.material?.dispose();
      this.group.remove(c);
    }
  },

  _rebuildDual() {
    if (!this.group || !this.engine.activeSolid) return;
    this._clearGroup();

    // The dual's vertices are the (normalized) face centers; each original vertex becomes one dual face
    const { vertices, faces, faceCenters } = this.engine.activeSolid.geoData;
    const centers = faceCenters.map((c) => c.clone().normalize());
    const positions = [];
    vertices.forEach((v, vi) => {
      const adj = [];
      faces.forEach((f, fi) => {
        if (f.includes(vi)) adj.push(fi);
      });
      const n = v.clone().normalize();
      const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const t1 = new THREE.Vector3().crossVectors(n, ref).normalize();
      const t2 = new THREE.Vector3().crossVectors(n, t1);
      const ang = (i) => Math.atan2(centers[i].dot(t2), centers[i].dot(t1));
      adj.sort((a, b) => ang(a) - ang(b));
      const pts = adj.map((i) => centers[i]);
      for (let k = 1; k < pts.length - 1; k++) {
        positions.push(
          pts[0].x, pts[0].y, pts[0].z,
          pts[k].x, pts[k].y, pts[k].z,
          pts[k + 1].x, pts[k + 1].y, pts[k + 1].z
        );
      }
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    this.faceMat = sweepMaterial('#38bdf8', 0.14, 0.12, THREE.DoubleSide);
    this.wireMat = sweepMaterial('#7dd3fc', 0.95, 1.2, THREE.FrontSide);
    this.group.add(new THREE.Mesh(geo, this.faceMat));
    const edgesGeo = new THREE.EdgesGeometry(geo);
    this.group.add(new THREE.LineSegments(edgesGeo, this.wireMat));

    // Sparks flaring at each dual vertex
    const sparkGeo = new THREE.BufferGeometry().setFromPoints(centers);
    this.sparkMat = new THREE.PointsMaterial({
      color: '#e0f2fe',
      size: 0.05,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.group.add(new THREE.Points(sparkGeo, this.sparkMat));

    // Motes: light dust drawn in from outside during materialization, blown outward during dematerialization
    const ep = edgesGeo.attributes.position;
    const N = 70;
    this.moteRest = new Float32Array(N * 3);
    this.moteDir = new Float32Array(N * 3);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const e = Math.floor(Math.random() * (ep.count / 2));
      a.fromBufferAttribute(ep, e * 2);
      b.fromBufferAttribute(ep, e * 2 + 1);
      p.lerpVectors(a, b, Math.random());
      this.moteRest.set([p.x, p.y, p.z], i * 3);
      const d = p.clone().normalize().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.35, (Math.random() - 0.5) * 0.6));
      this.moteDir.set([d.x, d.y, d.z], i * 3);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.moteRest), 3));
    this.moteMat = new THREE.PointsMaterial({
      color: '#bae6fd',
      size: 0.04,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.motes = new THREE.Points(moteGeo, this.moteMat);
    this.group.add(this.motes);

    // Birth flash at the center
    this.flashMat = new THREE.MeshBasicMaterial({
      color: '#e0f2fe',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20), this.flashMat);
    this.group.add(this.flash);
  },

  /** Applies every visual as a function of phase p (0..1) and the summoning ratio. */
  _apply(elapsed) {
    if (!this.group || !this.faceMat) return;
    const p = this.phase;
    const m = this.params.morph ?? 0.68;
    this.group.scale.setScalar(Math.max(0.0001, m * easeOutBack(p)));

    const reveal = p * 1.3 - 0.15;
    this.faceMat.uniforms.uReveal.value = reveal;
    this.wireMat.uniforms.uReveal.value = reveal;
    this.wireMat.uniforms.uOpacity.value = 0.72 + 0.28 * Math.sin(elapsed * 3.0);

    const bump = Math.exp(-Math.pow(p - 0.62, 2) / 0.015);
    this.flash.scale.setScalar(0.15 + 0.5 * bump);
    this.flashMat.opacity = 0.55 * bump;
    this.sparkMat.size = 0.05 + 0.12 * bump;
    this.sparkMat.opacity = 0.95 * sstep(p, 0.2, 0.5);

    const spread = (1 - p) * 0.9;
    const pos = this.motes.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.array[i * 3] = this.moteRest[i * 3] + this.moteDir[i * 3] * spread;
      pos.array[i * 3 + 1] = this.moteRest[i * 3 + 1] + this.moteDir[i * 3 + 1] * spread;
      pos.array[i * 3 + 2] = this.moteRest[i * 3 + 2] + this.moteDir[i * 3 + 2] * spread;
    }
    pos.needsUpdate = true;
    this.moteMat.opacity = 0.9 * Math.sin(Math.PI * p);
  },

  onUpdate(elapsed, delta) {
    if (!this.group || !this.engine.activeSolid) return;
    this.phase = THREE.MathUtils.clamp(this.phase + (this.dir * delta) / (this.dir > 0 ? 1.1 : this.outroDuration), 0, 1);
    this.group.position.y = this.engine.activeSolid.rootGroup.position.y;
    this._apply(elapsed);
  },

  onDeactivate() {
    if (this.group) {
      this._clearGroup();
      this.engine.spellLayer.remove(this.group);
      this.group = null;
      this.faceMat = null;
    }
  }
};
