import * as THREE from 'three';
import { PLATONIC_DATA, getSolidGeometryData } from './PlatonicMath.js?v=5';
import {
  createSheerFaceMaterial,
  createGlowingEdgeMaterial,
  createInnerFlameMaterial
} from '../shaders/ElementShaders.js?v=5';

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
    const { vertices, faces, faceNormals, hingeTree } = geoData;

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

    const faceMeshes = [];
    const edgeMeshes = [];
    const vertexSpheres = [];
    const upVec = new THREE.Vector3(0, 1, 0);

    faces.forEach((face, fi) => {
      const node = hingeTree[fi];
      const localOrigin = node.parentIndex === -1 ? new THREE.Vector3(0, 0, 0) : node.pivot;
      const localPts = face.map((vIdx) => vertices[vIdx].clone().sub(localOrigin));

      // 1. Nearly invisible glass face mesh (enables face click alignment & subtle Fresnel sheen)
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

      const fMesh = new THREE.Mesh(fGeo, faceMaterial);
      fMesh.userData = {
        interactType: 'face',
        faceIndex: fi,
        vertexIndices: face,
        localNormal: n.clone()
      };
      nodeGroups[fi].add(fMesh);
      faceMeshes.push(fMesh);

      // 2. Luminous 3D cylindrical glowing edge beams (thick, gradient-colored, bloom-ready)
      const m = localPts.length;
      for (let k = 0; k < m; k++) {
        const pA = localPts[k];
        const pB = localPts[(k + 1) % m];
        const vA = face[k];
        const vB = face[(k + 1) % m];

        const dir = new THREE.Vector3().subVectors(pB, pA);
        const len = dir.length();
        const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);

        const strutGeo = new THREE.CylinderGeometry(0.013, 0.013, len, 8, 1, true);
        const strutMat = createGlowingEdgeMaterial(this.globalUniforms);
        const strut = new THREE.Mesh(strutGeo, strutMat);
        strut.position.copy(mid);
        strut.quaternion.setFromUnitVectors(upVec, dir.clone().normalize());

        strut.userData = {
          interactType: 'edge',
          edgeVertices: [vA, vB],
          strutMat
        };
        nodeGroups[fi].add(strut);
        edgeMeshes.push(strut);
      }

      // 3. Glowing vertex nodes at corners
      localPts.forEach((lp, k) => {
        const vIdx = face[k];
        const orbGeo = new THREE.SphereGeometry(0.028, 12, 12);
        const orbMat = new THREE.MeshBasicMaterial({
          color: meta.tertiaryColor,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false
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

    // 4. Build Dedicated Interior Elemental Core Phenomenon
    const innerGroup = new THREE.Group();
    innerGroup.name = 'ElementalCore';

    // The Fire tetrahedron's flame and embers live in an "upright" group that is counter-rotated every frame,
    // so they always point up in world space no matter how the solid is rotated.
    let uprightGroup = null;
    if (solidId === 'tetrahedron') {
      uprightGroup = new THREE.Group();
      uprightGroup.name = 'UprightFire';
      rootGroup.add(uprightGroup);
      uprightGroup.add(innerGroup);
    } else {
      rootGroup.add(innerGroup);
    }

    const disposables = [];
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

      const outerFlameGeo = new THREE.SphereGeometry(0.28, 28, 28);
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

      // Shards: 14 emerald splinters that burst out when the crystal shatters
      const shardGeo = new THREE.OctahedronGeometry(0.05, 0);
      disposables.push(shardGeo);
      const shards = [];
      for (let i = 0; i < 14; i++) {
        const y = 1 - (i / 13) * 2;
        const rad = Math.sqrt(1 - y * y);
        const a = i * 2.39996;
        const mat = new THREE.MeshBasicMaterial({
          color: i % 2 ? '#6ee7b7' : '#a7f3d0',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(shardGeo, mat);
        innerGroup.add(mesh);
        disposables.push(mat);
        shards.push({ mesh, mat, dir: new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad) });
      }

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
        // Shatter: shards fly outward and fade
        const born = sstep(k, 0.25, 0.45);
        const gone = 1 - sstep(k, 0.65, 1.0);
        shards.forEach(({ mesh, mat, dir }, i) => {
          mesh.position.copy(dir).multiplyScalar(0.2 + k * 1.3);
          mesh.rotation.set(elapsed * 2 + i, elapsed * 1.6, 0);
          mat.opacity = 0.9 * born * gone;
        });
        innerGroup.scale.setScalar(1 + energy * 0.25);
      };
    } else if (solidId === 'octahedron') {
      // AIR CORE: Swirling 3D helical wind vortex streamlines
      const ribbons = [];
      for (let r = 0; r < 3; r++) {
        const pts = [];
        const offsetAngle = (r * Math.PI * 2) / 3;
        for (let i = 0; i <= 64; i++) {
          const t = i / 64;
          const angle = t * Math.PI * 4 + offsetAngle;
          const radius = Math.sin(t * Math.PI) * 0.36;
          const y = (t - 0.5) * 0.95;
          pts.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.009, 6, false);
        const tubeMat = new THREE.MeshBasicMaterial({
          color: r === 0 ? '#e0f2fe' : '#38bdf8',
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(tubeGeo, tubeMat);
        innerGroup.add(mesh);
        ribbons.push(mesh);
        disposables.push(tubeGeo, tubeMat);
      }

      coreAnimator = (elapsed, energy) => {
        const k = dissolve();
        // Gust: the vortex spins up, spreads wide, flattens and thins out into the air
        innerGroup.rotation.y = elapsed * (2.2 + energy * 4.0 + k * 9.0);
        innerGroup.scale.set(1 + k * 2.4, Math.max(0.001, 1 - k * 0.65), 1 + k * 2.4);
        const fade = 1 - sstep(k, 0.3, 1.0);
        ribbons.forEach((rb, idx) => {
          rb.scale.setScalar(1 + Math.sin(elapsed * 3.0 + idx) * 0.08);
          rb.material.opacity = 0.8 * fade;
        });
      };
    } else if (solidId === 'icosahedron') {
      // WATER CORE: Undulating liquid sphere with caustic wireframe ripples
      const waterGeo = new THREE.IcosahedronGeometry(0.36, 3);
      const basePos = Float32Array.from(waterGeo.attributes.position.array);
      const waterMat = new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending
      });
      const waterMesh = new THREE.Mesh(waterGeo, waterMat);

      const dropGeo = new THREE.SphereGeometry(0.26, 24, 24);
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

      coreAnimator = (elapsed, energy) => {
        const k = dissolve();
        // Splash: the orb sinks into a shallow pool that spreads out, rippling harder, then evaporates
        innerGroup.scale.set(1 + k * 1.8, Math.max(0.02, 1 - k * 0.97), 1 + k * 1.8);
        const fade = 1 - sstep(k, 0.55, 1.0);
        waterMat.opacity = 0.45 * fade;
        dropMat.opacity = 0.42 * fade;
        if (k > 0.999) return;
        const pos = waterGeo.attributes.position;
        const amp = 0.035 + energy * 0.04 + k * 0.09;
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

    // 5. Ambient elemental particle aura
    const particleCount = 110;
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
    (uprightGroup || rootGroup).add(particles);

    // Update 2D net unfolding angle; the core dissolves via its own coreAnimator (see dissolve())
    const setUnfold = (unfoldFactor) => {
      hingeTree.forEach((node, idx) => {
        if (node.parentIndex === -1) return;
        const q = new THREE.Quaternion().setFromAxisAngle(node.axis, node.unfoldAngle * unfoldFactor);
        nodeGroups[idx].quaternion.copy(q);
      });
      unfold = unfoldFactor;
      innerGroup.visible = unfoldFactor < 0.995;
    };

    const _uprightQuat = new THREE.Quaternion();
    const updateUpright = () => {
      if (!uprightGroup) return;
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
      particles,
      particleSeeds: pSeeds,
      innerGroup,
      coreAnimator,
      setUnfold,
      updateUpright,
      dispose() {
        faceMaterial.dispose();
        faceMeshes.forEach((m) => m.geometry.dispose());
        edgeMeshes.forEach((s) => {
          s.geometry.dispose();
          s.material.dispose();
        });
        vertexSpheres.forEach((s) => {
          s.geometry.dispose();
          s.material.dispose();
        });
        disposables.forEach((d) => d.dispose());
        pGeo.dispose();
        pMat.dispose();
      }
    };
  }
}
