import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createGlobalUniforms } from './Uniforms.js';
import { SolidMeshBuilder } from '../solids/SolidMeshBuilder.js';

/**
 * Engine.js — 3D Graphics & Physics Interaction Core
 * Manages Scene, Camera, UnrealBloom post-processing, Vertex/Edge/Face Raycasting, and 60fps Loop.
 */
export class Engine {
  constructor(container, eventBus) {
    this.container = container;
    this.eventBus = eventBus;
    this.uniforms = createGlobalUniforms();
    this.builder = new SolidMeshBuilder(this.uniforms);

    this.activeSolid = null;
    this.spellLayer = new THREE.Group(); // Dedicated layer for Mathematical Spell Plugins
    this.spellLayer.name = 'SpellLayer';

    // Inertial rotation state
    this.isDragging = false;
    this.isHolding = false;
    this.dragDistance = 0;
    this.prevPointer = new THREE.Vector2();
    this.pointerNDC = new THREE.Vector2(99, 99);
    this.angularVelocity = new THREE.Vector2(0.004, 0.006);
    this.targetCameraQuat = null;
    this.cameraDistance = 3.6;
    this.targetCameraDistance = 3.6;

    this.hoveredObject = null;
    this.clock = new THREE.Clock();

    this._initScene();
    this._initEnvironment();
    this._initPostProcessing();
    this._initEvents();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#05060c', 0.065);

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    this.camera.position.set(0, 0.25, this.cameraDistance);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // Central pivot holding both the active solid and active spells
    this.worldPivot = new THREE.Group();
    this.scene.add(this.worldPivot);
    this.worldPivot.add(this.spellLayer);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.06;
  }

