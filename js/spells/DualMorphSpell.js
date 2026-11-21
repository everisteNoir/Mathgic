import * as THREE from 'three';
import { PLATONIC_DATA, getSolidGeometryData } from '../solids/PlatonicMath.js';

/**
 * DualMorphSpell.js — Spell 1: Polyhedral Duality & Stellation
 * Connects the face centers of the active Platonic solid to manifest its dual twin:
 * Cube ↔ Octahedron | Dodecahedron ↔ Icosahedron | Tetrahedron ↔ Inverted Tetrahedron (Stella Octangula).
 */
export const DualMorphSpell = {
  id: 'dual-morph',
  icon: '🔮',
  name: 'Dual Polyhedron Morphing',
  description:
    'The face centers of every Platonic solid form the vertices of its dual solid. Drag the slider to summon the geometric twin hidden within.',
  controls: [
    {
      id: 'morph',
      label: 'Dual summoning ratio',
      min: 0,
      max: 1.35,
      step: 0.01,
      default: 0.75,
      format: (v) => `${Math.round(v * 100)}%`
    }
  ],

  group: null,
  dualMesh: null,
  dualWire: null,

  onActivate(engine) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.engine.spellLayer.add(this.group);
    this._rebuildDual();
  },

  onSolidChanged() {
    if (this.active) this._rebuildDual();
  },

  onParamChange() {
    this._updateScale();
  },

  _rebuildDual() {
    if (!this.group || !this.engine.activeSolid) return;
    while (this.group.children.length > 0) {
      const c = this.group.children[0];
      c.geometry?.dispose();
      c.material?.dispose();
      this.group.remove(c);
    }

    const currentId = this.engine.activeSolid.solidId;
    const dualId = PLATONIC_DATA[currentId].dualId;
    const dualData = getSolidGeometryData(dualId);

    const positions = [];
    dualData.faces.forEach((face) => {
      const pts = face.map((idx) => dualData.vertices[idx]);
      // Invert coordinates for self-dual Tetrahedron to form a Stella Octangula
      if (currentId === 'tetrahedron') {
        pts.forEach((p) => p.negate());
      }
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
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color: '#f59e0b',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.dualMesh = new THREE.Mesh(geo, mat);

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({
      color: '#fde68a',
      transparent: true,
      opacity: 0.9
    });
    this.dualWire = new THREE.LineSegments(edgesGeo, wireMat);

    this.group.add(this.dualMesh);
    this.group.add(this.dualWire);
    this._updateScale();
  },

  _updateScale() {
    if (!this.group) return;
    const m = this.params.morph ?? 0.75;
    const s = 0.15 + m * 0.85;
    this.group.scale.setScalar(s);
  },

  onUpdate(elapsed) {
    if (!this.group || !this.engine.activeSolid) return;
    this.group.position.y = this.engine.activeSolid.rootGroup.position.y;
    if (this.dualWire) {
      this.dualWire.material.opacity = 0.65 + 0.3 * Math.sin(elapsed * 3.0);
    }
  },

  onDeactivate() {
    if (this.group) {
      while (this.group.children.length > 0) {
        const c = this.group.children[0];
        c.geometry?.dispose();
        c.material?.dispose();
        this.group.remove(c);
      }
      this.engine.spellLayer.remove(this.group);
      this.group = null;
    }
  }
};
