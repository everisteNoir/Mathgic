import * as THREE from 'three';
import { PLATONIC_DATA, getSolidGeometryData } from './PlatonicMath.js';
import { createElementMaterial } from '../shaders/ElementShaders.js';

/**
 * SolidMeshBuilder.js — Builds 3D Solids with Folding Hinges, Interactive Vertices, Edges & Particles
 */
export class SolidMeshBuilder {
  constructor(globalUniforms) {
    this.globalUniforms = globalUniforms;
  }

  build(solidId) {
    const meta = PLATONIC_DATA[solidId];
    const geoData = getSolidGeometryData(solidId);
    const { vertices, faces, faceNormals, hingeTree } = geoData;

    const rootGroup = new THREE.Group();
    rootGroup.name = `Platonic_${solidId}`;

    const material = createElementMaterial(solidId, this.globalUniforms);

    // Create hierarchical pivot groups along hingeTree for smooth 2D net unfolding
    const nodeGroups = hingeTree.map((node) => {
      const g = new THREE.Group();
      if (node.parentIndex !== -1) {
        const parentPivot = hingeTree[node.parentIndex].parentIndex === -1
          ? new THREE.Vector3(0, 0, 0)
          : hingeTree[node.parentIndex].pivot;
        g.position.copy(node.pivot).sub(parentPivot);
      }
      return g;
    });

    // Attach parent-child hierarchy in Three.js
    hingeTree.forEach((node, idx) => {
      if (node.parentIndex === -1) {
        rootGroup.add(nodeGroups[idx]);
      } else {
        nodeGroups[node.parentIndex].add(nodeGroups[idx]);
      }
    });

    const faceMeshes = [];
    const edgeLines = [];
    const vertexSpheres = [];

    // Build polygonal faces, glowing edges, and vertex orbs attached to each face's pivot group
    faces.forEach((face, fi) => {
      const node = hingeTree[fi];
      const localOrigin = node.parentIndex === -1 ? new THREE.Vector3(0, 0, 0) : node.pivot;
      const localPts = face.map((vIdx) => vertices[vIdx].clone().sub(localOrigin));

      // 1. Polygonal face mesh (triangle fan from vertex 0)
      const triPositions = [];
      const triNormals = [];
      const n = faceNormals[fi];
      for (let k = 1; k < localPts.length - 1; k++) {
        triPositions.push(
          localPts[0].x, localPts[0].y, localPts[0].z,
          localPts[k].x, localPts[k].y, localPts[k].z,
          localPts[k + 1].x, localPts[k + 1].y, localPts[k + 1].z
        );
        triNormals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
      }

      const fGeo = new THREE.BufferGeometry();
      fGeo.setAttribute('position', new THREE.Float32BufferAttribute(triPositions, 3));
      fGeo.setAttribute('normal', new THREE.Float32BufferAttribute(triNormals, 3));

      const fMesh = new THREE.Mesh(fGeo, material);
      fMesh.userData = {
        interactType: 'face',
        faceIndex: fi,
        vertexIndices: face,
        localNormal: n.clone()
      };
      nodeGroups[fi].add(fMesh);
      faceMeshes.push(fMesh);

      // 2. Glowing edge segments
      const m = localPts.length;
      for (let k = 0; k < m; k++) {
        const pA = localPts[k];
        const pB = localPts[(k + 1) % m];
        const vA = face[k];
        const vB = face[(k + 1) % m];

        const lineGeo = new THREE.BufferGeometry().setFromPoints([pA, pB]);
        const lineMat = new THREE.LineBasicMaterial({
          color: meta.secondaryColor,
          transparent: true,
          opacity: 0.55
        });
        const line = new THREE.Line(lineGeo, lineMat);
        line.userData = {
          interactType: 'edge',
          edgeVertices: [vA, vB],
          baseOpacity: 0.55
        };
        nodeGroups[fi].add(line);
        edgeLines.push(line);
      }

      // 3. Vertex spheres at corners
      localPts.forEach((lp, k) => {
        const vIdx = face[k];
        const orbGeo = new THREE.SphereGeometry(0.032, 12, 12);
        const orbMat = new THREE.MeshBasicMaterial({
          color: meta.secondaryColor,
          transparent: true,
          opacity: 0.75
        });
        const orb = new THREE.Mesh(orbGeo, orbMat);
        orb.position.copy(lp);
        orb.userData = {
          interactType: 'vertex',
          vertexIndex: vIdx,
          coords: vertices[vIdx].clone()
        };
        nodeGroups[fi].add(orb);
        vertexSpheres.push(orb);
      });
    });

    // 4. Special detail for Aether (Dodecahedron): Nested celestial wireframe core
    let innerCore = null;
    if (solidId === 'dodecahedron') {
      const coreGeo = new THREE.IcosahedronGeometry(0.42, 0);
      const coreMat = new THREE.MeshBasicMaterial({
        color: '#f5d0fe',
        wireframe: true,
        transparent: true,
        opacity: 0.35
      });
      innerCore = new THREE.Mesh(coreGeo, coreMat);
      rootGroup.add(innerCore);
    }

    // 5. Ambient elemental particle aura
    const particleCount = 90;
    const pPositions = new Float32Array(particleCount * 3);
    const pSeeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const r = 1.15 + Math.random() * 0.95;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPositions[i * 3 + 2] = r * Math.cos(phi);
      pSeeds[i] = Math.random() * Math.PI * 2;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const pMat = new THREE.PointsMaterial({
      color: meta.secondaryColor,
      size: 0.035,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const particles = new THREE.Points(pGeo, pMat);
    rootGroup.add(particles);

    // Update 2D net unfolding angle (unfoldFactor from 0.0 -> 1.0)
    const setUnfold = (unfoldFactor) => {
      hingeTree.forEach((node, idx) => {
        if (node.parentIndex === -1) return;
        const q = new THREE.Quaternion().setFromAxisAngle(node.axis, node.unfoldAngle * unfoldFactor);
        nodeGroups[idx].quaternion.copy(q);
      });
    };

    return {
      solidId,
      meta,
      geoData,
      rootGroup,
      material,
      faceMeshes,
      edgeLines,
      vertexSpheres,
      particles,
      particleSeeds: pSeeds,
      innerCore,
      setUnfold,
      dispose() {
        material.dispose();
        faceMeshes.forEach((m) => m.geometry.dispose());
        edgeLines.forEach((l) => {
          l.geometry.dispose();
          l.material.dispose();
        });
        vertexSpheres.forEach((s) => {
          s.geometry.dispose();
          s.material.dispose();
        });
        pGeo.dispose();
        pMat.dispose();
        if (innerCore) {
          innerCore.geometry.dispose();
          innerCore.material.dispose();
        }
      }
    };
  }
}
