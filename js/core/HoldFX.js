import * as THREE from 'three';

const SIDES = { tetrahedron: 3, cube: 4, octahedron: 3, icosahedron: 3, dodecahedron: 5 };
// Per-element release burst: initial speed, gravity (+ up / - down), swirl around Y, particle size
const BURST = {
  tetrahedron: { speed: 1.7, gravity: 1.6, swirl: 0.0, size: 0.07, up: true },
  cube: { speed: 1.5, gravity: -2.6, swirl: 0.0, size: 0.075 },
  octahedron: { speed: 1.2, gravity: 0.0, swirl: 4.5, size: 0.05 },
  icosahedron: { speed: 1.7, gravity: -3.4, swirl: 0.0, size: 0.06 },
  dodecahedron: { speed: 1.1, gravity: 0.0, swirl: 1.4, size: 0.08 }
};
const MOTES = 90;
const SPARKS = 150;

/**
 * HoldFX.js — world-fixed visual effects for press-and-hold interaction.
 * While charging: motes stream inward, spinning rune rings tighten around the solid.
 * On release (if charged): shockwave ring + element-specific burst + glow flash + camera shake.
 * Lives in the scene (not the rotating world pivot), so it never turns with the solid.
 */
export class HoldFX {
  constructor(scene, camera) {
    this.camera = camera;
    this.flash = 0;
    this.shakeImpulse = 0;
    this.cfg = BURST.tetrahedron;
    this.palette = [new THREE.Color('#fff'), new THREE.Color('#fff'), new THREE.Color('#fff')];

    this.group = new THREE.Group();
    this.group.name = 'HoldFX';
    scene.add(this.group);

    // --- Inward-streaming motes ---
    this.moteSeeds = Array.from({ length: MOTES }, () => ({
      theta: Math.random() * Math.PI * 2,
      phi: Math.acos(2 * Math.random() - 1),
      phase: Math.random(),
      speed: 0.7 + Math.random() * 0.8
    }));
    this.motePos = new Float32Array(MOTES * 3);
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3));
    this.moteMat = new THREE.PointsMaterial({
      size: 0.05,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.motes = new THREE.Points(moteGeo, this.moteMat);
    this.group.add(this.motes);

    // --- Rune rings: three tilted polygon rings that spin up and tighten as charge builds ---
    this.rings = [];
    [[Math.PI / 2, 0], [Math.PI / 3, 0.9], [-Math.PI / 3, -0.9]].forEach(([tilt, yaw], i) => {
      const holder = new THREE.Group();
      holder.rotation.set(tilt, yaw, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: '#fff',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 3, 1), mat);
      holder.add(mesh);
      this.group.add(holder);
      this.rings.push({ holder, mesh, mat, dir: i % 2 ? -1 : 1 });
    });

    // --- Release burst particles ---
    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkCol = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkBase = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkMat = new THREE.PointsMaterial({
      size: 0.07,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.sparks = new THREE.Points(sGeo, this.sparkMat);
    this.sparks.visible = false;
    this.group.add(this.sparks);

    // --- Shockwave ring (billboard facing the camera) ---
    this.waveMat = new THREE.MeshBasicMaterial({
      color: '#fff',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.wave = new THREE.Mesh(new THREE.RingGeometry(0.93, 1.0, 64), this.waveMat);
    this.wave.visible = false;
    this.waveT = 1;
    this.group.add(this.wave);
  }

  setElement(meta, solidId) {
    this.cfg = BURST[solidId] || BURST.tetrahedron;
    this.palette = [meta.primaryColor, meta.secondaryColor, meta.tertiaryColor].map((c) => new THREE.Color(c));
    this.moteMat.color.set(meta.tertiaryColor);
    this.waveMat.color.set(meta.secondaryColor);
    this.sparkMat.size = this.cfg.size;
    this.rings.forEach((r, i) => {
      r.mesh.geometry.dispose();
      r.mesh.geometry = new THREE.RingGeometry(0.97, i === 0 ? 1.0 : 0.995, SIDES[solidId] || 3, 1);
      r.mat.color.set(i === 0 ? meta.tertiaryColor : meta.secondaryColor);
    });
  }

  /** Fully charged release: shockwave + element burst + flash + shake. */
  burst(energy) {
    const cfg = this.cfg;
    for (let i = 0; i < SPARKS; i++) {
      const theta = Math.random() * Math.PI * 2;
      let y = Math.random() * 2 - 1;
      if (cfg.up) y = 0.2 + Math.random() * 0.8; // flame erupts upward
      const r = Math.sqrt(1 - y * y);
      const sp = cfg.speed * (0.45 + Math.random() * 0.9) * (0.6 + energy * 0.7);
      this.sparkVel.set([Math.cos(theta) * r * sp, y * sp, Math.sin(theta) * r * sp], i * 3);
      this.sparkPos.set([0, 0, 0], i * 3);
      this.sparkBase.set(this.palette[i % 3].toArray(), i * 3);
      this.sparkLife[i] = 0.6 + Math.random() * 0.6;
    }
    this.sparks.visible = true;
    this.wave.visible = true;
    this.waveT = 0;
    this.flash = 1;
    this.shakeImpulse = 0.045 * energy;
  }

  update(dt, energy, solid, elapsed) {
    const vis = !!(solid && solid.rootGroup.visible);
    this.group.visible = vis;
    if (!vis) {
      this.flash = 0;
      return;
    }
    this.group.position.y = solid.rootGroup.position.y;

    // Charging motes + rune rings
    const on = energy > 0.02;
    this.motes.visible = on;
    this.moteMat.opacity = Math.min(1, energy * 1.6);
    if (on) {
      for (let i = 0; i < MOTES; i++) {
        const m = this.moteSeeds[i];
        m.phase = (m.phase + dt * m.speed * (0.25 + energy * 1.3)) % 1;
        const t = m.phase;
        const r = 0.12 + 2.3 * (1 - t * t);
        const a = m.theta + t * 5.0;
        this.motePos[i * 3] = r * Math.sin(m.phi) * Math.cos(a);
        this.motePos[i * 3 + 1] = r * Math.cos(m.phi);
        this.motePos[i * 3 + 2] = r * Math.sin(m.phi) * Math.sin(a);
      }
      this.motes.geometry.attributes.position.needsUpdate = true;
    }
    this.rings.forEach((ring, i) => {
      ring.holder.visible = on;
      if (!on) return;
      ring.mat.opacity = Math.min(0.9, energy * 1.2) * (i === 0 ? 1 : 0.75);
      ring.holder.scale.setScalar(1.75 - energy * 0.55 + i * 0.1);
      ring.mesh.rotation.z += ring.dir * dt * (0.8 + energy * 9.0);
    });

    // Release burst
    if (this.sparks.visible) {
      const cfg = this.cfg;
      let alive = 0;
      for (let i = 0; i < SPARKS; i++) {
        const life = this.sparkLife[i];
        if (life <= 0) {
          this.sparkCol.fill(0, i * 3, i * 3 + 3);
          continue;
        }
        alive++;
        this.sparkLife[i] = life - dt;
        const o = i * 3;
        this.sparkVel[o + 1] += cfg.gravity * dt;
        if (cfg.swirl) {
          const vx = this.sparkVel[o];
          const vz = this.sparkVel[o + 2];
          const c = Math.cos(cfg.swirl * dt);
          const s = Math.sin(cfg.swirl * dt);
          this.sparkVel[o] = vx * c - vz * s;
          this.sparkVel[o + 2] = vx * s + vz * c;
        }
        this.sparkPos[o] += this.sparkVel[o] * dt;
        this.sparkPos[o + 1] += this.sparkVel[o + 1] * dt;
        this.sparkPos[o + 2] += this.sparkVel[o + 2] * dt;
        const f = Math.min(1, this.sparkLife[i] * 1.6);
        for (let c = 0; c < 3; c++) this.sparkCol[o + c] = this.sparkBase[o + c] * f;
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.color.needsUpdate = true;
      if (alive === 0) this.sparks.visible = false;
    }

    // Shockwave
    if (this.wave.visible) {
      this.waveT += dt / 0.85;
      const p = Math.min(1, this.waveT);
      this.wave.quaternion.copy(this.camera.quaternion);
      this.wave.scale.setScalar(0.5 + p * 4.2);
      this.waveMat.opacity = Math.pow(1 - p, 2) * 0.9;
      if (p >= 1) this.wave.visible = false;
    }

    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.shakeImpulse = Math.max(0, this.shakeImpulse - dt * 0.12);
  }

  /** Camera shake amplitude for the current frame. */
  shakeAmount(energy) {
    return energy * energy * 0.006 + this.shakeImpulse;
  }
}
