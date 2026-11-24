import * as THREE from 'three';

// One bounded particle pool is reused for every elemental solid. No geometry or
// material is created while charging or detonating.
const PARTICLE_COUNT = 96;
const FRAGMENT_COUNT = 24;
const TAU = Math.PI * 2;
const ELEMENTS = {
  tetrahedron: { style: 'fire', colors: ['#ff3b1f', '#ff8a36', '#ffe08a'], chargeSpeed: 1.55, burstDuration: 1.72 },
  cube: { style: 'earth', colors: ['#078b62', '#2bd69b', '#c2ffe4'], chargeSpeed: 0.82, burstDuration: 1.88 },
  octahedron: { style: 'air', colors: ['#087db9', '#43c7ff', '#d7f6ff'], chargeSpeed: 1.85, burstDuration: 1.58 },
  icosahedron: { style: 'water', colors: ['#1749c9', '#36a9f8', '#a5f4ff'], chargeSpeed: 1.1, burstDuration: 1.92 },
  dodecahedron: { style: 'aether', colors: ['#7628c7', '#c38bff', '#ffe68a'], chargeSpeed: 0.96, burstDuration: 2.0 }
};

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const smooth01 = (t) => t * t * (3 - 2 * t);

/**
 * HoldFX — bounded, pooled elemental charge and detonation effects.
 * Five solids share one particle buffer, one InstancedMesh and three wave rings;
 * their force fields, trajectories, wave profiles and shard motion are distinct.
 */
export class HoldFX {
  constructor(scene, camera) {
    this.camera = camera;
    this.scene = scene;
    this.solidId = 'tetrahedron';
    this.style = 'fire';
    this.flash = 0;
    this.phase = 'idle';
    this.energy = 0;
    this.age = 0;
    this.duration = ELEMENTS.tetrahedron.burstDuration;
    this.releaseEnergy = 0;
    this.detonationSolid = null;
    this.chargeIntroElapsed = 0;
    this.chargeFadeElapsed = 0;
    this.chargeIntroDuration = 0.45;
    this.chargeFadeDuration = 0.38;
    this.fadeEnergy = 0;
    this._worldPosition = new THREE.Vector3();
    this._worldQuaternion = new THREE.Quaternion();
    this._dummy = new THREE.Object3D();
    this._handoffPositions = new Float32Array(PARTICLE_COUNT * 3);
    this._handoffFragmentTransforms = Array.from({ length: FRAGMENT_COUNT }, () => ({
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3()
    }));
    this._handoffRingScales = new Float32Array(9);
    this._handoffRingOpacities = new Float32Array(3);
    this._handoffTargetPosition = new THREE.Vector3();
    this._handoffTargetQuaternion = new THREE.Quaternion();
    this._handoffTargetScale = new THREE.Vector3();
    this._contactPoint = new THREE.Vector3();
    this._contactNormal = new THREE.Vector3(0, 0, 1);
    this._contactPlaneNormal = new THREE.Vector3(0, 0, 1);
    this._contactQuaternion = new THREE.Quaternion();
    this._contactAge = 0;
    this._contactActive = false;
    this._handoffContactScale = 1;
    this._handoffContactOpacity = 0;
    this._handoffShellScale = 1;
    this._handoffParticleOpacity = 0;
    this._handoffFragmentOpacity = 0;
    this._handoffShellOpacity = 0;
    this._handoffFlash = 0;
    this._handoffActive = false;
    this._burstStartRadius = 0;

    this.group = new THREE.Group();
    this.group.name = 'ElementalResonance';
    this.group.visible = false;
    scene.add(this.group);

    // Golden-angle sphere distribution is deterministic and computed once.
    this.seeds = new Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const y = 1 - 2 * ((i + 0.5) / PARTICLE_COUNT);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * 2.399963229728653;
      this.seeds[i] = {
        x: Math.cos(theta) * r,
        y,
        z: Math.sin(theta) * r,
        theta,
        phase: (i % 13) / 13,
        speed: 0.72 + ((i * 17) % 29) / 40,
        delay: ((i * 7) % 19) / 19,
        spin: i % 2 ? 1 : -1
      };
    }

