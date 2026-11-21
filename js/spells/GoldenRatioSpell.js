import * as THREE from 'three';
import { PHI } from '../solids/PlatonicMath.js';

/**
 * GoldenRatioSpell.js — Mathgic 2: Golden Ratio X-Ray (φ = 1.6180339...)
 * Renders 3 orthogonal Golden Rectangles and a 3D Fibonacci logarithmic spiral
 * with thick glowing edges, cleanly visible inside the near-transparent Platonic solid.
 */
export const GoldenRatioSpell = {
  id: 'golden-ratio',
  icon: '📐',
  name: 'Golden Ratio X-Ray (φ = 1.618)',
  isolateStage: false,
  description:
    'Reveals three orthogonal Golden Rectangles (whose 12 corners align with the Icosahedron vertices) and a 3D Fibonacci spiral.',
  controls: [
    {
      id: 'scale',
      label: 'Golden field scale',
      min: 0.45,
      max: 1.35,
      step: 0.02,
      default: 0.96,
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

    const upVec = new THREE.Vector3(0, 1, 0);

    planes.forEach(({ color, pts }) => {
      // Build 3D tubular struts for each rectangle edge so they glow unmistakably
      for (let i = 0; i < 4; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % 4];
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const len = dir.length();
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);

        const strutGeo = new THREE.CylinderGeometry(0.01, 0.01, len, 6, 1, true);
        const strutMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const strut = new THREE.Mesh(strutGeo, strutMat);
        strut.position.copy(mid);
        strut.quaternion.setFromUnitVectors(upVec, dir.clone().normalize());
        this.group.add(strut);
      }

      // Corner vertex spheres
      pts.forEach((pt) => {
        const dotGeo = new THREE.SphereGeometry(0.025, 10, 10);
        const dotMat = new THREE.MeshBasicMaterial({ color });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(pt);
        this.group.add(dot);
      });

      // Ultra-sheer tinted plane
      const triGeo = new THREE.BufferGeometry().setFromPoints([
        pts[0], pts[1], pts[2],
        pts[0], pts[2], pts[3]
      ]);
      const meshMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      this.group.add(new THREE.Mesh(triGeo, meshMat));
    });

    // 3D Logarithmic Fibonacci Spiral
    const spiralPts = [];
    const steps = 160;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 4;
      const r = Math.min(0.08 * Math.pow(PHI, t / (Math.PI * 0.5)) * 0.35, 1.35);
      spiralPts.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, (i / steps - 0.5) * 0.45));
    }
    const spiralCurve = new THREE.CatmullRomCurve3(spiralPts);
    const spiralGeo = new THREE.TubeGeometry(spiralCurve, 120, 0.008, 6, false);
    const spiralMat = new THREE.MeshBasicMaterial({
      color: '#fef08a',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.spiralLine = new THREE.Mesh(spiralGeo, spiralMat);
    this.group.add(this.spiralLine);

    this.engine.spellLayer.add(this.group);
  },

  onUpdate(elapsed) {
    if (!this.group || !this.engine.activeSolid) return;
    this.group.position.y = this.engine.activeSolid.rootGroup.position.y;
    this.group.scale.setScalar(this.params.scale ?? 0.96);
    if (this.spiralLine) {
      this.spiralLine.rotation.z = elapsed * 0.65;
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
