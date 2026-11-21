import * as THREE from 'three';
import { PHI } from '../solids/PlatonicMath.js';

/**
 * GoldenRatioSpell.js — Spell 2: Golden Ratio X-Ray (φ = 1.6180339...)
 * Reveals 3 orthogonal Golden Rectangles intersecting inside the polyhedron
 * (whose 12 corners match the exact 12 vertices of the Icosahedron)
 * accompanied by a glowing 3D Fibonacci logarithmic spiral.
 */
export const GoldenRatioSpell = {
  id: 'golden-ratio',
  icon: '📐',
  name: 'Golden Ratio X-Ray (φ = 1.618)',
  description:
    'Manifests three orthogonal Golden Rectangles (whose 12 corners align with the Icosahedron vertices) and a sacred 3D Fibonacci spiral.',
  controls: [
    {
      id: 'scale',
      label: 'Golden field expansion',
      min: 0.4,
      max: 1.4,
      step: 0.02,
      default: 1.0,
      format: (v) => `${v.toFixed(2)} φ`
    }
  ],

  group: null,

  onActivate(engine) {
    this.engine = engine;
    this.group = new THREE.Group();

    const norm = 1 / Math.sqrt(1 + PHI * PHI);
    const a = 1 * norm;
    const b = PHI * norm;

    // 3 orthogonal Golden Rectangle planes
    const planes = [
      {
        color: '#fbbf24',
        pts: [
          new THREE.Vector3(-a, b, 0),
          new THREE.Vector3(a, b, 0),
          new THREE.Vector3(a, -b, 0),
          new THREE.Vector3(-a, -b, 0)
        ]
      },
      {
        color: '#38bdf8',
        pts: [
          new THREE.Vector3(0, -a, b),
          new THREE.Vector3(0, a, b),
          new THREE.Vector3(0, a, -b),
          new THREE.Vector3(0, -a, -b)
        ]
      },
      {
        color: '#f472b6',
        pts: [
          new THREE.Vector3(b, 0, -a),
          new THREE.Vector3(b, 0, a),
          new THREE.Vector3(-b, 0, a),
          new THREE.Vector3(-b, 0, -a)
        ]
      }
    ];

    planes.forEach(({ color, pts }) => {
      const loopGeo = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]);
      const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.92 });
      this.group.add(new THREE.Line(loopGeo, lineMat));

      // Translucent glass plane
      const triGeo = new THREE.BufferGeometry().setFromPoints([
        pts[0], pts[1], pts[2],
        pts[0], pts[2], pts[3]
      ]);
      const meshMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.11,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.group.add(new THREE.Mesh(triGeo, meshMat));
    });

    // Logarithmic Golden Spiral orbiting the center
    const spiralPts = [];
    const steps = 160;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 4;
      const r = 0.08 * Math.pow(PHI, t / (Math.PI * 0.5)) * 0.35;
      const clampedR = Math.min(r, 1.45);
      spiralPts.push(new THREE.Vector3(Math.cos(t) * clampedR, Math.sin(t) * clampedR, (i / steps - 0.5) * 0.4));
    }
    const spiralGeo = new THREE.BufferGeometry().setFromPoints(spiralPts);
    const spiralMat = new THREE.LineBasicMaterial({ color: '#fef08a', transparent: true, opacity: 0.85 });
    this.spiralLine = new THREE.Line(spiralGeo, spiralMat);
    this.group.add(this.spiralLine);

    this.engine.spellLayer.add(this.group);
  },

  onUpdate(elapsed) {
    if (!this.group || !this.engine.activeSolid) return;
    this.group.position.y = this.engine.activeSolid.rootGroup.position.y;
    this.group.scale.setScalar(this.params.scale ?? 1.0);
    if (this.spiralLine) {
      this.spiralLine.rotation.z = elapsed * 0.6;
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
    }
  }
};
