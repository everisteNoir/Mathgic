import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createGlobalUniforms } from './Uniforms.js?v=5';
import { SolidMeshBuilder } from '../solids/SolidMeshBuilder.js?v=5';

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);

/**
 * Engine.js — 3D Graphics & Physics Interaction Core
 * Manages Scene, Camera, UnrealBloom post-processing, Vertex/Edge/Face Raycasting,
 * World-Space Trackball Quaternion Rotation (never inverts when tilted upside-down),
 * Stage Isolation (so hyper-spatial Mathgic portals never overlap the Platonic solid), and 60fps Loop.
 */
export class Engine {
  constructor(container, eventBus) {
    this.container = container;
    this.eventBus = eventBus;
    this.uniforms = createGlobalUniforms();
    this.builder = new SolidMeshBuilder(this.uniforms);

    this.activeSolid = null;
    this.spellLayer = new THREE.Group();
    this.spellLayer.name = 'SpellLayer';

    // Stage visibility controls (prevents overlapping with hyper-spatial Mathgic modules)
    this.manualSolidVisible = true;
    this.stageSolidVisible = true; // set by the active section: false in sections that must not show any polyhedron
    this.portalAutoHideCount = 0;

    // Inertial world-space angular velocity: x = yaw (World Y), y = pitch (World X)
    this.isDragging = false;
    this.isHolding = false;
    this.dragDistance = 0;
    this.prevPointer = new THREE.Vector2();
    this.pointerNDC = new THREE.Vector2(99, 99);
    this.angularVelocity = new THREE.Vector2(0.0045, 0.0);
    this.targetCameraQuat = null;
    this.cameraDistance = 3.6;
    this.targetCameraDistance = 3.6;

    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();

    this.hoveredObject = null;
    this.clock = new THREE.Clock();

    this._initScene();
    this._initEnvironment();
    this._initPostProcessing();
    this._initEvents();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#05060c', 0.06);

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.set(0, 0.25, this.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.container.appendChild(this.renderer.domElement);

    this.worldPivot = new THREE.Group();
    this.scene.add(this.worldPivot);
    this.worldPivot.add(this.spellLayer);

    this.raycaster = new THREE.Raycaster();
  }

  _initEnvironment() {
    const starCount = 950;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 14 + Math.random() * 28;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i * 3 + 2] = r * Math.cos(phi);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: '#cbd5e1',
      size: 0.06,
      transparent: true,
      opacity: 0.65
    });
    this.starField = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starField);

    this.gridHelper = new THREE.PolarGridHelper(4.5, 16, 8, 64, '#1e293b', '#0f172a');
    this.gridHelper.position.y = -1.65;
    this.scene.add(this.gridHelper);
  }

  _initPostProcessing() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.45, 0.22);
    this.composer.addPass(this.bloomPass);
  }

  /**
   * Rotates worldPivot in screen/world axes so dragging right ALWAYS turns the front face right
   * and dragging left ALWAYS turns the front face left, regardless of upside-down orientation.
   */
  _applyWorldRotation(yawDelta, pitchDelta) {
    if (yawDelta !== 0) {
      this._qYaw.setFromAxisAngle(WORLD_Y, yawDelta);
      this.worldPivot.quaternion.premultiply(this._qYaw);
    }
    if (pitchDelta !== 0) {
      this._qPitch.setFromAxisAngle(WORLD_X, pitchDelta);
      this.worldPivot.quaternion.premultiply(this._qPitch);
    }
    this.worldPivot.quaternion.normalize();
  }

  isSolidEffectivelyVisible() {
    return this.manualSolidVisible && this.stageSolidVisible && this.portalAutoHideCount === 0;
  }

  setManualSolidVisible(visible) {
    this.manualSolidVisible = visible;
    this._syncSolidVisibility();
  }

  setStageSolidVisible(visible) {
    this.stageSolidVisible = visible;
    this._syncSolidVisibility();
  }

  pushPortalIsolation() {
    this.portalAutoHideCount++;
    this._syncSolidVisibility();
  }

  popPortalIsolation() {
    this.portalAutoHideCount = Math.max(0, this.portalAutoHideCount - 1);
    this._syncSolidVisibility();
  }

  _syncSolidVisibility() {
    const vis = this.isSolidEffectivelyVisible();
    if (this.activeSolid) {
      this.activeSolid.rootGroup.visible = vis;
    }
    const id = this.activeSolid?.solidId;
    this.gridHelper.visible = vis && (id === 'cube' || id === 'dodecahedron');
    this.eventBus.emit('SOLID_VISIBILITY_CHANGED', {
      visible: vis,
      autoHidden: this.portalAutoHideCount > 0
    });
  }

  loadSolid(solidId) {
    if (this.activeSolid) {
      this.worldPivot.remove(this.activeSolid.rootGroup);
      this.activeSolid.dispose();
    }

    const built = this.builder.build(solidId);
    this.activeSolid = built;
    this.worldPivot.add(built.rootGroup);

    this.uniforms.uColorPrimary.value.set(built.meta.primaryColor);
    this.uniforms.uColorSecondary.value.set(built.meta.secondaryColor);
    this.uniforms.uColorTertiary.value.set(built.meta.tertiaryColor);
    this.uniforms.uEnergy.value = 0;
    built.setUnfold(this.uniforms.uUnfold.value);

    // Tetrahedron default pose: base face down, apex up
    if (solidId === 'tetrahedron') {
      this.targetCameraQuat = new THREE.Quaternion();
    }

    this._syncSolidVisibility();

    this.eventBus.emit('SOLID_CHANGED', {
      solidId,
      meta: built.meta,
      geoData: built.geoData
    });
  }

  setUnfold(value) {
    const prev = this.uniforms.uUnfold.value;
    this.uniforms.uUnfold.value = value;
    if (prev < 0.995 && value >= 0.995) this.triggerPulse(new THREE.Vector3(0, 0, 0));
    if (this.activeSolid) {
      this.activeSolid.setUnfold(value);
    }
    this.eventBus.emit('UNFOLD_CHANGED', { value });
  }

  triggerPulse(point = new THREE.Vector3(0, 0, 0)) {
    this.uniforms.uHitPoint.value.copy(point);
    this.uniforms.uPulseTime.value = this.uniforms.uTime.value;
    this.eventBus.emit('ELEMENT_PULSE', {
      solidId: this.activeSolid?.solidId,
      point
    });
  }

  _initEvents() {
    const dom = this.renderer.domElement;

    const getCoords = (e) => {
      if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
      return { x: e.clientX, y: e.clientY };
    };

    const onDown = (e) => {
      const { x, y } = getCoords(e);
      this.isDragging = true;
      this.isHolding = true;
      this.dragDistance = 0;
      this.prevPointer.set(x, y);
      this.targetCameraQuat = null;
    };

    const onMove = (e) => {
      const { x, y } = getCoords(e);
      const rect = dom.getBoundingClientRect();
      this.pointerNDC.x = ((x - rect.left) / rect.width) * 2 - 1;
      this.pointerNDC.y = -((y - rect.top) / rect.height) * 2 + 1;

      if (this.isDragging) {
        const dx = x - this.prevPointer.x;
        const dy = y - this.prevPointer.y;
        this.dragDistance += Math.hypot(dx, dy);

        const yawVel = dx * 0.006;
        const pitchVel = dy * 0.006;

        this.angularVelocity.set(yawVel, pitchVel);
        this._applyWorldRotation(yawVel, pitchVel);
        this.prevPointer.set(x, y);
      } else {
        this._performRaycastHover();
      }
    };

    const onUp = () => {
      if (this.isDragging && this.dragDistance < 6) {
        this._performRaycastClick();
      }
      this.isDragging = false;
      this.isHolding = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      this.targetCameraDistance = THREE.MathUtils.clamp(
        this.targetCameraDistance + e.deltaY * 0.0022,
        1.35,
        6.8
      );
    };

    const onDblClick = () => {
      this.triggerPulse(new THREE.Vector3(0, 0, 0));
    };

    dom.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    dom.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);

    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('dblclick', onDblClick);

    window.addEventListener('resize', () => {
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    });
  }

  _performRaycastHover() {
    if (!this.activeSolid || !this.activeSolid.rootGroup.visible) return;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);

    const targets = [
      ...this.activeSolid.vertexSpheres,
      ...this.activeSolid.edgeMeshes,
      ...this.activeSolid.faceMeshes
    ];
    const hits = this.raycaster.intersectObjects(targets, false);

    if (this.hoveredObject) {
      if (this.hoveredObject.userData.interactType === 'vertex') {
        this.hoveredObject.scale.setScalar(1);
      } else if (this.hoveredObject.userData.interactType === 'edge') {
        this.hoveredObject.scale.set(1, 1, 1);
        this.hoveredObject.userData.strutMat.uniforms.uHoverBoost.value = 0.0;
      }
      this.hoveredObject = null;
    }

    if (hits.length > 0) {
      const hit = hits[0];
      const obj = hit.object;
      this.hoveredObject = obj;
      this.uniforms.uPointer3D.value.copy(hit.point);

      const type = obj.userData.interactType;
      if (type === 'vertex') {
        obj.scale.setScalar(1.9);
        this.eventBus.emit('VERTEX_HOVER', {
          vertexIndex: obj.userData.vertexIndex,
          coords: obj.userData.coords
        });
      } else if (type === 'edge') {
        obj.scale.set(1.65, 1, 1.65);
        obj.userData.strutMat.uniforms.uHoverBoost.value = 1.0;
        this.eventBus.emit('EDGE_HOVER', {
          edgeVertices: obj.userData.edgeVertices
        });
      } else if (type === 'face') {
        this.eventBus.emit('FACE_HOVER', {
          faceIndex: obj.userData.faceIndex,
          point: hit.point
        });
      }
    } else {
      this.eventBus.emit('HOVER_CLEAR');
    }
  }

  _performRaycastClick() {
    if (!this.activeSolid || !this.activeSolid.rootGroup.visible) return;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const hits = this.raycaster.intersectObjects(this.activeSolid.faceMeshes, false);

    if (hits.length > 0) {
      const hit = hits[0];
      const faceMesh = hit.object;

      const localHit = this.activeSolid.rootGroup.worldToLocal(hit.point.clone());
      this.triggerPulse(localHit);

      const worldNormal = faceMesh.userData.localNormal
        .clone()
        .applyQuaternion(faceMesh.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();

      const camDir = this.camera.position.clone().normalize();
      const alignQuat = new THREE.Quaternion().setFromUnitVectors(worldNormal, camDir);
      this.targetCameraQuat = alignQuat.multiply(this.worldPivot.quaternion.clone());

      this.eventBus.emit('FACE_CLICK', {
        faceIndex: faceMesh.userData.faceIndex,
        point: hit.point
      });
    }
  }

  start() {
    const animate = () => {
      requestAnimationFrame(animate);

      const delta = Math.min(this.clock.getDelta(), 0.05);
      const elapsed = this.clock.getElapsedTime();

      this.uniforms.uTime.value = elapsed;
      this.uniforms.uDelta.value = delta;

      if (this.isHolding && this.dragDistance < 10) {
        this.uniforms.uEnergy.value = Math.min(1.0, this.uniforms.uEnergy.value + delta * 0.85);
      } else {
        this.uniforms.uEnergy.value = Math.max(0.0, this.uniforms.uEnergy.value - delta * 1.1);
      }
      this.eventBus.emit('ENERGY_UPDATE', { energy: this.uniforms.uEnergy.value });

      if (this.activeSolid) {
        const meta = this.activeSolid.meta;

        if (this.targetCameraQuat) {
          this.worldPivot.quaternion.slerp(this.targetCameraQuat, 0.08);
          if (this.worldPivot.quaternion.angleTo(this.targetCameraQuat) < 0.01) {
            this.targetCameraQuat = null;
          }
        } else if (!this.isDragging) {
          this._applyWorldRotation(this.angularVelocity.x, this.angularVelocity.y);

          const idleDir = this.angularVelocity.x < 0 ? -1 : 1;
          this.angularVelocity.multiplyScalar(meta.damping);
          if (Math.abs(this.angularVelocity.x) < 0.0025) {
            this.angularVelocity.x = 0.0025 * idleDir;
          }
        }

        this.activeSolid.rootGroup.position.y = Math.sin(elapsed * meta.floatSpeed) * meta.floatAmp;
        this.activeSolid.updateUpright();

        if (this.activeSolid.solidId === 'octahedron' && this.pointerNDC.x <= 1) {
          this.activeSolid.rootGroup.rotation.z = THREE.MathUtils.lerp(
            this.activeSolid.rootGroup.rotation.z,
            -this.pointerNDC.x * 0.25,
            0.05
          );
        } else {
          this.activeSolid.rootGroup.rotation.z = THREE.MathUtils.lerp(
            this.activeSolid.rootGroup.rotation.z,
            0,
            0.08
          );
        }

        // Animate interior elemental core
        if (this.activeSolid.coreAnimator) {
          this.activeSolid.coreAnimator(elapsed, this.uniforms.uEnergy.value);
        }

        // Ambient particle dynamics
        const posAttr = this.activeSolid.particles.geometry.attributes.position;
        const seeds = this.activeSolid.particleSeeds;
        const unfoldK = this.uniforms.uUnfold.value;
        const speedBoost = 1 + this.uniforms.uEnergy.value * 4.0 + unfoldK * 5.0;
        const emberTop = 0.95 + unfoldK * 1.6; // embers of the Fire core rise higher as the net opens
        for (let i = 0; i < seeds.length; i++) {
          if (this.activeSolid.solidId === 'tetrahedron') {
            posAttr.array[i * 3 + 1] += delta * 0.55 * speedBoost;
            if (posAttr.array[i * 3 + 1] > emberTop) posAttr.array[i * 3 + 1] = -0.3;
          } else {
            const x = posAttr.array[i * 3];
            const z = posAttr.array[i * 3 + 2];
            const ang = delta * 0.28 * speedBoost;
            posAttr.array[i * 3] = x * Math.cos(ang) - z * Math.sin(ang);
            posAttr.array[i * 3 + 2] = x * Math.sin(ang) + z * Math.cos(ang);
          }
        }
        posAttr.needsUpdate = true;
      }

      this.cameraDistance = THREE.MathUtils.lerp(this.cameraDistance, this.targetCameraDistance, 0.1);
      this.camera.position.z = this.cameraDistance;

      this.starField.rotation.y = elapsed * 0.015;

      this.eventBus.emit('TICK', { elapsed, delta });

      this.composer.render();
    };

    animate();
  }
}