  _initEnvironment() {
    // Deep astral starfield background
    const starCount = 900;
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

    // Polar seismic / celestial grid underneath
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

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.72, 0.45, 0.25);
    this.composer.addPass(this.bloomPass);
  }

  loadSolid(solidId) {
    if (this.activeSolid) {
      this.worldPivot.remove(this.activeSolid.rootGroup);
      this.activeSolid.dispose();
    }

    const built = this.builder.build(solidId);
    this.activeSolid = built;
    this.worldPivot.add(built.rootGroup);

    // Update global shader colors & unfolding state
    this.uniforms.uColorPrimary.value.set(built.meta.primaryColor);
    this.uniforms.uColorSecondary.value.set(built.meta.secondaryColor);
    this.uniforms.uEnergy.value = 0;
    built.setUnfold(this.uniforms.uUnfold.value);

    // Show polar grid for Earth and Aether
    this.gridHelper.visible = solidId === 'cube' || solidId === 'dodecahedron';

    this.eventBus.emit('SOLID_CHANGED', {
      solidId,
      meta: built.meta,
      geoData: built.geoData
    });
  }

  setUnfold(value) {
    this.uniforms.uUnfold.value = value;
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
      this.targetCameraQuat = null; // Cancel auto-alignment if user manually drags
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

        this.angularVelocity.x = dy * 0.0055;
        this.angularVelocity.y = dx * 0.0055;

        this.worldPivot.rotation.y += this.angularVelocity.y;
        this.worldPivot.rotation.x += this.angularVelocity.x;
        this.prevPointer.set(x, y);
      } else {
        this._performRaycastHover();
      }
    };

    const onUp = () => {
      if (this.isDragging && this.dragDistance < 6) {
        // Treat short tap/click as face selection & surface ripple
        this._performRaycastClick();
      }
      this.isDragging = false;
      this.isHolding = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      this.targetCameraDistance = THREE.MathUtils.clamp(
        this.targetCameraDistance + e.deltaY * 0.0022,
        1.35, // Allows zooming inside the Aether Dodecahedron
        6.5
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
    if (!this.activeSolid) return;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);

    // Priority order: Vertices -> Edges -> Faces
    const targets = [
      ...this.activeSolid.vertexSpheres,
      ...this.activeSolid.edgeLines,
      ...this.activeSolid.faceMeshes
    ];
    const hits = this.raycaster.intersectObjects(targets, false);

    // Reset previous hover highlight
    if (this.hoveredObject) {
      if (this.hoveredObject.userData.interactType === 'vertex') {
        this.hoveredObject.scale.setScalar(1);
      } else if (this.hoveredObject.userData.interactType === 'edge') {
        this.hoveredObject.material.opacity = this.hoveredObject.userData.baseOpacity;
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
        obj.scale.setScalar(1.85);
        this.eventBus.emit('VERTEX_HOVER', {
          vertexIndex: obj.userData.vertexIndex,
          coords: obj.userData.coords
        });
      } else if (type === 'edge') {
        obj.material.opacity = 1.0;
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
    if (!this.activeSolid) return;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const hits = this.raycaster.intersectObjects(this.activeSolid.faceMeshes, false);

    if (hits.length > 0) {
      const hit = hits[0];
      const faceMesh = hit.object;

      // Transform hit point to solid-local space for accurate shader ripple origin
      const localHit = this.activeSolid.rootGroup.worldToLocal(hit.point.clone());
      this.triggerPulse(localHit);

      // Compute current world normal of clicked face to align directly toward camera
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

      // Accumulate elemental energy while user holds pointer down
      if (this.isHolding && this.dragDistance < 10) {
        this.uniforms.uEnergy.value = Math.min(1.0, this.uniforms.uEnergy.value + delta * 0.85);
      } else {
        this.uniforms.uEnergy.value = Math.max(0.0, this.uniforms.uEnergy.value - delta * 1.1);
      }
      this.eventBus.emit('ENERGY_UPDATE', { energy: this.uniforms.uEnergy.value });

      // Update elemental physics & motion
      if (this.activeSolid) {
        const meta = this.activeSolid.meta;

        if (this.targetCameraQuat) {
          this.worldPivot.quaternion.slerp(this.targetCameraQuat, 0.08);
          if (this.worldPivot.quaternion.angleTo(this.targetCameraQuat) < 0.01) {
            this.targetCameraQuat = null;
          }
        } else if (!this.isDragging) {
          this.worldPivot.rotation.y += this.angularVelocity.y;
          this.worldPivot.rotation.x += this.angularVelocity.x;

          // Element-specific angular damping (Earth heavy, Air light)
          this.angularVelocity.multiplyScalar(meta.damping);
          if (this.angularVelocity.length() < 0.0025) {
            this.angularVelocity.y = 0.0025;
          }
        }

        // Characteristic levitation wave
        this.activeSolid.rootGroup.position.y = Math.sin(elapsed * meta.floatSpeed) * meta.floatAmp;

        // Air: Tilt gently in response to cursor wind stream
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

        // Aether: Counter-rotate inner celestial wireframe core
        if (this.activeSolid.innerCore) {
          this.activeSolid.innerCore.rotation.y = -elapsed * 0.45;
          this.activeSolid.innerCore.rotation.x = elapsed * 0.25;
        }

        // Ambient particle dynamics
        const posAttr = this.activeSolid.particles.geometry.attributes.position;
        const seeds = this.activeSolid.particleSeeds;
        const speedBoost = 1 + this.uniforms.uEnergy.value * 4.0;
        for (let i = 0; i < seeds.length; i++) {
          if (this.activeSolid.solidId === 'tetrahedron') {
            // Rising fire embers
            posAttr.array[i * 3 + 1] += delta * 0.45 * speedBoost;
            if (posAttr.array[i * 3 + 1] > 1.8) posAttr.array[i * 3 + 1] = -1.4;
          } else {
            // Orbital drift
            const x = posAttr.array[i * 3];
            const z = posAttr.array[i * 3 + 2];
            const ang = delta * 0.25 * speedBoost;
            posAttr.array[i * 3] = x * Math.cos(ang) - z * Math.sin(ang);
            posAttr.array[i * 3 + 2] = x * Math.sin(ang) + z * Math.cos(ang);
          }
        }
        posAttr.needsUpdate = true;
      }

      // Smooth camera zoom
      this.cameraDistance = THREE.MathUtils.lerp(this.cameraDistance, this.targetCameraDistance, 0.1);
      this.camera.position.z = this.cameraDistance;

      // Slow celestial background rotation
      this.starField.rotation.y = elapsed * 0.015;

      // Notify active Mathematical Spell Plugins every frame
      this.eventBus.emit('TICK', { elapsed, delta });

      this.composer.render();
    };

    animate();
  }
}
