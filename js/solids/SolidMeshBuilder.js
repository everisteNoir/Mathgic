import * as THREE from 'three';
import { PLATONIC_DATA, getSolidGeometryData } from './PlatonicMath.js?v=23';
import {
  createSheerFaceMaterial,
  createGlowingEdgeMaterial,
  createInnerFlameMaterial
} from '../shaders/ElementShaders.js?v=25';

const DETONATION_PROFILE = {
  fire:   { spread: 1.34, twist: 1.08, lift: 0.48, swirl: 0.34, pulse: 0.9 },
  earth:  { spread: 1.12, twist: 0.62, lift: 0, swirl: 0.12, pulse: 0.68 },
  air:    { spread: 1.48, twist: 1.42, lift: 0.16, swirl: 0.92, pulse: 0.82 },
  water:  { spread: 1.18, twist: 0.52, lift: 0.08, swirl: 0.46, pulse: 0.72 },
  aether: { spread: 1.52, twist: 1.24, lift: 0.02, swirl: 0.68, pulse: 1.0 }
};
const FORMATION_PROFILE = {
  tetrahedron: { vertices: 0.29, edgesStart: 0.23, edges: 0.34, facesStart: 0.58, faceTwist: 0.11 },
  cube:        { vertices: 0.31, edgesStart: 0.25, edges: 0.36, facesStart: 0.62, faceTwist: 0.06 },
  octahedron:  { vertices: 0.27, edgesStart: 0.21, edges: 0.36, facesStart: 0.59, faceTwist: 0.16 },
  icosahedron: { vertices: 0.34, edgesStart: 0.27, edges: 0.37, facesStart: 0.65, faceTwist: 0.09 },
  dodecahedron:{ vertices: 0.32, edgesStart: 0.24, edges: 0.38, facesStart: 0.63, faceTwist: 0.13 }
};

/** Flat waves share one instanced draw call, even when a core has several rings. */
function makeFlatRings(parent, disposables, count, color, y) {
  const geometry = new THREE.RingGeometry(0.97, 1.0, 56);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.88,
    vertexColors: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'InstancedElementalWaves';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color(color);
  const colorScratch = new THREE.Color();
  for (let i = 0; i < count; i++) {
    dummy.position.set(0, y, 0);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, colorScratch.setRGB(0, 0, 0));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
  disposables.push(geometry, material);
  return { mesh, material, count, tint, y, dummy, colorScratch };
}

