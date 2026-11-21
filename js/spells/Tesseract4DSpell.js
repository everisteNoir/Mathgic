import * as THREE from 'three';

/**
 * Tesseract4DSpell.js — Mathgic 3: 4D Hypercube Portal (Tesseract)
 * Automatically isolates the stage (isolateStage: true) so the 4D hypercube
 * never overlaps or collides with the 3D Platonic solid.
 */
export const Tesseract4DSpell = {
  id: 'tesseract-4d',
  icon: '🌌',
  name: '4D Hypercube Portal (Tesseract)',
  isolateStage: true,
  description:
    'Projects a 4-dimensional Tesseract (16 vertices, 32 edges) into 3D space. Watch the inner cube continuously turn itself inside out!',
  controls: [
    {
      id: 'speed4d',
      label: '4th-dimension (W) rotation speed',
      min: 0,
      max: 2.5,
      step: 0.05,
      default: 0.85,
      format: (v) => `${v.toFixed(2)} rad/s`
    },
    {
      id: 'distance4d',
      label: '4D projection distance',
      min: 1.75,
      max: 3.5,
      step: 0.05,
      default: 2.35,
      format: (v) => `${v.toFixed(2)} W`
    }
  ],

  vertices4D: [],
  edges4D: [],
  lineSegments: null,
  vertexPoints: null,
  angleW: 0,

  onActivate(engine) {
    this.engine = engine;
    this.angleW = 0;

    this.vertices4D = [];
    for (let i = 0; i < 16; i++) {
      this.vertices4D.push([
        i & 1 ? 1 : -1,
        i & 2 ? 1 : -1,
        i & 4 ? 1 : -1,
        i & 8 ? 1 : -1
      ]);
    }

    this.edges4D = [];
    for (let i = 0; i < 16; i++) {
      for (let j = i + 1; j < 16; j++) {
        let diff = 0;
        for (let k = 0; k < 4; k++) {
          if (this.vertices4D[i][k] !== this.vertices4D[j][k]) diff++;
        }
        if (diff === 1) this.edges4D.push([i, j]);
      }
    }

    const linePositions = new Float32Array(this.edges4D.length * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

    const lineMat = new THREE.LineBasicMaterial({
      color: '#c084fc',
      transparent: true,
      opacity: 0.95
    });
    this.lineSegments = new THREE.LineSegments(lineGeo, lineMat);

    const ptPositions = new Float32Array(16 * 3);
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPositions, 3));
    const ptMat = new THREE.PointsMaterial({
      color: '#38bdf8',
      size: 0.095,
      transparent: true,
      opacity: 0.98
    });
    this.vertexPoints = new THREE.Points(ptGeo, ptMat);

    this.engine.spellLayer.add(this.lineSegments);
    this.engine.spellLayer.add(this.vertexPoints);
  },

  onUpdate(elapsed, delta) {
    if (!this.lineSegments) return;

    this.angleW += delta * (this.params.speed4d ?? 0.85);
    const d4 = this.params.distance4d ?? 2.35;
    const cosA = Math.cos(this.angleW);
    const sinA = Math.sin(this.angleW);
    const cosB = Math.cos(this.angleW * 0.6);
    const sinB = Math.sin(this.angleW * 0.6);

    const projected3D = this.vertices4D.map(([x, y, z, w]) => {
      const x1 = x * cosA - w * sinA;
      const w1 = x * sinA + w * cosA;

      const z2 = z * cosB - w1 * sinB;
      const w2 = z * sinB + w1 * cosB;

      const factor = 1.45 / (d4 - w2);
      return [x1 * factor, y * factor, z2 * factor];
    });

    const lineAttr = this.lineSegments.geometry.attributes.position;
    this.edges4D.forEach(([i, j], idx) => {
      const p1 = projected3D[i];
      const p2 = projected3D[j];
      const offset = idx * 6;
      lineAttr.array[offset] = p1[0];
      lineAttr.array[offset + 1] = p1[1];
      lineAttr.array[offset + 2] = p1[2];
      lineAttr.array[offset + 3] = p2[0];
      lineAttr.array[offset + 4] = p2[1];
      lineAttr.array[offset + 5] = p2[2];
    });
    lineAttr.needsUpdate = true;

    const ptAttr = this.vertexPoints.geometry.attributes.position;
    projected3D.forEach((p, idx) => {
      ptAttr.array[idx * 3] = p[0];
      ptAttr.array[idx * 3 + 1] = p[1];
      ptAttr.array[idx * 3 + 2] = p[2];
    });
    ptAttr.needsUpdate = true;
  },

  onDeactivate() {
    if (this.lineSegments) {
      this.lineSegments.geometry.dispose();
      this.lineSegments.material.dispose();
      this.engine.spellLayer.remove(this.lineSegments);
      this.lineSegments = null;
    }
    if (this.vertexPoints) {
      this.vertexPoints.geometry.dispose();
      this.vertexPoints.material.dispose();
      this.engine.spellLayer.remove(this.vertexPoints);
      this.vertexPoints = null;
    }
  }
};