    this.positions = new Float32Array(PARTICLE_COUNT * 3);
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleMat = new THREE.PointsMaterial({
      color: '#ffe08a', size: 0.052, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, toneMapped: false
    });
    this.particles = new THREE.Points(particleGeo, this.particleMat);
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    // Instanced debris pool: fragments are reused, never allocated per burst.
    this.fragmentGeo = new THREE.IcosahedronGeometry(0.075, 0);
    this.fragmentMat = new THREE.MeshBasicMaterial({
      color: '#ffe08a', transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    this.fragments = new THREE.InstancedMesh(this.fragmentGeo, this.fragmentMat, FRAGMENT_COUNT);
    this.fragments.name = 'ElementalFragments';
    this.fragments.frustumCulled = false;
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fragments.count = FRAGMENT_COUNT;
    this.group.add(this.fragments);
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const seed = this.seeds[(i * 4) % PARTICLE_COUNT];
      this._dummy.position.set(seed.x * 0.3, seed.y * 0.3, seed.z * 0.3);
      this._dummy.scale.setScalar(0.0001);
      this._dummy.updateMatrix();
      this.fragments.setMatrixAt(i, this._dummy.matrix);
    }

    // Three reusable toroidal fronts are shaped differently per element.
    this.rings = [];
    const ringGeo = new THREE.TorusGeometry(1, 0.012, 5, 64);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#ffe08a', transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.name = `ElementalWave_${i}`;
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, material: mat, index: i });
    }

    this.contactMaterial = new THREE.MeshBasicMaterial({
      color: '#ffe08a', transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false
    });
    this.contactRing = new THREE.Mesh(ringGeo, this.contactMaterial);
    this.contactRing.name = 'ChargeContactRing';
    this.contactRing.visible = false;
    this.group.add(this.contactRing);

    // A small wireframe shell gives the detonation a readable centre, not a
    // full-screen flash. It expands only around the selected solid.
    this.shellGeo = new THREE.IcosahedronGeometry(0.42, 1);
    this.shellMat = new THREE.MeshBasicMaterial({
      color: '#ffe08a', wireframe: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    this.shell = new THREE.Mesh(this.shellGeo, this.shellMat);
    this.group.add(this.shell);

    this._applyElementStyle(this.solidId);
  }

  setElement(meta, solidId = meta?.id || this.solidId) {
    if (!meta) return;
    this.solidId = ELEMENTS[solidId] ? solidId : 'tetrahedron';
    this.style = ELEMENTS[this.solidId].style;
    const [primary, secondary, tertiary] = ELEMENTS[this.solidId].colors;
    this.colors = [new THREE.Color(primary), new THREE.Color(secondary), new THREE.Color(tertiary)];
    this._applyElementStyle(this.solidId);
  }

  setContact(point, normal) {
    this._contactPoint.copy(point);
    this._contactNormal.copy(normal).normalize();
    if (this._contactNormal.lengthSq() < 0.001) this._contactNormal.set(0, 0, 1);
    this._contactQuaternion.setFromUnitVectors(this._contactPlaneNormal, this._contactNormal);
    this._contactAge = 0;
    this._contactActive = true;
  }

  clearContact() {
    this._contactActive = false;
    this.contactRing.visible = false;
    this.contactMaterial.opacity = 0;
  }

  _updateContactRing(energy, alpha, elapsed) {
    if (!this._contactActive) {
      this.contactRing.visible = false;
      this.contactMaterial.opacity = 0;
      return;
    }
    this.contactRing.visible = alpha > 0.002;
    this.contactRing.position.copy(this._contactPoint);
    this.contactRing.quaternion.copy(this._contactQuaternion);
    this.contactRing.scale.setScalar(0.12 + energy * 0.3 + Math.sin(elapsed * 10) * 0.015);
    this.contactMaterial.opacity = alpha * (0.24 + energy * 0.52);
  }

  _applyElementStyle(solidId) {
    const style = ELEMENTS[solidId] || ELEMENTS.tetrahedron;
    this.style = style.style;
    const colors = this.colors || style.colors.map((c) => new THREE.Color(c));
    this.particleMat.color.copy(colors[1]);
    this.fragmentMat.color.copy(colors[2]);
    this.shellMat.color.copy(colors[0]);
    this.contactMaterial.color.copy(colors[1]);
    this.rings.forEach(({ material }, i) => material.color.copy(colors[i % 3]));

    // Distinct wave orientations communicate each element's geometry.
    const orientations = {
      fire: [[0.25, 0, 0], [Math.PI / 2, 0.35, 0], [0.8, 0.7, 0.2]],
      earth: [[Math.PI / 2, 0, 0], [0.08, 0, 0], [0.08, Math.PI / 2, 0]],
      air: [[0.55, 0, 0], [0.55, 1.05, 0], [0.55, 2.1, 0]],
      water: [[0, 0, 0], [0.12, 0, 0], [0.24, 0, 0]],
      aether: [[0.5, 0, 0], [0.5, 1.047, 0], [0.5, 2.094, 0]]
    }[this.style];
    this.rings.forEach(({ mesh }, i) => mesh.rotation.set(...orientations[i]));
  }

  reset() {
    if (this.detonationSolid?.endDetonation) this.detonationSolid.endDetonation();
    this.detonationSolid = null;
    this.phase = 'idle';
    this.energy = 0;
    this.age = 0;
    this.flash = 0;
    this.releaseEnergy = 0;
    this._handoffActive = false;
    this._contactActive = false;
    this._contactAge = 0;
    this.contactRing.visible = false;
    this.contactMaterial.opacity = 0;
    this.chargeIntroElapsed = 0;
    this.chargeFadeElapsed = 0;
    this.fadeEnergy = 0;
    this.group.visible = false;
    this.particleMat.opacity = 0;
    this.fragmentMat.opacity = 0;
    this.shellMat.opacity = 0;
    this.rings.forEach(({ mesh, material }) => {
      mesh.visible = false;
      material.opacity = 0;
    });
    this.fragments.visible = false;
    this.particles.visible = false;
    this.shell.visible = false;
  }

  /** Begin a powerful but spatially bounded detonation around the active solid. */
  burst(energy = 1, solidId = this.solidId, solid = null) {
    this._handoffActive = ['charge-intro', 'charging', 'charge-fade'].includes(this.phase) && this.group.visible;
    if (this._handoffActive) {
      this._handoffPositions.set(this.positions);
      this._handoffParticleOpacity = this.particleMat.opacity;
      this._handoffFragmentOpacity = this.fragmentMat.opacity;
      this._handoffShellOpacity = this.shellMat.opacity;
      this._handoffShellScale = this.shell.scale.x;
      this._handoffFlash = this.flash;
      this._handoffContactScale = this.contactRing.scale.x;
      this._handoffContactOpacity = this.contactMaterial.opacity;
      for (let i = 0; i < this.rings.length; i++) {
        const { mesh, material } = this.rings[i];
        const offset = i * 3;
        this._handoffRingScales[offset] = mesh.scale.x;
        this._handoffRingScales[offset + 1] = mesh.scale.y;
        this._handoffRingScales[offset + 2] = mesh.scale.z;
        this._handoffRingOpacities[i] = material.opacity;
      }
      for (let i = 0; i < FRAGMENT_COUNT; i++) {
        this.fragments.getMatrixAt(i, this._dummy.matrix);
        this._dummy.matrix.decompose(
          this._handoffFragmentTransforms[i].position,
          this._handoffFragmentTransforms[i].quaternion,
          this._handoffFragmentTransforms[i].scale
        );
      }
    } else {
      this._handoffParticleOpacity = 0;
      this._handoffFragmentOpacity = 0;
      this._handoffShellOpacity = 0;
      this._handoffFlash = 0;
      this._handoffContactOpacity = 0;
    }
    if (solidId !== this.solidId && ELEMENTS[solidId]) this.solidId = solidId;
    this.style = ELEMENTS[this.solidId]?.style || 'fire';
    this.releaseEnergy = THREE.MathUtils.clamp(energy, 0, 1);
    this._burstStartRadius = this._handoffActive ? 1.72 - this.releaseEnergy * 0.98 : 0;
    this.age = 0;
    this.duration = ELEMENTS[this.solidId]?.burstDuration || 1.72;
    this.phase = 'detonating';
    this.chargeIntroElapsed = 0;
    this.chargeFadeElapsed = 0;
    this.detonationSolid = solid;
    this.detonationSolid?.beginDetonation?.();
    if (!this._handoffActive) this.flash = 0;
    this.group.visible = true;
    this.particles.visible = true;
    this.fragments.visible = true;
    this.shell.visible = true;
    this.rings.forEach(({ mesh }) => { mesh.visible = true; });
    if (!this._handoffActive) {
      this.particleMat.opacity = 0;
      this.fragmentMat.opacity = 0;
      this.shellMat.opacity = 0;
      this.rings.forEach(({ material }) => { material.opacity = 0; });
    }
  }

  _updateCharge(dt, energy, elapsed, introAlpha = 1) {
    this.energy = energy;
    const style = this.style;
    const spread = 1.72 - energy * 0.98;
    const chargeRate = ELEMENTS[this.solidId]?.chargeSpeed || 1;
    const spiral = elapsed * chargeRate * (style === 'fire' ? 2.8 : style === 'air' ? 1.9 : 0.8);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const s = this.seeds[i];
      let x, y, z;
      if (style === 'fire') {
        const a = s.theta + spiral * s.spin + s.phase * 0.6;
        const r = spread * (0.92 + 0.08 * Math.sin(elapsed * 3 + i));
        x = Math.cos(a) * r * Math.sqrt(1 - s.y * s.y);
        z = Math.sin(a) * r * Math.sqrt(1 - s.y * s.y);
        y = s.y * r + energy * 0.38 * (0.5 + 0.5 * s.spin);
      } else if (style === 'earth') {
        const facet = Math.round(s.theta / (Math.PI / 3)) * (Math.PI / 3);
        const a = THREE.MathUtils.lerp(s.theta, facet, energy * 0.76);
        const r = spread * (0.9 + 0.1 * Math.cos(elapsed * 1.4 + i * 0.2));
        x = Math.cos(a) * r * Math.sqrt(1 - s.y * s.y);
        z = Math.sin(a) * r * Math.sqrt(1 - s.y * s.y);
        y = s.y * r * 0.82;
      } else if (style === 'air') {
        const a = s.theta + spiral * 1.6 + energy * 2.8;
        const r = 0.68 + spread * 0.28 + Math.sin(elapsed * 2 + s.phase * TAU) * 0.07;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        y = s.y * 1.45;
      } else if (style === 'water') {
        const a = s.theta + spiral * 0.75;
        const r = spread * (0.84 + 0.16 * Math.sin(elapsed * 1.7 + i * 0.12));
        x = Math.cos(a) * r * Math.sqrt(1 - s.y * s.y);
        z = Math.sin(a) * r * Math.sqrt(1 - s.y * s.y);
        y = s.y * r + Math.sin(elapsed * 2.4 + s.theta) * 0.08;
      } else {
        const a = s.theta + (i % 4) * 0.035 + spiral * 0.42;
        const pulse = 1 + 0.045 * Math.sin(elapsed * 1.8 + i * 0.7);
        x = s.x * spread * pulse;
        y = s.y * spread * pulse;
        z = Math.sin(a) * Math.sqrt(1 - s.y * s.y) * spread;
      }
      const o = i * 3;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.visible = introAlpha > 0.002;
    this.particleMat.opacity = (0.18 + energy * 0.7) * introAlpha;
    this.particleMat.size = (0.032 + energy * 0.035) * (0.72 + introAlpha * 0.28);

    const ringEnergy = (0.12 + energy * 0.58) * introAlpha;
    const chargeProgress = smooth01(energy);
    const ready = smooth01(THREE.MathUtils.clamp((energy - 0.82) / 0.18, 0, 1));
    for (let index = 0; index < this.rings.length; index++) {
      const { mesh, material } = this.rings[index];
      mesh.visible = introAlpha > 0.002;
      const pulse = 1 + ready * (0.035 + 0.025 * Math.sin(elapsed * 14 + index));
      const chargeRadius = 1.12 - chargeProgress * 0.3;
      mesh.scale.setScalar(chargeRadius * (1 + index * 0.08) * pulse);
      mesh.rotation.z += dt * (0.18 + energy * 0.5) * (index % 2 ? -1 : 1);
      material.opacity = ringEnergy * (1 - index * 0.17)
        * (1 + ready * (0.12 + 0.08 * Math.sin(elapsed * 14 + index)));
    }
    this.fragmentMat.opacity = energy * 0.46 * introAlpha;
    // Let the fragment pool follow the same intro envelope as particles and rings;
    // its scale and opacity already start near zero, so it should not pop at an energy threshold.
    this.fragments.visible = energy > 0.015 && introAlpha > 0.002;
    this._updateFragmentsCharge(energy, elapsed, introAlpha);
    this.shell.visible = introAlpha > 0.002;
    this.shell.scale.setScalar((0.12 + introAlpha * 0.88) * (0.42 + energy * (this.style === 'earth' ? 0.28 : 0.45)));
    this.shellMat.opacity = energy * 0.5 * introAlpha;
    const targetFlash = energy * 0.2 * introAlpha + ready * (0.04 + 0.03 * Math.sin(elapsed * 14));
    this.flash += (targetFlash - this.flash) * Math.min(1, dt * 12);
    this._updateContactRing(energy, introAlpha, elapsed);
  }

  _updateFragmentsCharge(energy, elapsed, introAlpha = 1) {
    const count = FRAGMENT_COUNT;
    for (let i = 0; i < count; i++) {
      const s = this.seeds[(i * 4) % PARTICLE_COUNT];
      const pulse = 0.75 + 0.25 * Math.sin(elapsed * 2 + i * 1.3);
      const radius = 0.7 + energy * 0.35;
      this._dummy.position.set(s.x * radius, s.y * radius, s.z * radius);
      this._dummy.rotation.set(elapsed * 0.28 + i, elapsed * 0.36, i * 0.23);
      this._dummy.scale.setScalar(Math.max(0.0001, energy * 0.12 * pulse * introAlpha));
      this._dummy.updateMatrix();
      this.fragments.setMatrixAt(i, this._dummy.matrix);
    }
    this.fragments.instanceMatrix.needsUpdate = true;
  }

  _updateDetonation(dt) {
    this.age = Math.min(this.duration, this.age + dt);
    const t = THREE.MathUtils.clamp(this.age / this.duration, 0, 1);
    const eased = easeOutCubic(t);
    const style = this.style;
    const energy = this.releaseEnergy;
    const intro = smooth01(THREE.MathUtils.clamp(t / 0.16, 0, 1));
    const handoff = this._handoffActive ? smooth01(THREE.MathUtils.clamp(this.age / 0.18, 0, 1)) : 1;
    const fade = intro * (1 - smooth01(THREE.MathUtils.clamp((t - 0.58) / 0.42, 0, 1)));
    this.detonationSolid?.setDetonation?.(t, style);
    const radialEnd = style === 'air' ? 3.0 : style === 'earth' ? 2.25 : style === 'water' ? 2.6 : 2.85;
    const radial = this._burstStartRadius + (radialEnd - this._burstStartRadius) * eased;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const s = this.seeds[i];
      const phase = THREE.MathUtils.clamp((t - s.delay * 0.12) / (1 - s.delay * 0.12), 0, 1);
      const a = s.theta + (style === 'fire' ? phase * 2.4 * s.spin : style === 'air' ? phase * 5.8 : style === 'aether' ? phase * 0.9 : 0);
      const rr = radial * (0.78 + s.speed * 0.24);
      let x = s.x * rr;
      let y = s.y * rr;
      let z = s.z * rr;

      if (style === 'fire') {
        const orbit = phase * 0.52;
        x = (s.x * Math.cos(orbit) - s.z * Math.sin(orbit)) * rr;
        z = (s.x * Math.sin(orbit) + s.z * Math.cos(orbit)) * rr;
        y += phase * (0.44 + s.phase * 0.3) - 0.12 * phase * phase;
      } else if (style === 'earth') {
        y = s.y * rr;
        x *= 0.92 + 0.08 * Math.cos(phase * TAU + i);
        z *= 0.92 + 0.08 * Math.sin(phase * TAU + i);
      } else if (style === 'air') {
        const ca = Math.cos(a), sa = Math.sin(a);
        const baseX = s.x * rr, baseZ = s.z * rr;
        x = baseX * ca - baseZ * sa;
        z = baseX * sa + baseZ * ca;
        y = s.y * rr * 0.64 + Math.sin(phase * TAU + s.theta) * 0.18;
      } else if (style === 'water') {
        const ripple = Math.sin(phase * Math.PI) * 0.48;
        y = s.y * rr * 0.5 + ripple * (0.3 + 0.7 * Math.abs(s.y));
      } else {
        const starPulse = 1 + 0.13 * Math.sin(phase * Math.PI * 3 + i * 0.5);
        x *= starPulse;
        y *= starPulse;
        z *= starPulse;
        y += Math.sin(phase * TAU + s.theta) * 0.12;
      }

      const o = i * 3;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
    }
    const burstParticleOpacity = energy * 0.96 * fade;
    if (this._handoffActive) {
      for (let i = 0; i < this.positions.length; i++) {
        this.positions[i] = THREE.MathUtils.lerp(this._handoffPositions[i], this.positions[i], handoff);
      }
      this.particleMat.opacity =
        this._handoffParticleOpacity * (1 - handoff) + burstParticleOpacity * handoff;
    } else {
      this.particleMat.opacity = burstParticleOpacity;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particleMat.size = (style === 'water' ? 0.068 : 0.058) * (0.9 + 0.2 * energy);

    // Distinct debris trajectories: shards, crystal splinters, air fragments,
    // water droplets and constellation nodes all reuse the same instanced pool.
    const fragmentFade = intro * (1 - smooth01(THREE.MathUtils.clamp((t - 0.52) / 0.48, 0, 1)));
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const s = this.seeds[(i * 4) % PARTICLE_COUNT];
      const delay = s.delay * 0.12;
      const p = THREE.MathUtils.clamp((t - delay) / (1 - delay), 0, 1);
      const dist = (style === 'earth' ? 1.7 : style === 'air' ? 1.0 : 1.25) * easeOutCubic(p);
      let px = s.x * dist, py = s.y * dist, pz = s.z * dist;
      if (style === 'fire') { py += p * 0.48 - p * p * 0.2; }
      else if (style === 'earth') { py += Math.sin(p * TAU + s.phase) * 0.08; }
      else if (style === 'air') {
        const a = p * 4.8;
        const c = Math.cos(a), sn = Math.sin(a);
        const nx = px * c - pz * sn; pz = px * sn + pz * c; px = nx;
        py += Math.sin(p * TAU + i) * 0.16;
      } else if (style === 'water') { py += Math.sin(p * Math.PI) * 0.32; }
      else { py += Math.sin(p * TAU + i * 0.6) * 0.2; }
      this._dummy.position.set(px, py, pz);
      this._dummy.rotation.set(p * (1.8 + i * 0.1), p * (2.2 + i * 0.08), p * 1.4);
      const baseSize = style === 'earth' ? 0.19 : style === 'aether' ? 0.14 : 0.12;
      this._dummy.scale.setScalar(Math.max(0.0001, baseSize * energy * fragmentFade * (0.72 + s.speed * 0.28)));
      if (this._handoffActive) {
        const start = this._handoffFragmentTransforms[i];
        this._handoffTargetPosition.copy(this._dummy.position);
        this._handoffTargetQuaternion.copy(this._dummy.quaternion);
        this._handoffTargetScale.copy(this._dummy.scale);
        this._dummy.position.lerpVectors(start.position, this._handoffTargetPosition, handoff);
        this._dummy.quaternion.copy(start.quaternion).slerp(this._handoffTargetQuaternion, handoff);
        this._dummy.scale.lerpVectors(start.scale, this._handoffTargetScale, handoff);
      }
      this._dummy.updateMatrix();
      this.fragments.setMatrixAt(i, this._dummy.matrix);
    }
    this.fragments.instanceMatrix.needsUpdate = true;
    const burstFragmentOpacity = energy * 0.92 * fragmentFade;
    this.fragmentMat.opacity = this._handoffActive
      ? this._handoffFragmentOpacity * (1 - handoff) + burstFragmentOpacity * handoff
      : burstFragmentOpacity;

    // Element signatures: the same three pooled fronts use different planes,
    // aspect ratios and rotation profiles, avoiding expensive per-burst geometry.
    for (let index = 0; index < this.rings.length; index++) {
      const { mesh, material } = this.rings[index];
      const k = index + 1;
      let sx = 0.14 + radial * (style === 'earth' ? 0.92 : 1.0);
      let sy = sx;
      let sz = sx;
      if (style === 'earth') { sy *= 0.28 + 0.06 * k; }
      else if (style === 'air') { sx *= 1.0 + 0.12 * k; sy *= 0.62; sz *= 0.88; mesh.rotation.y += dt * (1.4 + k); }
      else if (style === 'water') { sy *= 0.42; sx *= 1.12; }
      else if (style === 'aether') { sx *= 0.96 + k * 0.04; sy *= 1.02 + k * 0.08; mesh.rotation.z += dt * (index % 2 ? -0.8 : 0.8); }
      else { sy *= 0.76 + 0.12 * k; mesh.rotation.x += dt * (0.5 + k * 0.18); }
      const targetScaleX = sx * intro;
      const targetScaleY = sy * intro;
      const targetScaleZ = sz * intro;
      if (this._handoffActive) {
        const offset = index * 3;
        mesh.scale.set(
          THREE.MathUtils.lerp(this._handoffRingScales[offset], targetScaleX, handoff),
          THREE.MathUtils.lerp(this._handoffRingScales[offset + 1], targetScaleY, handoff),
          THREE.MathUtils.lerp(this._handoffRingScales[offset + 2], targetScaleZ, handoff)
        );
      } else {
        mesh.scale.set(targetScaleX, targetScaleY, targetScaleZ);
      }
      const targetOpacity = energy * 0.82 * fade * (1 - index * 0.18);
      material.opacity = this._handoffActive
        ? this._handoffRingOpacities[index] * (1 - handoff) + targetOpacity * handoff
        : targetOpacity;
      mesh.visible = material.opacity > 0.005;
    }

    const shellScale = style === 'earth' ? 0.4 + t * 1.65 : style === 'air' ? 0.3 + t * 2.1 : 0.35 + t * 1.85;
    const targetShellScale = shellScale * intro;
    this.shell.scale.setScalar(this._handoffActive
      ? THREE.MathUtils.lerp(this._handoffShellScale, targetShellScale, handoff)
      : targetShellScale);
    this.shell.rotation.set(t * 0.8, t * (style === 'aether' ? 2.8 : 1.1), t * 0.45);
    const targetShellOpacity = energy * 0.48 * fade;
    this.shellMat.opacity = this._handoffActive
      ? this._handoffShellOpacity * (1 - handoff) + targetShellOpacity * handoff
      : targetShellOpacity;
    if (this._handoffActive && this._handoffContactOpacity > 0.002) {
      this.contactRing.visible = true;
      this.contactRing.position.copy(this._contactPoint);
      this.contactRing.quaternion.copy(this._contactQuaternion);
      this.contactRing.scale.setScalar(this._handoffContactScale * (1 + handoff * 0.8));
      this.contactMaterial.opacity = this._handoffContactOpacity * (1 - handoff);
    } else {
      this.contactRing.visible = false;
      this.contactMaterial.opacity = 0;
    }
    const detonationFlash = Math.max(0, energy * 0.78 * (1 - t) * intro * (style === 'fire' ? 1.0 : 0.72));
    this.flash = this._handoffActive
      ? this._handoffFlash * (1 - handoff) + detonationFlash * handoff
      : detonationFlash;

    if (handoff >= 1) {
      this._handoffActive = false;
      this._contactActive = false;
      this.contactRing.visible = false;
      this.contactMaterial.opacity = 0;
    }
    if (t >= 1) this.reset();
  }

  update(dt, energy, solid, elapsed = 0) {
    const targetSolid = this.phase === 'detonating' ? this.detonationSolid : solid;
    if (!targetSolid?.rootGroup?.visible) {
      if (this.phase === 'charging' || this.phase === 'charge-intro' || this.phase === 'charge-fade') this.reset();
      else if (this.phase === 'detonating') {
        // Keep the pooled detonation alive at its last pose if the solid briefly
        // leaves the visible stage; its face groups still restore on completion.
        this._updateDetonation(dt);
      } else this.group.visible = false;
      return;
    }

    targetSolid.rootGroup.getWorldPosition(this._worldPosition);
    targetSolid.rootGroup.getWorldQuaternion(this._worldQuaternion);
    this.group.position.copy(this._worldPosition);
    this.group.quaternion.copy(this._worldQuaternion);

    if (this.phase === 'detonating') {
      this._updateDetonation(dt);
      return;
    }

    if (energy > 0.015) {
      this._contactAge = 0;
      if (this.phase !== 'charge-intro' && this.phase !== 'charging') {
        this.phase = 'charge-intro';
        this.chargeIntroElapsed = 0;
        this.chargeFadeElapsed = 0;
        this.group.visible = true;
        this.particles.visible = true;
        this.fragments.visible = true;
        this.shell.visible = true;
        this.rings.forEach(({ mesh }) => { mesh.visible = true; });
      }
      this.chargeIntroElapsed = Math.min(this.chargeIntroDuration, this.chargeIntroElapsed + dt);
      this._contactAge = 0;
      const introT = THREE.MathUtils.clamp(this.chargeIntroElapsed / this.chargeIntroDuration, 0, 1);
      const introAlpha = smooth01(introT);
      if (introT >= 1) this.phase = 'charging';
      this.group.visible = true;
      this._updateCharge(dt, energy, elapsed, introAlpha);
      return;
    }

    if (this.phase === 'charge-intro' || this.phase === 'charging') {
      this.phase = 'charge-fade';
      this.chargeFadeElapsed = 0;
      this.fadeEnergy = Math.max(this.energy, energy, 0.015);
    }
    if (this.phase === 'charge-fade') {
      this.chargeFadeElapsed = Math.min(this.chargeFadeDuration, this.chargeFadeElapsed + dt);
      const fadeT = THREE.MathUtils.clamp(this.chargeFadeElapsed / this.chargeFadeDuration, 0, 1);
      const fadeAlpha = 1 - smooth01(fadeT);
      this.group.visible = fadeAlpha > 0.002;
      if (fadeAlpha > 0.002) this._updateCharge(dt, this.fadeEnergy * fadeAlpha, elapsed, fadeAlpha);
      if (fadeT >= 1) this.reset();
      return;
    }

    if (this._contactActive && this.phase === 'idle') {
      this._contactAge += dt;
      const contactFade = 1 - smooth01(THREE.MathUtils.clamp(this._contactAge / 0.16, 0, 1));
      if (contactFade > 0.002) {
        this.group.visible = true;
        this._updateContactRing(0, contactFade, elapsed);
        return;
      }
      this.clearContact();
    }

    this.group.visible = false;
    this.phase = 'idle';
    this.energy = 0;
    this.flash = Math.max(0, this.flash - dt * 1.8);
  }

  shakeAmount() { return 0; }

  dispose() {
    this.reset();
    this.group.parent?.remove(this.group);
    this.particles.geometry.dispose();
    this.particleMat.dispose();
    this.fragmentGeo.dispose();
    this.fragmentMat.dispose();
    this.rings.forEach(({ material }) => material.dispose());
    this.rings[0]?.mesh.geometry.dispose();
    this.contactMaterial.dispose();
    this.shellGeo.dispose();
    this.shellMat.dispose();
  }
}