/** Drives all rings through one InstancedMesh; brightness is per-instance. */
function driveRings(controller, k, start, gap, maxR, peak) {
  const { mesh, count, tint, y, dummy, colorScratch } = controller;
  for (let i = 0; i < count; i++) {
    const t0 = start + i * gap;
    const p = THREE.MathUtils.clamp((k - t0) / Math.max(0.001, 0.98 - t0), 0, 1);
    const intensity = k > t0 ? Math.sin(p * Math.PI) * peak : 0;
    dummy.position.set(0, y, 0);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.setScalar(0.12 + p * maxR);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    colorScratch.copy(tint).multiplyScalar(intensity);
    mesh.setColorAt(i, colorScratch);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.visible = k > start;
}

/**
 * SolidMeshBuilder.js — Builds 3D Platonic Solids with:
 * - Luminous gradient-colored 3D edge struts (e.g. Red-Orange-Gold for Fire)
 * - Nearly invisible crystal faces (so inner cores & inscribed Mathgic spells shine clearly)
 * - Dedicated 3D Elemental Core phenomena inside each solid (Flickering Flame, Emerald Geo-Crystal, Wind Vortex, Liquid Orb, Cosmic Nebula)
 */
export class SolidMeshBuilder {
  constructor(globalUniforms) {
    this.globalUniforms = globalUniforms;
  }

  build(solidId) {
    const meta = PLATONIC_DATA[solidId];
    const geoData = getSolidGeometryData(solidId);
    const { vertices, faces, faceNormals, hingeTree, baseY } = geoData;

    const rootGroup = new THREE.Group();
    rootGroup.name = `Platonic_${solidId}`;

    const faceMaterial = createSheerFaceMaterial(this.globalUniforms);

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

    hingeTree.forEach((node, idx) => {
      if (node.parentIndex === -1) {
        rootGroup.add(nodeGroups[idx]);
      } else {
        nodeGroups[node.parentIndex].add(nodeGroups[idx]);
      }
    });

    // Chapter 1 performance: all edge struts and vertex markers are batched once
    // per solid. Each instance retains its hinge-face index; its matrix is rebuilt
    // from that face's relative transform whenever the net unfolds or detonates.
    // This reduces edge/vertex draw calls from 2 × faceCount to exactly two.
    const faceMeshes = [];
    const faceVisualGroups = [];
    const edgeRecords = [];
    const vertexRecords = [];
    const edgeMaterial = createGlowingEdgeMaterial(this.globalUniforms);
    const edgeUnitGeometry = new THREE.CylinderGeometry(0.013, 0.013, 1, 6, 1, true);
    const vertexUnitGeometry = new THREE.SphereGeometry(1, 8, 8);
    const vertexMaterial = new THREE.MeshBasicMaterial({
      color: meta.tertiaryColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const upVec = new THREE.Vector3(0, 1, 0);
    const instanceDummy = new THREE.Object3D();
    const tempPosition = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const rebuildCenter = new THREE.Vector3();
    const instanceColorBase = new THREE.Color(1, 1, 1);
    const instanceColorHighlight = new THREE.Color(1.7, 1.48, 1.18);
    const faceVisibility = new Float32Array(faces.length).fill(1);
    const faceRelativeMatrices = hingeTree.map(() => new THREE.Matrix4());
    const rootWorldInverse = new THREE.Matrix4();
    const combinedInstanceMatrix = new THREE.Matrix4();
    const writeInstanceMatrix = (batch, instanceId, record, updateColor = false) => {
      instanceDummy.position.copy(record.currentPosition || record.basePosition);
      instanceDummy.quaternion.copy(record.baseQuaternion);
      instanceDummy.scale.copy(record.currentScale || record.baseScale);
      const visualScale = (record.revealScale ?? 1) * faceVisibility[record.faceIndex];
      instanceDummy.scale.multiplyScalar(Math.max(0.0001, visualScale));
      if (record.highlighted && record.interactType === 'vertex') instanceDummy.scale.multiplyScalar(1.82);
      else if (record.highlighted && record.interactType === 'edge') {
        instanceDummy.scale.x *= 1.32;
        instanceDummy.scale.z *= 1.32;
      }
      instanceDummy.updateMatrix();
      combinedInstanceMatrix.multiplyMatrices(faceRelativeMatrices[record.faceIndex], instanceDummy.matrix);
      batch.setMatrixAt(instanceId, combinedInstanceMatrix);
      if (updateColor && batch.setColorAt) {
        batch.setColorAt(instanceId, record.highlighted ? instanceColorHighlight : instanceColorBase);
      }
    };
    const refreshFaceRelativeMatrices = () => {
      rootGroup.updateMatrixWorld(true);
      rootWorldInverse.copy(rootGroup.matrixWorld).invert();
      for (let i = 0; i < nodeGroups.length; i++) {
        faceRelativeMatrices[i].multiplyMatrices(rootWorldInverse, nodeGroups[i].matrixWorld);
      }
    };

    faces.forEach((face, fi) => {
      const node = hingeTree[fi];
      const localOrigin = node.parentIndex === -1 ? new THREE.Vector3(0, 0, 0) : node.pivot;
      const localPts = face.map((vIdx) => vertices[vIdx].clone().sub(localOrigin));

      // One face mesh per hinge group keeps per-face hit testing and hinge motion.
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
      fGeo.computeBoundingBox();
      fGeo.computeBoundingSphere();
      const fMesh = new THREE.Mesh(fGeo, faceMaterial);
      fMesh.userData = {
        interactType: 'face',
        faceIndex: fi,
        vertexIndices: face,
        localNormal: n.clone()
      };
      const faceVisualGroup = new THREE.Group();
      faceVisualGroup.name = `FaceVisual_${fi}`;
      faceVisualGroup.add(fMesh);
      nodeGroups[fi].add(faceVisualGroup);
      faceMeshes.push(fMesh);
      faceVisualGroups.push(faceVisualGroup);

      // Edge and vertex records are collected into solid-wide batches below.
      const m = localPts.length;
      for (let k = 0; k < m; k++) {
        const pA = localPts[k];
        const pB = localPts[(k + 1) % m];
        const vA = face[k];
        const vB = face[(k + 1) % m];
        const dir = new THREE.Vector3().subVectors(pB, pA);
        const len = dir.length();
        const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
        instanceDummy.position.copy(mid);
        instanceDummy.quaternion.setFromUnitVectors(upVec, dir.normalize());
        instanceDummy.scale.set(1, len, 1);
        edgeRecords.push({
          interactType: 'edge',
          edgeVertices: [vA, vB],
          faceIndex: fi,
          localIndex: k,
          basePosition: mid.clone(),
          currentPosition: mid.clone(),
          baseQuaternion: instanceDummy.quaternion.clone(),
          baseScale: instanceDummy.scale.clone(),
          currentScale: instanceDummy.scale.clone(),
          revealScale: 1,
          highlighted: false
        });

        const lp = localPts[k];
        const vIdx = face[k];
        vertexRecords.push({
          interactType: 'vertex',
          vertexIndex: vIdx,
          coords: vertices[vIdx].clone(),
          faceIndex: fi,
          localIndex: k,
          basePosition: lp.clone(),
          currentPosition: lp.clone(),
          baseQuaternion: new THREE.Quaternion(),
          baseScale: new THREE.Vector3(0.028, 0.028, 0.028),
          currentScale: new THREE.Vector3(0.028, 0.028, 0.028),
          revealScale: 1,
          highlighted: false
        });
      }
    });

    const edgeBatch = new THREE.InstancedMesh(edgeUnitGeometry, edgeMaterial, edgeRecords.length);
    edgeBatch.name = `Edges_${solidId}`;
    edgeBatch.frustumCulled = false; // net unfolding moves instances beyond the folded bounding sphere
    edgeBatch.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6.0);
    edgeBatch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    edgeBatch.userData = { interactType: 'edgeBatch', instances: edgeRecords, strutMat: edgeMaterial };
    rootGroup.add(edgeBatch);

    const vertexBatch = new THREE.InstancedMesh(vertexUnitGeometry, vertexMaterial, vertexRecords.length);
    vertexBatch.name = `Vertices_${solidId}`;
    vertexBatch.frustumCulled = false;
    vertexBatch.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6.0);
    vertexBatch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    vertexBatch.userData = { interactType: 'vertexBatch', instances: vertexRecords };
    rootGroup.add(vertexBatch);

    // Stable one-entry arrays preserve the public builder contract used by Engine.
    const edgeMeshes = [edgeBatch];
    const vertexSpheres = [vertexBatch];
    refreshFaceRelativeMatrices();
    edgeRecords.forEach((record, i) => writeInstanceMatrix(edgeBatch, i, record, true));
    vertexRecords.forEach((record, i) => writeInstanceMatrix(vertexBatch, i, record, true));
    edgeBatch.instanceMatrix.needsUpdate = true;
    vertexBatch.instanceMatrix.needsUpdate = true;
    if (edgeBatch.instanceColor) {
      edgeBatch.instanceColor.setUsage(THREE.DynamicDrawUsage);
      edgeBatch.instanceColor.needsUpdate = true;
    }
    if (vertexBatch.instanceColor) {
      vertexBatch.instanceColor.setUsage(THREE.DynamicDrawUsage);
      vertexBatch.instanceColor.needsUpdate = true;
    }

    const smooth01 = (v) => {
      const x = THREE.MathUtils.clamp(v, 0, 1);
      return x * x * (3 - 2 * x);
    };
    const formation = FORMATION_PROFILE[solidId] || FORMATION_PROFILE.tetrahedron;
    const setRecordReveal = (records, progress, kind) => {
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const sequence = kind === 'vertex'
          ? ((record.vertexIndex * 0.173 + record.faceIndex * 0.031) % 0.19)
          : ((record.faceIndex * 0.071 + record.localIndex * 0.113) % 0.23);
        const local = smooth01((progress - sequence) / Math.max(0.001, 1 - sequence));
        record.currentPosition.copy(record.basePosition);
        if (kind === 'vertex') {
          const lift = 1 + (1 - local) * 0.78;
          record.currentPosition.multiplyScalar(lift);
        } else {
          record.currentPosition.lerp(rebuildCenter, 1 - local);
        }
        record.currentScale.copy(record.baseScale).multiplyScalar(Math.max(0.0001, local));
        record.revealScale = 1;
      }
    };

    // A shared, staged topology reveal: vertices gather first, edges connect
    // them in an element-specific cadence, and faces close last with a small
    // hinge-aware settle. The same routine is used on first arrival and rebirth.
    const setReconstruction = (progress) => {
      const p = THREE.MathUtils.clamp(progress, 0, 1);
      const vertexProgress = smooth01(p / formation.vertices);
      const edgeProgress = smooth01((p - formation.edgesStart) / formation.edges);
      const faceProgress = smooth01((p - formation.facesStart) / Math.max(0.001, 1 - formation.facesStart));
      vertexBatch.visible = true;
      edgeBatch.visible = p >= formation.edgesStart;
      setRecordReveal(vertexRecords, vertexProgress, 'vertex');
      setRecordReveal(edgeRecords, edgeProgress, 'edge');
      for (let i = 0; i < nodeGroups.length; i++) {
        const faceGroup = faceVisualGroups[i];
        const faceDelay = ((i * 0.137 + (i % 3) * 0.047) % 0.2) * 0.72;
        const local = smooth01((faceProgress - faceDelay) / Math.max(0.001, 1 - faceDelay));
        // A subtle twist settles each polygon into its exact plane as it closes.
        const sign = i % 2 === 0 ? 1 : -1;
        faceGroup.visible = p >= formation.facesStart;
        faceGroup.scale.setScalar(Math.max(0.0001, local));
        faceGroup.rotation.set(0, 0, sign * (1 - local) * formation.faceTwist);
        faceVisibility[i] = Math.max(0.0001, local);
      }
      faceMaterial.uniforms.uFaceBurst.value = p < 1 ? (1 - faceProgress) * 0.48 + Math.sin(faceProgress * Math.PI) * 0.24 : 0;
      edgeMaterial.uniforms.uDetonation.value = p < 1 ? (1 - edgeProgress) * 0.28 : 0;

      if (p >= 0.999) {
        for (let i = 0; i < vertexRecords.length; i++) {
          vertexRecords[i].currentPosition.copy(vertexRecords[i].basePosition);
          vertexRecords[i].currentScale.copy(vertexRecords[i].baseScale);
        }
        for (let i = 0; i < edgeRecords.length; i++) {
          edgeRecords[i].currentPosition.copy(edgeRecords[i].basePosition);
          edgeRecords[i].currentScale.copy(edgeRecords[i].baseScale);
        }
        edgeBatch.visible = true;
        for (let i = 0; i < faceVisualGroups.length; i++) {
          faceVisualGroups[i].visible = true;
          faceVisualGroups[i].scale.setScalar(1);
          faceVisualGroups[i].rotation.set(0, 0, 0);
          faceVisibility[i] = 1;
        }
        faceMaterial.uniforms.uFaceBurst.value = 0;
        edgeMaterial.uniforms.uDetonation.value = 0;
      }
      refreshFaceRelativeMatrices();
      for (let i = 0; i < edgeRecords.length; i++) writeInstanceMatrix(edgeBatch, i, edgeRecords[i]);
      for (let i = 0; i < vertexRecords.length; i++) writeInstanceMatrix(vertexBatch, i, vertexRecords[i]);
      edgeBatch.instanceMatrix.needsUpdate = true;
      vertexBatch.instanceMatrix.needsUpdate = true;
    };

    const detonationStates = nodeGroups.map((group, faceIndex) => {
      let depth = 0;
      let ancestor = group.parent;
      while (ancestor && ancestor !== rootGroup) { depth++; ancestor = ancestor.parent; }
      return {
        group,
        faceIndex,
        depth,
        faceVisualGroup: faceVisualGroups[faceIndex],
        basePosition: new THREE.Vector3(),
        baseQuaternion: new THREE.Quaternion(),
        direction: new THREE.Vector3(),
        sideDirection: new THREE.Vector3(),
        deltaQuaternion: new THREE.Quaternion(),
        phaseOffset: (faceIndex * 0.61803398875) % 1
      };
    });
    const detonationRootQuaternion = new THREE.Quaternion();
    const detonationParentQuaternion = new THREE.Quaternion();
    const localUp = new THREE.Vector3(0, 1, 0);
    const localRight = new THREE.Vector3(1, 0, 0);
    let detonationPrepared = false;
    const beginDetonation = () => {
      if (detonationPrepared) return;
      rootGroup.updateMatrixWorld(true);
      rootGroup.getWorldQuaternion(detonationRootQuaternion);
      for (let i = 0; i < detonationStates.length; i++) {
        const state = detonationStates[i];
        state.basePosition.copy(state.group.position);
        state.baseQuaternion.copy(state.group.quaternion);
        state.group.parent.getWorldQuaternion(detonationParentQuaternion);
        state.direction.copy(faceNormals[state.faceIndex]).applyQuaternion(detonationRootQuaternion);
        state.direction.applyQuaternion(detonationParentQuaternion.invert()).normalize();
        state.sideDirection.crossVectors(state.direction, localUp);
        if (state.sideDirection.lengthSq() < 0.001) state.sideDirection.crossVectors(state.direction, localRight);
        state.sideDirection.normalize();
      }
      detonationPrepared = true;
    };
    const setDetonation = (progress, style = 'fire') => {
      if (!detonationPrepared) beginDetonation();
      const p = THREE.MathUtils.clamp(progress, 0, 1);
      const profile = DETONATION_PROFILE[style] || DETONATION_PROFILE.fire;
      const rebuildStart = 0.64;
      if (p < rebuildStart) {
        const entrance = smooth01(p / 0.16);
        const launch = smooth01(p / 0.25);
        const drift = smooth01((p - 0.16) / 0.44);
        const fade = 1 - smooth01((p - 0.55) / 0.09);
        const amplitude = profile.spread * drift;
        const spin = launch * (0.18 + drift * profile.twist);
        for (let i = 0; i < detonationStates.length; i++) {
          const state = detonationStates[i];
          const depthFactor = 1 / (1 + state.depth * 0.34);
          const phase = p * (2.6 + profile.swirl * 2.1) + state.phaseOffset * Math.PI * 2;
          const tangent = Math.sin(phase) * amplitude * profile.swirl * 0.22;
          const vertical = Math.cos(phase * 0.72) * amplitude * 0.12 + launch * profile.lift;
          state.group.position.copy(state.basePosition)
            .addScaledVector(state.direction, amplitude * depthFactor)
            .addScaledVector(state.sideDirection, tangent * depthFactor);
          state.group.position.y += vertical * depthFactor;
          const signed = state.faceIndex % 2 === 0 ? 1 : -1;
          state.deltaQuaternion.setFromAxisAngle(
            state.direction,
            spin * signed * depthFactor + Math.sin(phase) * 0.12 * launch
          );
          state.group.quaternion.copy(state.baseQuaternion).multiply(state.deltaQuaternion);
          state.faceVisualGroup.visible = fade > 0.015;
          state.faceVisualGroup.scale.setScalar(Math.max(0.001, 0.94 + fade * 0.06));
          state.faceVisualGroup.rotation.z = Math.sin(phase) * 0.08 * (1 - drift) * launch;
          faceVisibility[state.faceIndex] = Math.max(0.0001, fade);
        }
        faceMaterial.uniforms.uFaceBurst.value = profile.pulse * (0.42 + launch * 0.5) * fade * entrance;
        edgeMaterial.uniforms.uDetonation.value = profile.pulse * fade * entrance;
        edgeBatch.visible = fade > 0.01;
        vertexBatch.visible = fade > 0.01;
        vertexMaterial.opacity = 0.9 * fade;
        refreshFaceRelativeMatrices();
        for (let i = 0; i < edgeRecords.length; i++) writeInstanceMatrix(edgeBatch, i, edgeRecords[i]);
        for (let i = 0; i < vertexRecords.length; i++) writeInstanceMatrix(vertexBatch, i, vertexRecords[i]);
        edgeBatch.instanceMatrix.needsUpdate = true;
        vertexBatch.instanceMatrix.needsUpdate = true;
      } else {
        // Rebirth begins from a clean topological pose and follows the same
        // Vertices -> Edges -> Faces sequence used for first materialization.
        for (let i = 0; i < detonationStates.length; i++) {
          const state = detonationStates[i];
          state.group.position.copy(state.basePosition);
          state.group.quaternion.copy(state.baseQuaternion);
          state.faceVisualGroup.scale.setScalar(1);
          state.faceVisualGroup.rotation.set(0, 0, 0);
          state.faceVisualGroup.visible = false;
          faceVisibility[state.faceIndex] = 1;
        }
        setReconstruction((p - rebuildStart) / (1 - rebuildStart));
        return;
      }
    };
    const endDetonation = () => {
      if (!detonationPrepared) return;
      for (let i = 0; i < detonationStates.length; i++) {
        const state = detonationStates[i];
        state.group.position.copy(state.basePosition);
        state.group.quaternion.copy(state.baseQuaternion);
        state.faceVisualGroup.scale.setScalar(1);
        state.faceVisualGroup.rotation.set(0, 0, 0);
        state.faceVisualGroup.visible = true;
        faceVisibility[state.faceIndex] = 1;
      }
      faceMaterial.uniforms.uFaceBurst.value = 0;
      edgeMaterial.uniforms.uDetonation.value = 0;
      vertexMaterial.opacity = 0.9;
      setReconstruction(1);
      detonationPrepared = false;
      rootGroup.updateMatrixWorld(true);
    };

    const setInstanceHighlight = (batch, instanceId, active) => {
      const record = batch?.userData?.instances?.[instanceId];
      if (!record) return;
      record.highlighted = !!active;
      refreshFaceRelativeMatrices();
      writeInstanceMatrix(batch, instanceId, record, true);
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    };

    // 4. Build Dedicated Interior Elemental Core Phenomenon
    const innerGroup = new THREE.Group();
    innerGroup.name = 'ElementalCore';
    // A dedicated reveal wrapper lets the elemental centre materialize gradually
    // without interfering with each core's own scale/rotation animation.
    const coreRevealGroup = new THREE.Group();
    coreRevealGroup.name = 'ElementalCoreReveal';
    coreRevealGroup.visible = false;

    // An "upright" group is counter-rotated every frame so everything inside keeps a fixed world orientation
    // however the solid is turned. It holds the ambient particles of every solid, plus the cores (flame, vortex,
    // water orb) and the vanishing effects that must fall / rise along true world directions.
    const uprightGroup = new THREE.Group();
    uprightGroup.name = 'Upright';
    rootGroup.add(uprightGroup);
    const fxGroup = new THREE.Group(); // effects played while the net opens; hidden when folded
    fxGroup.visible = false;
    uprightGroup.add(fxGroup);
    if (solidId === 'tetrahedron' || solidId === 'octahedron' || solidId === 'icosahedron') {
      uprightGroup.add(coreRevealGroup);
    } else {
      rootGroup.add(coreRevealGroup);
    }
    coreRevealGroup.add(innerGroup);

    const disposables = [];
    const coreTransitionRingGeometry = new THREE.TorusGeometry(0.38, 0.012, 6, 48);
    const coreTransitionRingMaterial = new THREE.MeshBasicMaterial({
      color: meta.tertiaryColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const coreTransitionRing = new THREE.Mesh(coreTransitionRingGeometry, coreTransitionRingMaterial);
    coreTransitionRing.name = 'CoreTransitionRing';
    coreTransitionRing.rotation.x = Math.PI / 2;
    coreTransitionRing.visible = false;
    coreRevealGroup.add(coreTransitionRing);
    disposables.push(coreTransitionRingGeometry, coreTransitionRingMaterial);
    let coreAnimator = null;

    // Unfolding progress (0..1) and the "dissolve" progress k of the elemental core.
    // Each core animates its own farewell as the net flattens, and is fully gone at 100%.
    let unfold = 0;
    const dissolve = () => THREE.MathUtils.smoothstep(unfold, 0.06, 1.0);
    const sstep = THREE.MathUtils.smoothstep;

    if (solidId === 'tetrahedron') {
      // FIRE CORE: Multi-layered 3D flickering volumetric flame burning inside the Tetrahedron
      const flameMat = createInnerFlameMaterial(this.globalUniforms);
      disposables.push(flameMat);

      const outerFlameGeo = new THREE.SphereGeometry(0.28, 20, 16);
      outerFlameGeo.scale(0.85, 1.45, 0.85);
      const outerFlame = new THREE.Mesh(outerFlameGeo, flameMat);
      outerFlame.position.y = 0.14; // sits on the base face (y = -1/3) and rises toward the apex
      innerGroup.add(outerFlame);
      disposables.push(outerFlameGeo);

      // Inner white-gold plasma heart
      const heartGeo = new THREE.OctahedronGeometry(0.14, 2);
      heartGeo.scale(0.8, 1.5, 0.8);
      const heartMat = new THREE.MeshBasicMaterial({
        color: '#fff3b0',
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const heart = new THREE.Mesh(heartGeo, heartMat);
      heart.position.y = 0.04;
      innerGroup.add(heart);
      disposables.push(heartGeo, heartMat);

      coreAnimator = (elapsed, energy) => {
        const k = dissolve();
        const boost = 1 + energy * 0.3;
        // Ascension: the flame stretches into a thin tongue and lifts away, leaving rising embers
        const slim = Math.max(0.001, 1 - k);
        innerGroup.scale.set(boost * slim, boost * (1 + k * 1.6), boost * slim);
        innerGroup.position.y = k * 1.1;
        heart.rotation.y = elapsed * 3.5;
        heart.scale.y = (1.4 + Math.sin(elapsed * 14.0) * 0.25) * slim;
        heartMat.opacity = 0.85 * slim;
      };
    } else if (solidId === 'cube') {
      // EARTH CORE: Levitating emerald mineral octahedron + rotating runic stone rings
      const crystalGeo = new THREE.OctahedronGeometry(0.32, 0);
      const crystalMat = new THREE.MeshBasicMaterial({
        color: '#10b981',
        wireframe: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending
      });
      const crystal = new THREE.Mesh(crystalGeo, crystalMat);

      const solidHeartGeo = new THREE.OctahedronGeometry(0.20, 0);
      const solidHeartMat = new THREE.MeshBasicMaterial({
        color: '#a7f3d0',
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const solidHeart = new THREE.Mesh(solidHeartGeo, solidHeartMat);

      const ringGeo = new THREE.RingGeometry(0.42, 0.445, 4);
      const ringMat = new THREE.MeshBasicMaterial({
        color: '#34d399',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;

      innerGroup.add(crystal, solidHeart, ring);
      disposables.push(crystalGeo, crystalMat, solidHeartGeo, solidHeartMat, ringGeo, ringMat);

      // Fourteen mineral splinters share one InstancedMesh instead of fourteen
      // separate draw calls. Their directions and colours remain individually
      // controlled, but no mesh/material is allocated during the animation.
      const SHARD_COUNT = 14;
      const shardGeo = new THREE.OctahedronGeometry(0.05, 0);
      const shardMat = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      });
      const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, SHARD_COUNT);
      shardMesh.name = 'EarthCrystalShards';
      shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const shards = [];
      const shardDummy = new THREE.Object3D();
      for (let i = 0; i < SHARD_COUNT; i++) {
        const y = 1 - (i / (SHARD_COUNT - 1)) * 2;
        const rad = Math.sqrt(Math.max(0, 1 - y * y));
        const a = i * 2.39996;
        const dir = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad);
        shardMesh.setColorAt(i, new THREE.Color(i % 2 ? '#6ee7b7' : '#a7f3d0'));
        shardDummy.position.copy(dir).multiplyScalar(0.2);
        shardDummy.scale.setScalar(0.0001);
        shardDummy.updateMatrix();
        shardMesh.setMatrixAt(i, shardDummy.matrix);
        shards.push({ dir });
      }
      shardMesh.instanceMatrix.needsUpdate = true;
      if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true;
      innerGroup.add(shardMesh);
      disposables.push(shardGeo, shardMat);

      coreAnimator = (elapsed, energy) => {
        const k = dissolve();
        const crack = 1 - sstep(k, 0.3, 0.6);
        crystal.rotation.y = elapsed * (0.7 + k * 5.0);
        solidHeart.rotation.y = -elapsed * 1.1 * (1 + k * 4.0);
        crystal.scale.setScalar(Math.max(0.001, crack));
        solidHeart.scale.setScalar(Math.max(0.001, 1 + k * 0.6 - k * k * 1.6));
        crystalMat.opacity = 0.85 * crack;
        solidHeartMat.opacity = 0.35 * (1 - sstep(k, 0.5, 0.9));
        // Seismic shockwave ring
        ring.rotation.z = elapsed * 0.5;
        ring.scale.setScalar(1 + k * 2.6);
        ringMat.opacity = 0.65 * Math.pow(1 - k, 1.5);
        // Shatter: the instanced splinters fan out and fade with the crystal.
        const born = sstep(k, 0.25, 0.45);
        const gone = 1 - sstep(k, 0.65, 1.0);
        for (let i = 0; i < shards.length; i++) {
          const dir = shards[i].dir;
          shardDummy.position.copy(dir).multiplyScalar(0.2 + k * 1.3);
          shardDummy.rotation.set(elapsed * 2 + i, elapsed * 1.6, i * 0.17);
          shardDummy.scale.setScalar(Math.max(0.0001, born * gone));
          shardDummy.updateMatrix();
          shardMesh.setMatrixAt(i, shardDummy.matrix);
        }
        shardMesh.instanceMatrix.needsUpdate = true;
        shardMat.opacity = 0.9 * born * gone;
        innerGroup.scale.setScalar(1 + energy * 0.25);
      };
    } else if (solidId === 'octahedron') {
      // AIR CORE: Swirling 3D helical wind vortex streamlines
      // Three helical ribbons are packed into one LineSegments draw call instead
      // of three high-vertex TubeGeometry meshes. Bloom keeps the thin lines legible.
      const RIBBON_COUNT = 3;
      const RIBBON_STEPS = 48;
      const ribbonPositions = new Float32Array(RIBBON_COUNT * RIBBON_STEPS * 6);
      const ribbonColors = new Float32Array(RIBBON_COUNT * RIBBON_STEPS * 6);
      for (let r = 0; r < RIBBON_COUNT; r++) {
        const pts = [];
        const offsetAngle = (r * Math.PI * 2) / RIBBON_COUNT;
        for (let i = 0; i <= 48; i++) {
          const t = i / 48;
          const angle = t * Math.PI * 4 + offsetAngle;
          const radius = Math.sin(t * Math.PI) * 0.36;
          pts.push(new THREE.Vector3(Math.cos(angle) * radius, (t - 0.5) * 0.95, Math.sin(angle) * radius));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const samples = curve.getPoints(RIBBON_STEPS);
        const tint = r === 0 ? [0.72, 0.94, 1.0] : [0.32, 0.75, 1.0];
        for (let i = 0; i < RIBBON_STEPS; i++) {
          const a = samples[i], b = samples[i + 1];
          const offset = (r * RIBBON_STEPS + i) * 6;
          ribbonPositions.set([a.x, a.y, a.z, b.x, b.y, b.z], offset);
          ribbonColors.set([...tint, ...tint], offset);
        }
      }
      const ribbonGeo = new THREE.BufferGeometry();
      ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPositions, 3));
      ribbonGeo.setAttribute('color', new THREE.BufferAttribute(ribbonColors, 3));
      const ribbonMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      });
      const ribbonMesh = new THREE.LineSegments(ribbonGeo, ribbonMat);
      innerGroup.add(ribbonMesh);
      disposables.push(ribbonGeo, ribbonMat);

      // Gust FX use bounded buffers and fewer streamline samples for chapter-1 performance.
      const NET = 2.4;
      const W = 12;
      const S = 16;
      const linePos = new Float32Array(W * S * 6);
      const lineCol = new Float32Array(W * S * 6);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
      const lineMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const windLines = new THREE.LineSegments(lineGeo, lineMat);
      windLines.frustumCulled = false;
      fxGroup.add(windLines);
      const streaks = Array.from({ length: W }, (_, j) => ({
        off: (j / W) * Math.PI * 2,
        spin: 0.8 + Math.random() * 0.8
      }));

      const DUST = 36;
      const dustPos = new Float32Array(DUST * 3);
      const dustCol = new Float32Array(DUST * 3);
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
      dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
      const dustMat = new THREE.PointsMaterial({
        size: 0.045,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const dust = new THREE.Points(dustGeo, dustMat);
      dust.frustumCulled = false;
      fxGroup.add(dust);
      const dustSeeds = Array.from({ length: DUST }, () => ({
        a: Math.random() * Math.PI * 2,
        r: 0.3 + Math.random() * 0.7,
        sp: 1.2 + Math.random() * 2.2,
        h: Math.random()
      }));
      const windRings = makeFlatRings(fxGroup, disposables, 2, '#e0f2fe', baseY + 0.01);
      disposables.push(lineGeo, lineMat, dustGeo, dustMat);

      coreAnimator = (elapsed, energy) => {
        const k = dissolve();
        // The vortex spins up and lifts while its ribbons fade into the streamlines
        innerGroup.rotation.y = elapsed * (2.2 + energy * 4.0 + k * 9.0);
        innerGroup.scale.set(1 + k * 1.2, Math.max(0.001, 1 - k * 0.5), 1 + k * 1.2);
        const ribbonFade = 1 - sstep(k, 0.15, 0.6);
        ribbonMesh.scale.setScalar(1 + Math.sin(elapsed * 3.0) * 0.045);
        ribbonMat.opacity = 0.8 * ribbonFade;

        const head = sstep(k, 0.1, 0.7); // how far each streamline has been drawn
        const e = sstep(k, 0.2, 0.85); // helix → flat spiral on the net
        const out = 1 - sstep(k, 0.85, 1.0);
        windLines.visible = head > 0.001;
        dust.visible = k > 0.2;
        if (windLines.visible) {
          for (let j = 0; j < W; j++) {
            const st = streaks[j];
            let px = 0;
            let py = 0;
            let pz = 0;
            for (let i = 0; i <= S; i++) {
              const u = i / S;
              const s2 = u * head;
              const ha = s2 * Math.PI * 4 + st.off + elapsed * 2.2;
              const hr = Math.sin(s2 * Math.PI) * 0.36;
              const pa = st.off + s2 * 5.0 * (1 - 0.7 * e) + elapsed * 0.5 * st.spin * e;
              const pr = 0.12 + NET * Math.pow(s2, 0.9);
              const x = THREE.MathUtils.lerp(Math.cos(ha) * hr, Math.cos(pa) * pr, e);
              const y = THREE.MathUtils.lerp((s2 - 0.5) * 0.95, baseY + 0.02 + 0.05 * Math.sin(s2 * 12 + elapsed * 3 + st.off), e);
              const z = THREE.MathUtils.lerp(Math.sin(ha) * hr, Math.sin(pa) * pr, e);
              if (i > 0) {
                const o = (j * S + (i - 1)) * 6;
                linePos[o] = px; linePos[o + 1] = py; linePos[o + 2] = pz;
                linePos[o + 3] = x; linePos[o + 4] = y; linePos[o + 5] = z;
                const f = Math.pow(u, 1.6) * out;
                lineCol[o] = 0.55 * f; lineCol[o + 1] = 0.85 * f; lineCol[o + 2] = f;
                lineCol[o + 3] = 0.55 * f; lineCol[o + 4] = 0.85 * f; lineCol[o + 5] = f;
              }
              px = x; py = y; pz = z;
            }
          }
          lineGeo.attributes.position.needsUpdate = true;
          lineGeo.attributes.color.needsUpdate = true;
        }
        if (dust.visible) {
          const vis = sstep(k, 0.2, 0.4) * out;
          for (let i = 0; i < DUST; i++) {
            const d = dustSeeds[i];
            const ang = d.a + elapsed * d.sp * (0.4 + e);
            const r = (0.15 + e * NET) * d.r;
            dustPos[i * 3] = Math.cos(ang) * r;
            dustPos[i * 3 + 1] = baseY + 0.03 + 0.18 * d.h * (0.5 + 0.5 * Math.sin(elapsed * 2 + d.a));
            dustPos[i * 3 + 2] = Math.sin(ang) * r;
            dustCol[i * 3] = 0.8 * vis; dustCol[i * 3 + 1] = 0.95 * vis; dustCol[i * 3 + 2] = vis;
          }
          dustGeo.attributes.position.needsUpdate = true;
          dustGeo.attributes.color.needsUpdate = true;
        }
        driveRings(windRings, k, 0.35, 0.18, NET + 0.4, 0.6);
      };
    } else if (solidId === 'icosahedron') {
      // WATER CORE: Undulating liquid sphere with caustic wireframe ripples
      const waterGeo = new THREE.IcosahedronGeometry(0.36, 2);
      const basePos = Float32Array.from(waterGeo.attributes.position.array);
      const waterMat = new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending
      });
      const waterMesh = new THREE.Mesh(waterGeo, waterMat);

      const dropGeo = new THREE.SphereGeometry(0.26, 16, 12);
      const dropMat = new THREE.MeshBasicMaterial({
        color: '#2563eb',
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const dropMesh = new THREE.Mesh(dropGeo, dropMat);

      innerGroup.add(waterMesh, dropMesh);
      disposables.push(waterGeo, waterMat, dropGeo, dropMat);

      // Splash FX: the orb falls onto the base, bursts into a crown of droplets that rain down, ripples spread across the net
      const DROPS = 60;
      const GRAV = 5;
      const T = 2.2; // seconds of droplet flight per unit of unfold
      const drops = Array.from({ length: DROPS }, () => {
        const a = Math.random() * Math.PI * 2;
        const vh = 0.3 + Math.random() * 0.9;
        const vy = 1.0 + Math.random() * 1.4;
        const y0 = baseY + 0.1 + Math.random() * 0.12;
        const a0 = Math.random() * Math.PI * 2;
        const r0 = Math.random() * 0.25;
        return {
          x0: Math.cos(a0) * r0,
          y0,
          z0: Math.sin(a0) * r0,
          vx: Math.cos(a) * vh,
          vz: Math.sin(a) * vh,
          vy,
          tl: 0.3 + Math.random() * 0.22,
          tLand: (vy + Math.sqrt(vy * vy + 2 * GRAV * (y0 - baseY))) / GRAV,
          shade: 0.6 + Math.random() * 0.4
        };
      });
      const dropPos = new Float32Array(DROPS * 3);
      const dropCol = new Float32Array(DROPS * 3);
      const dropsGeo = new THREE.BufferGeometry();
      dropsGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
      dropsGeo.setAttribute('color', new THREE.BufferAttribute(dropCol, 3));
      const dropsMat = new THREE.PointsMaterial({
        size: 0.055,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const droplets = new THREE.Points(dropsGeo, dropsMat);
      droplets.frustumCulled = false;
      fxGroup.add(droplets);
      const ripples = makeFlatRings(fxGroup, disposables, 4, '#7dd3fc', baseY + 0.01);
      disposables.push(dropsGeo, dropsMat);

      coreAnimator = (elapsed, energy) => {
        const k = dissolve();
        // The orb sinks onto the base, squashes flat on impact, then is gone as the crown erupts
        const sink = sstep(k, 0.05, 0.35);
        const squash = 1 - sstep(k, 0.25, 0.4) * 0.85;
        innerGroup.position.y = sink * (baseY + 0.3);
        innerGroup.scale.set(1 + (1 - squash) * 0.9, Math.max(0.001, squash), 1 + (1 - squash) * 0.9);
        const fade = 1 - sstep(k, 0.3, 0.45);
        waterMat.opacity = 0.45 * fade;
        dropMat.opacity = 0.42 * fade;

        // Droplets follow exact ballistic arcs, so scrubbing the slider in either direction replays the splash
        for (let i = 0; i < DROPS; i++) {
          const d = drops[i];
          let x = d.x0;
          let y = d.y0;
          let z = d.z0;
          let a = 0;
          if (k > d.tl) {
            const tau = (k - d.tl) * T;
            const t = Math.min(tau, d.tLand);
            x = d.x0 + d.vx * t;
            z = d.z0 + d.vz * t;
            y = d.y0 + d.vy * t - 0.5 * GRAV * t * t;
            a = 1 - sstep(tau - d.tLand, 0, 0.35); // mist away after landing
          }
          a *= 1 - sstep(k, 0.93, 1.0);
          dropPos[i * 3] = x;
          dropPos[i * 3 + 1] = y;
          dropPos[i * 3 + 2] = z;
          dropCol[i * 3] = 0.45 * a * d.shade;
          dropCol[i * 3 + 1] = 0.85 * a * d.shade;
          dropCol[i * 3 + 2] = a * d.shade;
        }
        dropsGeo.attributes.position.needsUpdate = true;
        dropsGeo.attributes.color.needsUpdate = true;
        driveRings(ripples, k, 0.42, 0.1, 2.6, 0.7);

        if (k > 0.999) return;
        const pos = waterGeo.attributes.position;
        const amp = 0.035 + energy * 0.04 + k * 0.06;
        for (let i = 0; i < pos.count; i++) {
          const bx = basePos[i * 3];
          const by = basePos[i * 3 + 1];
          const bz = basePos[i * 3 + 2];
          const wave = Math.sin(bx * 8.0 + elapsed * 3.5) * Math.cos(by * 8.0 - elapsed * 2.8) * amp;
          pos.array[i * 3] = bx * (1 + wave);
          pos.array[i * 3 + 1] = by * (1 + wave);
          pos.array[i * 3 + 2] = bz * (1 + wave);
        }
        pos.needsUpdate = true;
        waterMesh.rotation.y = elapsed * 0.6;
      };
    } else if (solidId === 'dodecahedron') {
      // AETHER CORE: Celestial astrolabe cage + golden starlight singularity
      const cageGeo = new THREE.IcosahedronGeometry(0.42, 0);
      const cageMat = new THREE.MeshBasicMaterial({
        color: '#e879f9',
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending
      });
      const cage = new THREE.Mesh(cageGeo, cageMat);

      const starGeo = new THREE.OctahedronGeometry(0.15, 1);
      const starMat = new THREE.MeshBasicMaterial({
        color: '#fef08a',
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending
      });
      const star = new THREE.Mesh(starGeo, starMat);

      const haloGeo = new THREE.TorusGeometry(0.52, 0.008, 8, 64);
      const haloMat = new THREE.MeshBasicMaterial({
        color: '#fde047',
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = Math.PI / 3;

      innerGroup.add(cage, star, halo);
      disposables.push(cageGeo, cageMat, starGeo, starMat, haloGeo, haloMat);

      coreAnimator = (elapsed, energy) => {
        const k = dissolve();
        // Supernova: the cage expands and spins away, the star swells to a blaze, then collapses; the halo flies out
        cage.rotation.y = -elapsed * 0.55 * (1 + k * 6.0);
        cage.rotation.x = elapsed * 0.3;
        cage.scale.setScalar(1 + k * 1.8);
        cageMat.opacity = 0.55 * (1 - sstep(k, 0.2, 0.9));
        const nova = Math.sin(k * Math.PI);
        const collapse = 1 - sstep(k, 0.85, 1.0);
        star.rotation.y = elapsed * 1.8;
        star.scale.setScalar(Math.max(0.001, (1 + Math.sin(elapsed * 4.0) * 0.15 + energy * 0.3 + nova * 3.0) * collapse));
        halo.rotation.z = elapsed * 0.8 * (1 + k * 4.0);
        halo.scale.setScalar(1 + k * 2.2);
        haloMat.opacity = 0.6 * (1 - sstep(k, 0.4, 1.0));
      };
    }

    // Core materials are cached once. During the incoming-solid intro, opacity
    // and a parent transform reveal the elemental centre over time instead of
    // showing it at full intensity on the first visible frame.
    const coreMaterialStates = [];
    const seenCoreMaterials = new Set();
    innerGroup.traverse((object) => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material || seenCoreMaterials.has(material)) continue;
        seenCoreMaterials.add(material);
        coreMaterialStates.push({
          material,
          opacity: typeof material.opacity === 'number' ? material.opacity : 1,
          transparent: material.transparent,
          depthWrite: material.depthWrite
        });
      }
    });
    const setCoreReveal = (progress, transitionFx = true) => {
      const p = THREE.MathUtils.clamp(progress, 0, 1);
      const reveal = p * p * (3 - 2 * p);
      coreRevealGroup.visible = reveal > 0.002 && unfold < 0.995;
      coreRevealGroup.scale.setScalar(0.08 + reveal * 0.92);
      const ringPulse = Math.sin(Math.PI * reveal);
      coreTransitionRing.visible = transitionFx && ringPulse > 0.002 && unfold < 0.995;
      coreTransitionRing.scale.setScalar(0.18 + reveal * 1.18);
      coreTransitionRing.rotation.set(Math.PI / 2, reveal * Math.PI * 2, 0);
      coreTransitionRingMaterial.opacity = transitionFx ? 0.72 * ringPulse : 0;
      for (let i = 0; i < coreMaterialStates.length; i++) {
        const state = coreMaterialStates[i];
        const material = state.material;
        if (typeof material.opacity === 'number') material.opacity = state.opacity * reveal;
        if (reveal < 0.995) {
          material.transparent = true;
          material.depthWrite = false;
        } else {
          material.transparent = state.transparent;
          material.depthWrite = state.depthWrite;
        }
      }
      if (p >= 1) coreRevealGroup.scale.setScalar(1);
    };
    setCoreReveal(0);

    // 5. Ambient elemental particle aura
    const particleCount = ({
      tetrahedron: 48,
      cube: 40,
      octahedron: 44,
      icosahedron: 48,
      dodecahedron: 44
    })[solidId] || 64;
    const pPositions = new Float32Array(particleCount * 3);
    const pSeeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      // For Fire, spawn many embers inside and rising up from the flame core
      const r = solidId === 'tetrahedron' ? Math.random() * 0.75 : 0.95 + Math.random() * 1.05;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pPositions[i * 3 + 2] = r * Math.cos(phi);
      pSeeds[i] = Math.random() * Math.PI * 2;
    }
    const ambientBasePositions = pPositions.slice();
    const resetAmbient = () => {
      pPositions.set(ambientBasePositions);
      pGeo.attributes.position.needsUpdate = true;
    };
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    const pMat = new THREE.PointsMaterial({
      color: meta.tertiaryColor,
      size: 0.036,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const particles = new THREE.Points(pGeo, pMat);
    uprightGroup.add(particles);

    // Update 2D net unfolding angle; the core dissolves via its own coreAnimator (see dissolve())
    const setUnfold = (unfoldFactor) => {
      for (let idx = 0; idx < hingeTree.length; idx++) {
        const node = hingeTree[idx];
        if (node.parentIndex === -1) continue;
        nodeGroups[idx].quaternion.setFromAxisAngle(node.axis, node.unfoldAngle * unfoldFactor);
      }
      unfold = unfoldFactor;
      innerGroup.visible = unfoldFactor < 0.995;
      fxGroup.visible = unfoldFactor > 0.005;
      refreshFaceRelativeMatrices();
      for (let i = 0; i < edgeRecords.length; i++) writeInstanceMatrix(edgeBatch, i, edgeRecords[i]);
      for (let i = 0; i < vertexRecords.length; i++) writeInstanceMatrix(vertexBatch, i, vertexRecords[i]);
      edgeBatch.instanceMatrix.needsUpdate = true;
      vertexBatch.instanceMatrix.needsUpdate = true;
    };

    const _uprightQuat = new THREE.Quaternion();
    const updateUpright = () => {
      rootGroup.getWorldQuaternion(_uprightQuat);
      uprightGroup.quaternion.copy(_uprightQuat).invert();
    };

    return {
      solidId,
      meta,
      geoData,
      rootGroup,
      faceMaterial,
      faceMeshes,
      edgeMeshes,
      vertexSpheres,
      interactiveTargets: [...vertexSpheres, ...edgeMeshes, ...faceMeshes],
      particles,
      particleSeeds: pSeeds,
      innerGroup,
      coreRevealGroup,
      fxGroup,
      setCoreReveal,
      coreAnimationTime: 0,
      getDissolve: dissolve,
      coreAnimator,
      setUnfold,
      updateUpright,
      beginDetonation,
      setDetonation,
      endDetonation,
      setReconstruction,
      setInstanceHighlight,
      resetForActivation(unfoldFactor = 0) {
        endDetonation();
        particles.visible = false;
        particles.material.opacity = 0.85;
        particles.scale.setScalar(1);
        particles.rotation.set(0, 0, 0);
        this.coreAnimationTime = 0;
        faceMaterial.uniforms.uFaceBurst.value = 0;
        edgeMaterial.uniforms.uDetonation.value = 0;
        vertexMaterial.opacity = 0.9;
        rootGroup.visible = false;
        rootGroup.position.set(0, 0, 0);
        rootGroup.rotation.set(0, 0, 0);
        rootGroup.scale.setScalar(1);
        innerGroup.position.set(0, 0, 0);
        innerGroup.scale.setScalar(1);
        setCoreReveal(0);
        fxGroup.visible = false;
        particles.visible = false;
        setUnfold(unfoldFactor);
        resetAmbient();
        coreAnimator?.(0, 0);
        setReconstruction(0);
      },
      dispose() {
        endDetonation();
        faceMaterial.dispose();
        faceMeshes.forEach((m) => m.geometry.dispose());
        edgeMaterial.dispose();
        edgeUnitGeometry.dispose();
        vertexUnitGeometry.dispose();
        vertexMaterial.dispose();
        disposables.forEach((d) => d.dispose());
        pGeo.dispose();
        pMat.dispose();
      }
    };
  }
}
