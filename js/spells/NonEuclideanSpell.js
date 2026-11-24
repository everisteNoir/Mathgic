import * as THREE from 'three';
import { fxState } from '../core/FXState.js?v=23';
import { renderMathInElementSafe } from '../core/MathRenderer.js?v=26';

const shouldAnimateIntro = () =>
  fxState.enabled && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * NonEuclideanSpell.js — Mathgic 4: Non-Euclidean Space & Gaussian Curvature Portal
 * Morphs space continuously between:
 * - Hyperbolic Geometry (K < 0): Lobachevskian saddle manifold & Poincaré hyperbolic geodesics (triangle angles < 180°)
 * - Flat Euclidean Geometry (K = 0): Standard zero-curvature space (triangle angles = 180°)
 * - Spherical / Elliptic Geometry (K > 0): Riemannian positive curvature dome where parallels converge (triangle angles > 180°)
 */
export const NonEuclideanSpell = {
  id: 'non-euclidean',
  name: 'Non-Euclidean Space (Curvature K)',
  isolateStage: true,
  hasLiveReadout: true,
  initialReadout: String.raw`HYPERBOLIC \(K=-0.80\) • Triangle \(\sum\theta<180^\circ\) • Parallels diverge`,
  description:
    String.raw`Warps the fabric of space between Hyperbolic saddle geometry \((K<0)\), flat Euclidean space \((K=0)\), and Riemannian spherical curvature \((K>0)\).`,
  controls: [
    {
      id: 'curvature',
      label: String.raw`Gaussian Curvature \((K)\)`,
      min: -1.0,
      max: 1.0,
      step: 0.02,
      default: -0.8,
      format: (v) => String.raw`\(${v > 0 ? '+' : ''}${v.toFixed(2)}\,K\)`
    },
    {
      id: 'waveSpeed',
      label: 'Geodesic metric pulse',
      min: 0,
      max: 2.5,
      step: 0.05,
      default: 1.0,
      format: (v) => String.raw`\(${v.toFixed(2)}\times\)`
    }
  ],

  group: null,
  manifoldMesh: null,
  wireMesh: null,
  geodesicTriangle: null,
  basePositions: null,
  _introT: 1,

  onActivate(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this._introT = shouldAnimateIntro() ? 0 : 1;
    this.group.scale.setScalar(this._introT < 1 ? 0.82 : 1);
    this.group.rotation.y = this._introT < 1 ? -0.12 : 0;
    this.group.position.y = this._introT < 1 ? -0.12 : 0;

    // Polar disc mesh with high radial & angular resolution for smooth curvature deformation
    const radialSegs = 36;
    const angularSegs = 72;
    const geo = new THREE.RingGeometry(0.02, 1.55, angularSegs, radialSegs);
    geo.rotateX(-Math.PI / 2);

    this.basePositions = Float32Array.from(geo.attributes.position.array);

    const mat = new THREE.MeshBasicMaterial({
      color: '#0ea5e9',
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.manifoldMesh = new THREE.Mesh(geo, mat);

    const wireMat = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      wireframe: true,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.wireMesh = new THREE.Mesh(geo, wireMat);

    // Highlighted Non-Euclidean Geodesic Triangle on the surface
    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(96 * 3), 3));
    const triMat = new THREE.LineBasicMaterial({
      color: '#fbbf24',
      transparent: true,
      opacity: 0.98
    });
    this.geodesicTriangle = new THREE.LineLoop(triGeo, triMat);

    // Poincaré boundary horizon ring
    const horizonGeo = new THREE.RingGeometry(1.53, 1.56, 96);
    horizonGeo.rotateX(-Math.PI / 2);
    const horizonMat = new THREE.MeshBasicMaterial({
      color: '#c084fc',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    this.horizonRing = new THREE.Mesh(horizonGeo, horizonMat);

    this.group.add(this.manifoldMesh, this.wireMesh, this.geodesicTriangle, this.horizonRing);
    this.group.rotation.x = 0.42;
    this.engine.spellLayer.add(this.group);

    this._deformManifold(0);
  },

  onParamChange(id, val) {
    if (id === 'curvature' && this._readoutEl) {
      if (val < -0.05) {
        this._readoutEl.textContent = String.raw`HYPERBOLIC \(K=${val.toFixed(2)}\) • Triangle \(\sum\theta<180^\circ\) • Parallels diverge`;
      } else if (val > 0.05) {
        this._readoutEl.textContent = String.raw`SPHERICAL \(K=+${val.toFixed(2)}\) • Triangle \(\sum\theta>180^\circ\) • Parallels converge`;
      } else {
        this._readoutEl.textContent = String.raw`EUCLIDEAN \(K=0.00\) • Triangle \(\sum\theta=180^\circ\) • Flat space`;
      }
      renderMathInElementSafe(this._readoutEl);
    }
  },

  _evalSurface(x, z, K, elapsed, speed) {
    const r = Math.hypot(x, z);
    const theta = Math.atan2(z, x);
    const wave = Math.sin(r * 6.0 - elapsed * 2.2 * speed) * 0.03 * Math.abs(K);

    if (K < 0) {
      // Hyperbolic Saddle + Poincaré exponential flare (Lobachevskian geometry)
      const saddle = (-K) * 0.55 * (x * x - z * z);
      const flare = (-K) * 0.16 * Math.pow(r, 3) * Math.cos(3.0 * theta + elapsed * 0.5 * speed);
      return saddle + flare + wave;
    } else {
      // Spherical / Riemannian positive curvature dome
      const dome = K * (0.75 - 0.48 * r * r) - K * 0.35;
      return dome + wave;
    }
  },

  _deformManifold(elapsed) {
    if (!this.manifoldMesh) return;
    const K = this.params.curvature ?? -0.8;
    const speed = this.params.waveSpeed ?? 1.0;

    // Color shift: Cyan-Violet for Hyperbolic, Emerald-Gold for Spherical
    if (K < -0.05) {
      this.wireMesh.material.color.set('#38bdf8');
      this.manifoldMesh.material.color.set('#7e22ce');
    } else if (K > 0.05) {
      this.wireMesh.material.color.set('#34d399');
      this.manifoldMesh.material.color.set('#0284c7');
    } else {
      this.wireMesh.material.color.set('#94a3b8');
      this.manifoldMesh.material.color.set('#334155');
    }

    const pos = this.manifoldMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.basePositions[i * 3];
      const bz = this.basePositions[i * 3 + 2];
      pos.array[i * 3 + 1] = this._evalSurface(bx, bz, K, elapsed, speed);
    }
    pos.needsUpdate = true;

    // Deform horizon ring height
    this.horizonRing.position.y = K > 0 ? -0.4 * K : 0;

    // Update curved geodesic triangle vertices on the manifold
    const triCorners = [
      new THREE.Vector2(0.0, -0.95),
      new THREE.Vector2(0.92, 0.58),
      new THREE.Vector2(-0.92, 0.58)
    ];
    const triAttr = this.geodesicTriangle.geometry.attributes.position;
    let ptr = 0;
    const segsPerSide = 32;

    for (let side = 0; side < 3; side++) {
      const A = triCorners[side];
      const B = triCorners[(side + 1) % 3];
      for (let s = 0; s < segsPerSide; s++) {
        const t = s / segsPerSide;
        // Pull midpoints inward for Hyperbolic geodesics (K < 0) or outward for Spherical geodesics (K > 0)
        const pinch = Math.sin(t * Math.PI) * (-K * 0.28);
        const lx = THREE.MathUtils.lerp(A.x, B.x, t) * (1 - pinch);
        const lz = THREE.MathUtils.lerp(A.y, B.y, t) * (1 - pinch);
        const ly = this._evalSurface(lx, lz, K, elapsed, speed) + 0.025;

        triAttr.array[ptr++] = lx;
        triAttr.array[ptr++] = ly;
        triAttr.array[ptr++] = lz;
      }
    }
    triAttr.needsUpdate = true;
  },

  onUpdate(elapsed, delta) {
    this._deformManifold(elapsed);
    if (this._introT < 1 && this.group) {
      if (!shouldAnimateIntro()) this._introT = 1;
      else this._introT = Math.min(1, this._introT + delta / 1.05);
      const eased = this._introT * this._introT * (3 - 2 * this._introT);
      this.group.scale.setScalar(0.82 + eased * 0.18);
      this.group.rotation.y = (1 - eased) * -0.12;
      this.group.position.y = (1 - eased) * -0.12;
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
      this.manifoldMesh = null;
      this.wireMesh = null;
      this.geodesicTriangle = null;
      this._introT = 1;
    }
  }
};
