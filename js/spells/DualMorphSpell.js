import * as THREE from 'three';
import { PLATONIC_DATA, getSolidGeometryData } from '../solids/PlatonicMath.js?v=5';

/**
 * DualMorphSpell.js — Mathgic 1: Dual Polyhedron Morphing (Inscribed)
 * Connects the face centers of the active Platonic solid to manifest its dual twin
 * cleanly visible inside the sheer crystal frame.
 */
export const DualMorphSpell = {
  id: 'dual-morph',
  icon: '🔮',
  name: 'Dual Polyhedron Morphing',
  isolateStage: false,
  description:
    'The face centers of every Platonic solid form the vertices of its dual solid. Drag to summon the geometric twin nested inside.',
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
      const pts = face.map((idx) => {
        const v = dualData.vertices[idx].clone();
        return currentId === 'tetrahedron' ? v.negate() : v;
      });
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
      color: '#38bdf8',
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.dualMesh = new THREE.Mesh(geo, mat);

    const edgesGeo = new THREE.EdgesGeometry(geo);
    const wireMat = new THREE.LineBasicMaterial({
      color: '#7dd3fc',
      transparent: true,
      opacity: 0.95
    });
    this.dualWire = new THREE.LineSegments(edgesGeo, wireMat);

    this.group.add(this.dualMesh);
    this.group.add(this.dualWire);
    this._updateScale();
  },

  _updateScale() {
    if (!this.group) return;
    const m = this.params.morph ?? 0.68;
    this.group.scale.setScalar(m);
  },

  onUpdate(elapsed) {
    if (!this.group || !this.engine.activeSolid) return;
    this.group.position.y = this.engine.activeSolid.rootGroup.position.y;
    if (this.dualWire) {
      this.dualWire.material.opacity = 0.72 + 0.28 * Math.sin(elapsed * 3.0);
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
