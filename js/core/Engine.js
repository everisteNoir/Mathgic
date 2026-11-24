import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createGlobalUniforms } from './Uniforms.js?v=23';
import { HoldFX } from './HoldFX.js?v=23';
import { fxState } from './FXState.js?v=23';
import { SolidMeshBuilder } from '../solids/SolidMeshBuilder.js?v=23';

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
    this.retiringSolids = [];
    // Keep a small LRU cache of recently used Polyhedra meshes. Topology is
    // cached separately; this avoids rebuilding GPU buffers on quick chapter hops.
    this.solidCache = new Map();
    // One active solid plus four warm inactive solids covers the complete
    // Polyhedra chapter. Models are prepared during idle time, not on click.
    this.solidCacheLimit = 4;
    this._solidPrewarmQueue = [];
    this._solidPrewarmScheduled = false;
    this._solidPrewarmed = new Set();
    this._solidPrewarmHandle = null;
    this._solidPrewarmTimer = null;
    this.spellLayer = new THREE.Group();
    this.spellLayer.name = 'SpellLayer';

    // Stage visibility controls (prevents overlapping with hyper-spatial Mathgic modules)
    this.manualSolidVisible = true;
    this.stageSolidVisible = true; // set by the active section: false in sections that must not show any polyhedron
    this.portalAutoHideCount = 0;
    this.solidPresence = 1; // 0..1: the solid materializes / dissolves smoothly when sections change
    this._simple = false; // true while the core uses the plain shrink (FX off)
    this._viewK = 0;
    this._zoom = 1; // camera pull-back while the book is open
    this._zoomTarget = 1;
    this._homeStagePosition = new THREE.Vector3();

    // Inertial world-space angular velocity: x = yaw (World Y), y = pitch (World X)
    this.isDragging = false;
    this.isHolding = false;
    this.holdInteractionEnabled = false;
    this.detonationActive = false;
    this.book = null;
    // Camera-relative stage anchor: when the book is open, all interactive solids
    // and spell objects hover just above its page spread as one coherent 3D layer.
    this.floatingStageTarget = new THREE.Vector3();
    this.floatingStageEnabled = false;
    this.explorationVisible = false;
    this.focusMode = null;
    this.focusBlend = 0;
    this._focusCameraPosition = new THREE.Vector3();
    this._focusCameraTarget = new THREE.Vector3();
    this._focusNormalPosition = new THREE.Vector3();
    this._focusNormalTarget = new THREE.Vector3();
    this._cameraPositionTarget = new THREE.Vector3();
    this._cameraTargetTarget = new THREE.Vector3();
    this._bookAimPoint = new THREE.Vector3();
    this._bookCameraOffset = new THREE.Vector3();
    this._focusRestoreQuaternion = null;
    this.dragDistance = 0;
    this.prevPointer = new THREE.Vector2();
    this.pointerNDC = new THREE.Vector2(99, 99);
    this._pendingClickTimer = null;
    this.angularVelocity = new THREE.Vector2(0.0045, 0.0);
    this.targetCameraQuat = null;
    this.cameraDistance = 3.6;
    this.targetCameraDistance = 3.6;
    this.bookCameraMode = 'sealed';
    this._cameraUp = new THREE.Vector3(0, 1, 0);
    this._cameraUpTarget = new THREE.Vector3(0, 0, -1);
    this._bookCameraPosition = new THREE.Vector3(0, 6.8, 0.01);
    this._bookCameraLookAt = new THREE.Vector3(0, 0, 0);
    this._bookRigTarget = new THREE.Vector3(0, 0, 0);

    this._levelQuat = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();

    this.hoveredObject = null;
    this.hoveredInstance = null;
    this._lastHoverRaycastAt = 0;
    this._energyEventAccumulator = 0;
    this._lastEnergyEventValue = -1;
    this._solidIntro = null;
    this.solidTransitionActive = false;
    this._resumeHoldAfterTransition = false;
    this.clock = new THREE.Clock();

    this._initScene();
    this._focusNormalPosition.copy(this.camera.position);
    this._cameraPositionTarget.copy(this.camera.position);
    this._focusNormalTarget.set(0, 0, 0);
    this._cameraTargetTarget.set(0, 0, 0);
    this._initEnvironment();
    this._initPostProcessing();
    this.holdFX = new HoldFX(this.scene, this.camera);
    this._initEvents();
    this._initPerformanceDiagnostics();
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
    const constrainedDevice = (navigator.deviceMemory && navigator.deviceMemory <= 4)
      || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    this._basePixelRatio = Math.min(window.devicePixelRatio || 1, constrainedDevice ? 1.4 : 1.7);
    // Polyhedra has the heaviest vertex/fragment workload. A small, chapter-local
    // render-scale reduction gives bloom and transparency more GPU headroom.
    this._polyhedraPixelRatio = Math.max(1, this._basePixelRatio * (constrainedDevice ? 0.82 : 0.86));
    this._currentPixelRatio = this._basePixelRatio;
    this.renderer.setPixelRatio(this._basePixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.container.appendChild(this.renderer.domElement);

    this.worldPivot = new THREE.Group();
    this.worldPivot.visible = false; // the closed-grimoire landing state shows no mathematical models
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
  }

  _initPostProcessing() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // A softer baseline bloom costs less bandwidth; elemental effects raise it only while active.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.38, 0.28);
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

  /** Register the Grimoire in this scene; the Engine remains the sole renderer. */
  attachBook(book) {
    this.book = book;
    if (book?.bookGroup && book.bookGroup.parent !== this.scene) this.scene.add(book.bookGroup);
    book?.updateAnchor?.();
  }

  /** Place the complete interactive world above the open book without moving the book itself. */
  setFloatingStageAnchor(worldPosition) {
    if (!worldPosition) {
      this.floatingStageEnabled = false;
      return;
    }
    this.floatingStageTarget.copy(worldPosition);
    this.floatingStageEnabled = true;
  }

  /** Keep the launch view clean; CHAPTER EXPLORATION is shown only after the tome opens. */
  setExplorationVisible(visible) {
    this.explorationVisible = !!visible;
    this.worldPivot.visible = this.explorationVisible;
  }

  _interactiveRoots() {
    const roots = [];
    if (this.activeSolid?.rootGroup?.visible) roots.push(this.activeSolid.rootGroup);
    for (const child of this.spellLayer.children) {
      if (child.visible && child.children.length) roots.push(child);
    }
    return roots;
  }

  _clearHoveredInteraction() {
    if (this.hoveredInstance) {
      const { solid, object, instanceId, data } = this.hoveredInstance;
      if (solid?.setInstanceHighlight && Number.isInteger(instanceId)) {
        solid.setInstanceHighlight(object, instanceId, false);
      } else if (object?.userData?.interactType === 'vertex') {
        object.scale.setScalar(1);
      } else if (object?.userData?.interactType === 'edge') {
        object.scale.set(1, 1, 1);
        object.userData.strutMat?.uniforms?.uHoverBoost && (object.userData.strutMat.uniforms.uHoverBoost.value = 0);
      }
      this.hoveredInstance = null;
    } else if (this.hoveredObject) {
      if (this.hoveredObject.userData.interactType === 'vertex') this.hoveredObject.scale.setScalar(1);
      else if (this.hoveredObject.userData.interactType === 'edge') {
        this.hoveredObject.scale.set(1, 1, 1);
        if (this.hoveredObject.userData.strutMat?.uniforms?.uHoverBoost) this.hoveredObject.userData.strutMat.uniforms.uHoverBoost.value = 0;
      }
    }
    this.hoveredObject = null;
  }

  _rootForInteractiveHit(object) {
    let node = object;
    while (node?.parent && node.parent !== this.spellLayer && node.parent !== this.worldPivot) {
      node = node.parent;
    }
    if (!node || node === this.spellLayer || node === this.worldPivot) return null;
    return node;
  }

  /** Double-click enters a temporary, isolated view without changing chapter state or controls. */
  enterFocusModeFromPointer() {
    if (this.focusMode?.active || !this.explorationVisible) return false;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const roots = this._interactiveRoots();
    if (!roots.length) return false;

    this.worldPivot.updateMatrixWorld(true);
    const hits = this.raycaster.intersectObjects(roots, true);
    const hit = hits.find((item) => item.object?.visible !== false);
    if (!hit) return false;

    const root = this._rootForInteractiveHit(hit.object);
    if (!root) return false;

    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    root.traverse((object) => {
      if (!object.visible || object.userData?.excludeFromFocusBounds || object.isPoints) return;
      if (!object.isMesh && !object.isLine && !object.isLineSegments) return;
      if (!object.geometry) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) return;
      const worldBox = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      bounds.union(worldBox);
    });
    if (bounds.isEmpty()) bounds.setFromObject(root);
    if (bounds.isEmpty()) return false;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(0.18, sphere.radius);
    const localCenter = root.worldToLocal(sphere.center.clone());
    const direction = this.camera.position.clone().sub(sphere.center).normalize();
    if (!Number.isFinite(direction.length()) || direction.lengthSq() < 0.5) direction.set(0, 0, 1);

    const verticalHalfFov = THREE.MathUtils.degToRad(this.camera.fov) * 0.5;
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(0.25, this.camera.aspect));
    const limitingHalfFov = Math.max(0.08, Math.min(verticalHalfFov, horizontalHalfFov));
    // Fit the complete selected model to about 88% of the limiting viewport axis.
    // This is intentionally closer than the previous 1.26/sin fit, which left
    // small and medium models looking almost unchanged after entering Focus Mode.
    const distance = THREE.MathUtils.clamp(
      radius / (Math.sin(limitingHalfFov) * 0.88),
      Math.max(0.55, radius * 1.08),
      Math.max(12, radius * 9)
    );
    this._focusRestoreQuaternion = this.worldPivot.quaternion.clone();
    this.targetCameraQuat = null;
    this.isDragging = false;
    this.isHolding = false;
    this.angularVelocity.set(0, 0);
    this.uniforms.uEnergy.value = 0;
    this.holdFX?.reset?.();

    // Isolate the selected object while preserving every sibling's exact prior
    // visibility so Focus Mode can return to the unchanged chapter composition.
    const hiddenRoots = roots
      .filter((candidate) => candidate !== root)
      .map((candidate) => ({ root: candidate, visible: candidate.visible }));
    hiddenRoots.forEach(({ root: candidate }) => { candidate.visible = false; });

    this.focusMode = {
      active: true,
      root,
      localCenter,
      direction,
      radius,
      distance,
      target: sphere.center.clone(),
      hiddenRoots
    };
    this.book?.setFocusHidden?.(true);
    document.body.classList.add('focus-mode');
    this.eventBus.emit('FOCUS_MODE_CHANGED', { active: true, object: root.name || hit.object.name || 'object' });
    return true;
  }

  isFocusMode() { return !!this.focusMode; }

  exitFocusMode() {
    if (!this.focusMode?.active) return false;
    if (this._pendingClickTimer) { clearTimeout(this._pendingClickTimer); this._pendingClickTimer = null; }
    this.focusMode.active = false;
    // The focused inspection is temporary: restore the chapter-exploration object pose.
    if (this._focusRestoreQuaternion) {
      this.worldPivot.quaternion.copy(this._focusRestoreQuaternion);
      this._focusRestoreQuaternion = null;
    }
    this.angularVelocity.set(0, 0);
    this.targetCameraQuat = null;
    this.eventBus.emit('FOCUS_MODE_CHANGED', { active: false });
    return true;
  }

  _finishFocusExit() {
    const hiddenRoots = this.focusMode?.hiddenRoots || [];
    hiddenRoots.forEach(({ root, visible }) => {
      if (root?.parent) root.visible = visible;
    });
    this.focusMode = null;
    this.focusBlend = 0;
    this.book?.setFocusHidden?.(false);
    this.book?.updateAnchor?.();
    document.body.classList.remove('focus-mode');
  }

  _applyRenderPixelRatio(ratio) {
    const next = THREE.MathUtils.clamp(ratio, 1, this._basePixelRatio);
    if (Math.abs(next - this._currentPixelRatio) < 0.015) return;
    this._currentPixelRatio = next;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(next);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio?.(next);
    this.composer.setSize(width, height);
  }

  /** Hold-to-charge is a Polyhedra-only interaction. */
  setHoldInteractionEnabled(enabled) {
    const next = !!enabled;
    if (this.holdInteractionEnabled === next) {
      // A chapter can be left while a solid transition temporarily disabled the
      // hold flag. Still cancel any idle prewarm that belongs to Polyhedra.
      if (!next) {
        this._resumeHoldAfterTransition = false;
        this._cancelPolyhedraPrewarm(true);
      }
      return;
    }
    this.holdInteractionEnabled = next;
    this._applyRenderPixelRatio(next ? this._polyhedraPixelRatio : this._basePixelRatio);
    if (next && this.activeSolid) this._schedulePolyhedraPrewarm(this.activeSolid.solidId);
    if (!next) {
      this._resumeHoldAfterTransition = false;
      this.isHolding = false;
      this.uniforms.uEnergy.value = 0;
      this.holdFX?.reset?.();
      this.detonationActive = false;
      this._cancelPolyhedraPrewarm(true);
      this.eventBus.emit('ENERGY_UPDATE', { energy: 0 });
    }
  }

  /** Smoothly switch between the sealed overhead, Prologue overhead and chapter views. */
  setBookCameraMode(mode = 'chapter') {
    this.bookCameraMode = ['sealed', 'prologue'].includes(mode) ? mode : 'chapter';
    this._cameraUpTarget.set(0, 0, -1);
    if (this.bookCameraMode === 'chapter') this._cameraUpTarget.set(0, 1, 0);
  }

  playChapterSignature(chapterId, color = '#d9b979') {
    this._clearChapterSignature();
    const group = new THREE.Group();
    group.name = `ChapterSignature:${chapterId}`;
    this.worldPivot.add(group);
    const primary = new THREE.Color(color || '#d9b979');
    const secondary = new THREE.Color('#8bd8f4');
    const addLine = (points, tint = primary, opacity = 0.9, width = 0.012) => {
      const curve = new THREE.CatmullRomCurve3(points);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(24, points.length * 8)));
      const mat = new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.userData.baseOpacity = opacity;
      group.add(line);
      return line;
    };
    const addPoints = (positions, tint = secondary, size = 0.045) => {
      const geo = new THREE.BufferGeometry().setFromPoints(positions);
      const mat = new THREE.PointsMaterial({ color: tint, size, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const points = new THREE.Points(geo, mat);
      group.add(points);
      return points;
    };

    if (chapterId === 'golden-ratio') {
      const pts = [];
      for (let i = 0; i <= 180; i++) {
        const a = i * 0.075, r = 0.008 * Math.exp(0.025 * i);
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
      }
      const spiral = addLine(pts, primary, 1.0);
      spiral.geometry.setDrawRange(0, 1);
      this._chapterSignatureReveal = spiral;
    } else if (chapterId === 'projection') {
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3;
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const q = i / 6;
          const x = Math.cos(a) * (q - .5) * 2.1;
          const y = Math.sin(a) * (q - .5) * 2.1;
          pts.push(new THREE.Vector3(x, y, (k - 1) * .18));
        }
        addLine(pts, k === 1 ? primary : secondary, .82);
      }
    } else if (chapterId === 'infinity') {
      const pts = [];
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 15; col++) {
          pts.push(new THREE.Vector3((col - 7) * .15, (row - 2) * .12, Math.sin(col * .55 + row) * .08));
        }
      }
      addPoints(pts, primary, .055);
      for (let i = -2; i <= 2; i++) addLine([new THREE.Vector3(-1.1, i * .12, 0), new THREE.Vector3(1.1, i * .12, 0)], secondary, .42);
    } else if (chapterId === 'non-euclidean') {
      for (let ring = 0; ring < 4; ring++) {
        const pts = [];
        for (let i = 0; i <= 100; i++) {
          const a = i / 100 * Math.PI * 2;
          const r = .36 + ring * .18 + Math.sin(a * 4 + ring) * .07;
          pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, Math.sin(a * 3 + ring) * .1));
        }
        addLine(pts, ring % 2 ? secondary : primary, .75);
      }
    } else if (chapterId === 'polyhedra') {
      const geo = new THREE.IcosahedronGeometry(.95, 0);
      const edges = new THREE.EdgesGeometry(geo);
      const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: primary, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.scale.setScalar(.001);
      group.add(line);
      this._chapterSignatureFacet = line;
      const pos = geo.attributes.position;
      const points = [];
      for (let i = 0; i < pos.count; i += 3) points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      addPoints(points, secondary, .06);
      geo.dispose();
    } else {
      const lines = [];
      for (let i = 0; i < 9; i++) {
        const y = (i - 4) * .17;
        lines.push([new THREE.Vector3(-1.05, y, 0), new THREE.Vector3(1.05, y, 0)]);
      }
      lines.forEach((pts, i) => addLine(pts, i % 2 ? secondary : primary, .75));
    }
    this._chapterSignature = { group, age: 0, duration: 1.85, chapterId };
  }

  _clearChapterSignature() {
    const group = this._chapterSignature?.group;
    if (group) {
      group.traverse((obj) => {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material?.dispose();
      });
      group.parent?.remove(group);
    }
    this._chapterSignature = null;
    this._chapterSignatureReveal = null;
    this._chapterSignatureFacet = null;
  }

  _updateChapterSignature(delta) {
    if (!this._chapterSignature) return;
    const fx = this._chapterSignature;
    fx.age += delta;
    const t = THREE.MathUtils.clamp(fx.age / fx.duration, 0, 1);
    const e = t * t * (3 - 2 * t);
    const fade = 1 - THREE.MathUtils.smoothstep(t, 0.76, 1);
    fx.group.scale.setScalar(.86 + .14 * e);
    fx.group.rotation.y += delta * .14;
    fx.group.traverse((obj) => {
      if (obj.material && 'opacity' in obj.material) obj.material.opacity = (obj.material.userData.baseOpacity ?? .85) * fade;
    });
    if (this._chapterSignatureReveal) {
      const geo = this._chapterSignatureReveal.geometry;
      geo.setDrawRange(0, Math.max(1, Math.floor(geo.attributes.position.count * e)));
    }
    if (this._chapterSignatureFacet) this._chapterSignatureFacet.scale.setScalar(.001 + e * .999);
    if (t >= 1) this._clearChapterSignature();
  }

  /** Preserve the Build 11 camera pull-back while the interactive stage is composed over the book. */
  setBookView(_coveredPixels = 0, zoom = 1) {
    // Stage placement is anchored to the page surface; only restore the gentle pull-back.
    this._zoomTarget = THREE.MathUtils.clamp(zoom || 1, 1, 1.8);
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
    this.eventBus.emit('SOLID_VISIBILITY_CHANGED', {
      visible: vis,
      autoHidden: this.portalAutoHideCount > 0
    });
  }

  _storeSolidInCache(solid) {
    if (!solid) return;
    solid.rootGroup.visible = false;
    solid.rootGroup.scale.setScalar(1);
    solid.fxGroup.visible = false;
    solid.particles.visible = false;
    this.worldPivot.remove(solid.rootGroup);
    this.solidCache.delete(solid.solidId);
    this.solidCache.set(solid.solidId, solid);
    while (this.solidCache.size > this.solidCacheLimit) {
      const oldestId = this.solidCache.keys().next().value;
      const oldest = this.solidCache.get(oldestId);
      this.solidCache.delete(oldestId);
      oldest?.dispose?.();
    }
  }

  loadSolid(solidId) {
    if (this.activeSolid?.solidId === solidId && !this.solidTransitionActive) return;

    // Reset any in-flight hold VFX before an outgoing model becomes a retiring fragment set.
    this.holdFX?.reset?.();
    this._clearHoveredInteraction();
    this.detonationActive = false;
    this.uniforms.uEnergy.value = 0;
    this._resumeHoldAfterTransition = this.holdInteractionEnabled || this._resumeHoldAfterTransition;
    this.holdInteractionEnabled = false;
    // Keep the chapter-local render scale when swapping between Polyhedra
    // solids; restore the base scale only when leaving the chapter.
    this._applyRenderPixelRatio(
      this._resumeHoldAfterTransition ? this._polyhedraPixelRatio : this._basePixelRatio
    );
    this.isHolding = false;
    this.isDragging = false;
    this.solidTransitionActive = true;

    let hasOutgoing = false;
    if (this.activeSolid) {
      const outgoing = this.activeSolid;
      outgoing.fxGroup.visible = false;
      outgoing.particles.visible = false;
      if (outgoing.rootGroup.visible) {
        outgoing._exitAge = 0;
        outgoing._exitDuration = 1.42;
        outgoing._exitStyle = ({ Fire: 'fire', Earth: 'earth', Air: 'air', Water: 'water', Aether: 'aether' })[outgoing.meta.element] || 'fire';
        outgoing.beginDetonation?.();
        this.retiringSolids.push(outgoing);
        hasOutgoing = true;
      } else {
        this._storeSolidInCache(outgoing);
      }
    }

    // Reuse a prepared model when possible. The bounded cache holds up to four
    // inactive solids, allowing all five chapter models to be warm without
    // rebuilding geometry inside a chapter-click handler.
    const cached = this.solidCache.get(solidId);
    let built;
    if (cached) {
      this.solidCache.delete(solidId);
      built = cached;
      built.resetForActivation?.(this.uniforms.uUnfold.value);
    } else {
      built = this.builder.build(solidId);
    }

    // Keep the incoming model hidden until the outgoing solid has fractured out.
    // has fractured and left the stage. The reveal is then topological:
    // vertices, edges, and finally faces. Instanced edge/node batches keep this
    // construction substantially lighter than the old per-edge/per-vertex meshes.
    this.activeSolid = built;
    this.worldPivot.add(built.rootGroup);

    this.uniforms.uColorPrimary.value.set(built.meta.primaryColor);
    this.uniforms.uColorSecondary.value.set(built.meta.secondaryColor);
    this.uniforms.uColorTertiary.value.set(built.meta.tertiaryColor);
    this.uniforms.uEnergy.value = 0;
    built.setUnfold(this.uniforms.uUnfold.value);
    built.setReconstruction?.(0);
    built.setCoreReveal?.(0);
    this.holdFX.setElement(built.meta, solidId);
    this.solidPresence = 0;
    built.rootGroup.visible = false;
    built.rootGroup.scale.setScalar(1);
    this._solidIntro = {
      solid: built,
      age: 0,
      delay: hasOutgoing ? 1.42 : 0.08,
      duration: 2.05
    };

    // Default pose: every solid rests on its base face (reset any pitch/roll, keep it level).
    this.targetCameraQuat = new THREE.Quaternion();
    this._syncSolidVisibility();
    this.eventBus.emit('SOLID_CHANGED', {
      solidId,
      meta: built.meta,
      geoData: built.geoData
    });
    this._schedulePolyhedraPrewarm(solidId);
  }

  _schedulePolyhedraPrewarm(activeId) {
    const ids = ['tetrahedron', 'cube', 'octahedron', 'icosahedron', 'dodecahedron'];
    const polyhedraActive = this.holdInteractionEnabled || this._resumeHoldAfterTransition;
    if (!polyhedraActive) return;

    if (!this._solidPrewarmQueue.length) {
      this._solidPrewarmQueue = ids.filter((id) =>
        id !== activeId && !this.solidCache.has(id) && !this._solidPrewarmed.has(id)
      );
    }
    if (this._solidPrewarmScheduled || !this._solidPrewarmQueue.length) return;

    this._runSolidPrewarmTask = (deadline) => {
      this._solidPrewarmScheduled = false;
      this._solidPrewarmHandle = null;
      if (!this._solidPrewarmQueue.length) return;

      const stillInPolyhedra = this.holdInteractionEnabled || this._resumeHoldAfterTransition;
      if (!stillInPolyhedra) {
        this._solidPrewarmQueue.length = 0;
        return;
      }
      const busy = document.hidden || this.solidTransitionActive || this.detonationActive || this.isHolding;
      if (busy || (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 8)) {
        this._queueNextSolidPrewarm(360);
        return;
      }

      const id = this._solidPrewarmQueue.shift();
      if (id !== this.activeSolid?.solidId && !this.solidCache.has(id) && !this._solidPrewarmed.has(id)) {
        const started = performance.now();
        const prepared = this.builder.build(id);
        prepared.rootGroup.visible = false;
        prepared.resetForActivation?.(this.uniforms.uUnfold.value);
        this._storeSolidInCache(prepared);
        this._solidPrewarmed.add(id);
        if (this.performanceDiagnostics) this.performanceDiagnostics.lastPrewarmMs = performance.now() - started;
      }
      if (this._solidPrewarmQueue.length) this._queueNextSolidPrewarm(180);
    };

    this._queueNextSolidPrewarm(520);
  }

  _queueNextSolidPrewarm(delay = 180) {
    if (this._solidPrewarmScheduled || !this._solidPrewarmQueue.length) return;
    this._solidPrewarmScheduled = true;
    this._solidPrewarmTimer = window.setTimeout(() => {
      this._solidPrewarmTimer = null;
      if (typeof window.requestIdleCallback === 'function') {
        this._solidPrewarmHandle = window.requestIdleCallback(this._runSolidPrewarmTask, { timeout: 2400 });
      } else {
        this._runSolidPrewarmTask(null);
      }
    }, delay);
  }

  _cancelPolyhedraPrewarm(clearQueue = true) {
    if (this._solidPrewarmTimer !== null) {
      window.clearTimeout(this._solidPrewarmTimer);
      this._solidPrewarmTimer = null;
    }
    if (this._solidPrewarmHandle !== null) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(this._solidPrewarmHandle);
      else window.clearTimeout(this._solidPrewarmHandle);
      this._solidPrewarmHandle = null;
    }
    this._solidPrewarmScheduled = false;
    if (clearQueue) this._solidPrewarmQueue.length = 0;
  }

  _initPerformanceDiagnostics() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') !== 'performance') return;
    const panel = document.createElement('pre');
    panel.id = 'mathgic-performance-diagnostics';
    panel.setAttribute('aria-hidden', 'true');
    Object.assign(panel.style, {
      position: 'fixed', left: '10px', bottom: '10px', zIndex: '99999',
      margin: '0', padding: '8px 10px', minWidth: '230px',
      color: '#d9e7f7', background: 'rgba(4, 9, 20, .86)',
      border: '1px solid rgba(130, 180, 220, .22)', borderRadius: '8px',
      font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
      whiteSpace: 'pre', pointerEvents: 'none', backdropFilter: 'blur(8px)'
    });
    panel.textContent = 'MATHGIC PERFORMANCE\nCollecting frame data…';
    document.body.appendChild(panel);
    this.performanceDiagnostics = {
      panel, sampleElapsed: 0, sampleFrames: 0, fps: 0,
      frameMs: 0, lastPrewarmMs: 0
    };
  }

  _updatePerformanceDiagnostics(delta) {
    const stats = this.performanceDiagnostics;
    if (!stats) return;
    stats.sampleElapsed += delta;
    stats.sampleFrames++;
    stats.frameMs = stats.frameMs ? stats.frameMs * 0.84 + delta * 1000 * 0.16 : delta * 1000;
    if (stats.sampleElapsed < 0.4) return;
    stats.fps = stats.sampleFrames / Math.max(0.001, stats.sampleElapsed);
    const info = this.renderer.info;
    const cacheCount = this.solidCache.size;
    stats.panel.textContent = [
      'MATHGIC · PERFORMANCE',
      `FPS          ${stats.fps.toFixed(1)}`,
      `Frame        ${stats.frameMs.toFixed(1)} ms`,
      `Draw calls   ${info.render.calls}`,
      `Triangles    ${info.render.triangles.toLocaleString()}`,
      `Geometries   ${info.memory.geometries}`,
      `Textures     ${info.memory.textures}`,
      `Cached solids ${cacheCount}/4`,
      `TOC redraws  ${this.book?.contentsLeftCanvas?.redrawCount ?? 0}/${this.book?.contentsRightCanvas?.redrawCount ?? 0}`,
      `TOC hovers   ${this.book?._contentsHoverChanges ?? 0}`,
      `Book visible ${this.book?.bookGroup?.visible ? 'yes' : 'no'}`,
      `Prewarm      ${stats.lastPrewarmMs ? stats.lastPrewarmMs.toFixed(1) + ' ms' : '—'}`
    ].join('\n');
    stats.sampleElapsed = 0;
    stats.sampleFrames = 0;
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

  /** Releasing a fully charged hold: burst VFX + face pulse. */
  releaseCharge(charge) {
    if (!this.holdInteractionEnabled || this.solidTransitionActive || !this.activeSolid || !this.activeSolid.rootGroup.visible) return;
    if (fxState.enabled) {
      this.holdFX.burst(charge, this.activeSolid.solidId, this.activeSolid);
      this.detonationActive = true;
    }
    this.uniforms.uEnergy.value = 0;
    this.eventBus.emit('ENERGY_UPDATE', { energy: 0 });
    this.triggerPulse(new THREE.Vector3(0, 0, 0));
    this.eventBus.emit('CHARGE_RELEASE', { energy: charge, solidId: this.activeSolid.solidId });
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
      const rect = dom.getBoundingClientRect();
      this.pointerNDC.x = ((x - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      this.pointerNDC.y = -((y - rect.top) / Math.max(1, rect.height)) * 2 + 1;

      // Charging starts only when the pointer actually lands on a visible solid.
      // This prevents accidental bursts on empty canvas space or on the book behind it.
      let solidIsFrontmost = false;
      if (this.explorationVisible && this.holdInteractionEnabled && !this.solidTransitionActive && !this.detonationActive && this.activeSolid?.rootGroup.visible) {
        this.raycaster.setFromCamera(this.pointerNDC, this.camera);
        const solidTargets = this.activeSolid.interactiveTargets;
        const solidHits = solidTargets?.length ? this.raycaster.intersectObjects(solidTargets, false) : [];
        const bookHits = this.book?.opened && this.book.bookGroup?.visible
          ? this.raycaster.intersectObject(this.book.bookGroup, true)
          : [];
        solidIsFrontmost = !!solidHits.length && (!bookHits.length || solidHits[0].distance < bookHits[0].distance);
      }

      if (this.detonationActive) {
        this.isDragging = false;
        this.isHolding = false;
        return;
      }
      this.isDragging = true;
      this.isHolding = this.holdInteractionEnabled && solidIsFrontmost;
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
        const now = performance.now();
        if (now - this._lastHoverRaycastAt >= 30) {
          this._lastHoverRaycastAt = now;
          this._performRaycastHover();
        }
      }
    };

    const onUp = () => {
      const charge = this.uniforms.uEnergy.value;
      if (this.isHolding && this.dragDistance < 10 && charge > 0.5) {
        // Hold-to-charge remains immediate and is never delayed by the double-click recognizer.
        this.releaseCharge(charge);
      } else if (this.isDragging && this.dragDistance < 6) {
        // Delay ordinary click by one browser double-click window. If a second
        // click arrives, the dblclick handler cancels this pending single action.
        if (this._pendingClickTimer) clearTimeout(this._pendingClickTimer);
        this._pendingClickTimer = window.setTimeout(() => {
          this._pendingClickTimer = null;
          if (!this.focusMode?.active) this._performRaycastClick();
        }, 260);
      }
      this.isDragging = false;
      this.isHolding = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      if (this.focusMode?.active) {
        this.focusMode.distance = THREE.MathUtils.clamp(
          this.focusMode.distance + e.deltaY * 0.006,
          Math.max(0.7, this.focusMode.radius * 0.85),
          Math.max(8, this.focusMode.radius * 9)
        );
        return;
      }
      this.targetCameraDistance = THREE.MathUtils.clamp(
        this.targetCameraDistance + e.deltaY * 0.0022,
        1.35,
        6.8
      );
    };

    const onDblClick = (e) => {
      if (this._pendingClickTimer) { clearTimeout(this._pendingClickTimer); this._pendingClickTimer = null; }
      const { x, y } = getCoords(e);
      const rect = dom.getBoundingClientRect();
      this.pointerNDC.x = ((x - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      this.pointerNDC.y = -((y - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      if (!this.detonationActive) this.enterFocusModeFromPointer();
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
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    const solid = this.activeSolid;
    const canHoverSolid = !this.solidTransitionActive && solid?.rootGroup.visible;
    const targets = canHoverSolid ? solid.interactiveTargets : [];
    const hits = targets?.length ? this.raycaster.intersectObjects(targets, false) : [];
    const bookPageHit = this.book?.opened && this.book.contentsMode
      ? this.raycaster.intersectObjects([this.book.leftPageMesh, this.book.rightPageMesh], false)[0]
      : null;
    if (bookPageHit && (!hits.length || bookPageHit.distance < hits[0].distance)) {
      this._clearHoveredInteraction();
      this.book.handlePageHover(bookPageHit);
      return;
    }
    this.book?.clearPageHover?.();

    if (!canHoverSolid) {
      this._clearHoveredInteraction();
      this.eventBus.emit('HOVER_CLEAR');
      return;
    }

    const hit = hits[0];
    if (!hit) {
      this._clearHoveredInteraction();
      this.eventBus.emit('HOVER_CLEAR');
      return;
    }

    const obj = hit.object;
    const instanceId = Number.isInteger(hit.instanceId) ? hit.instanceId : null;
    const data = instanceId !== null ? obj.userData.instances?.[instanceId] : obj.userData;
    if (!data) return;

    const unchanged = this.hoveredInstance
      && this.hoveredInstance.object === obj
      && this.hoveredInstance.instanceId === instanceId;
    if (!unchanged) {
      this._clearHoveredInteraction();
      this.hoveredInstance = { solid, object: obj, instanceId, data };
      this.hoveredObject = instanceId === null ? obj : null;
      if (instanceId !== null) solid.setInstanceHighlight?.(obj, instanceId, true);
    }
    this.uniforms.uPointer3D.value.copy(hit.point);

    const type = data.interactType;
    if (type === 'vertex') {
      if (instanceId === null) obj.scale.setScalar(1.9);
      this.eventBus.emit('VERTEX_HOVER', {
        vertexIndex: data.vertexIndex,
        coords: data.coords
      });
    } else if (type === 'edge') {
      if (instanceId === null) {
        obj.scale.set(1.65, 1, 1.65);
        if (data.strutMat?.uniforms?.uHoverBoost) data.strutMat.uniforms.uHoverBoost.value = 1.0;
      }
      this.eventBus.emit('EDGE_HOVER', { edgeVertices: data.edgeVertices });
    } else if (type === 'face') {
      this.eventBus.emit('FACE_HOVER', { faceIndex: data.faceIndex, point: hit.point });
    }
  }

  _performRaycastClick() {
    if (this.solidTransitionActive || this.detonationActive || this.focusMode?.active) return;
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);

    const contentsPageHits = this.book?.opened && this.book.contentsMode && this.book.bookGroup?.visible
      ? this.raycaster.intersectObjects([this.book.leftPageMesh, this.book.rightPageMesh], false)
      : [];
    if (contentsPageHits.length) {
      // In Prologue only the printed page surfaces are interactive. Do not let
      // the cover, page-block side walls or spine intercept a printed TOC click.
      this.book.handleRaycastHit(contentsPageHits[0]);
      return;
    }
    const bookHits = this.book?.opened && !this.book.contentsMode && this.book.bookGroup?.visible
      ? this.raycaster.intersectObject(this.book.bookGroup, true)
      : [];
    const solidTargets = this.activeSolid && this.activeSolid.rootGroup.visible
      ? this.activeSolid.interactiveTargets
      : [];
    const solidHits = solidTargets.length ? this.raycaster.intersectObjects(solidTargets, false) : [];
    const solidFaceHits = this.activeSolid && this.activeSolid.rootGroup.visible
      ? this.raycaster.intersectObjects(this.activeSolid.faceMeshes, false)
      : [];
    const nonSolidRoots = this._interactiveRoots().filter((root) => root !== this.activeSolid?.rootGroup);
    const spellHits = nonSolidRoots.length ? this.raycaster.intersectObjects(nonSolidRoots, true) : [];
    const nearestWorldHit = Math.min(
      solidHits[0]?.distance ?? Infinity,
      spellHits[0]?.distance ?? Infinity
    );

    // The book is physically behind every interactive object. A click on a
    // visible spell must never leak through and turn a page on the book behind it.
    if (bookHits.length && bookHits[0].distance < nearestWorldHit) {
      this.book.handleRaycastHit(bookHits[0]);
      return;
    }
    if (spellHits.length && spellHits[0].distance < (solidHits[0]?.distance ?? Infinity)) return;

    if (solidFaceHits.length > 0) {
      const hit = solidFaceHits[0];
      const faceMesh = hit.object;

      const localHit = this.activeSolid.rootGroup.worldToLocal(hit.point.clone());
      this.triggerPulse(localHit);

      const worldNormal = faceMesh.userData.localNormal
        .clone()
        .applyQuaternion(faceMesh.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();

      // The interactive stage is camera-relative while the book is open, so use
      // the actual camera-to-hit direction rather than assuming the solid sits at world origin.
      const camDir = this.camera.position.clone().sub(hit.point).normalize();
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
      this._energyEventAccumulator += delta;
      if (this._energyEventAccumulator >= 1 / 30
        || Math.abs(this.uniforms.uEnergy.value - this._lastEnergyEventValue) >= 0.06
        || (this.uniforms.uEnergy.value <= 0.001 && this._lastEnergyEventValue > 0.001)) {
        this.eventBus.emit('ENERGY_UPDATE', { energy: this.uniforms.uEnergy.value });
        this._lastEnergyEventValue = this.uniforms.uEnergy.value;
        this._energyEventAccumulator = 0;
      }

      // Outgoing Polyhedra fracture before leaving the stage. The incoming model
      // remains hidden until disposal completes, avoiding two expensive solids
      // drawing at once during a chapter-1 transition.
      for (let i = this.retiringSolids.length - 1; i >= 0; i--) {
        const outgoing = this.retiringSolids[i];
        outgoing._exitAge += delta;
        const t = THREE.MathUtils.clamp(outgoing._exitAge / outgoing._exitDuration, 0, 1);
        // Keep the solid's world scale intact: its faces, edges and vertices are
        // responsible for the fracture motion. Shrinking the root would visually
        // collapse the whole model and hide the geometric shatter sequence.
        outgoing.setDetonation?.(Math.min(0.64, t * 0.64), outgoing._exitStyle || 'fire');
        if (t >= 1) {
          outgoing.endDetonation?.();
          this._storeSolidInCache(outgoing);
          this.retiringSolids.splice(i, 1);
        }
      }

      let introReady = true;
      let introActive = false;
      if (this._solidIntro?.solid === this.activeSolid) {
        introActive = true;
        this._solidIntro.age += delta;
        introReady = this._solidIntro.age >= this._solidIntro.delay;
        if (!introReady) {
          this.activeSolid.rootGroup.visible = false;
          this.activeSolid.setCoreReveal?.(0);
        } else {
          this.activeSolid.rootGroup.visible = true;
          const introProgress = THREE.MathUtils.clamp(
            (this._solidIntro.age - this._solidIntro.delay) / this._solidIntro.duration, 0, 1
          );
          this.activeSolid.setReconstruction?.(introProgress);
          // The core is deliberately staggered behind the first vertex cues.
          // It grows from a dim seed to full elemental form instead of popping
          // into view at the same instant as the incoming root group.
          const coreProgress = THREE.MathUtils.smoothstep(introProgress, 0.06, 0.62);
          this.activeSolid.setCoreReveal?.(coreProgress);
          if (introProgress >= 1) {
            this.activeSolid.setCoreReveal?.(1);
            this._solidIntro = null;
            this.solidTransitionActive = false;
            if (this._resumeHoldAfterTransition) this.setHoldInteractionEnabled(true);
            this._resumeHoldAfterTransition = false;
            introActive = false;
          }
        }
      }

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

        // While the net opens, the solid levels itself onto its base (keeps yaw, removes pitch/roll)
        // and stops bobbing, so the base stays perfectly still on the ground.
        const unfoldNow = this.uniforms.uUnfold.value;
        if (unfoldNow > 0.01 && !this.isDragging && !this.targetCameraQuat) {
          const q = this.worldPivot.quaternion;
          this._levelQuat.set(0, q.y, 0, q.w).normalize();
          this.worldPivot.quaternion.slerp(this._levelQuat, 0.04 + 0.1 * unfoldNow);
        }
        this.activeSolid.rootGroup.position.y =
          Math.sin(elapsed * meta.floatSpeed) * meta.floatAmp * (1 - unfoldNow);

        // During topological reconstruction, leave the root at unit scale. The
        // vertices, edges and faces already carry their own staged animation;
        // scaling the entire root at the same time makes the solid appear to pop
        // or shrink instead of being assembled from its topology.
        const rich = fxState.enabled && !introActive;
        if (introActive) {
          this.solidPresence = introReady ? 1 : 0;
          this.activeSolid.rootGroup.visible = introReady;
          this.activeSolid.rootGroup.scale.setScalar(1);
        } else {
          const presenceTarget = this.isSolidEffectivelyVisible() ? 1 : 0;
          this.solidPresence += (presenceTarget - this.solidPresence) * Math.min(1, delta * 3.15);
          if (Math.abs(this.solidPresence - presenceTarget) < 0.004) this.solidPresence = presenceTarget;
          const pres = this.solidPresence;
          this.activeSolid.rootGroup.visible = pres > 0.01;
          this.activeSolid.rootGroup.scale.setScalar(Math.max(0.001, 1 - Math.pow(1 - pres, 3)));
        }
        this.activeSolid.updateUpright();
        this.activeSolid.fxGroup.visible = rich && unfoldNow > 0.005;
        this.activeSolid.particles.visible = rich && this.activeSolid.rootGroup.visible;

        // Interior cores are animated only while rich FX is enabled. Previously
        // coreAnimator still rewrote hundreds of vertices/particles in FX Off,
        // then immediately overwrote the transforms with the static pose.
        if (this.activeSolid.coreAnimator && this.activeSolid.rootGroup.visible) {
          const inner = this.activeSolid.innerGroup;
          if (rich) {
            if (this._simple) {
              inner.scale.setScalar(1);
              inner.position.set(0, 0, 0);
              this._simple = false;
            }
            this.activeSolid.coreAnimator(elapsed, this.uniforms.uEnergy.value);
          } else {
            this._simple = true;
            inner.position.set(0, 0, 0);
            inner.scale.setScalar(Math.max(0.001, 1 - this.activeSolid.getDissolve()));
          }
        }

        // Ambient particle dynamics
        if (rich && this.activeSolid.rootGroup.visible) {
          const posAttr = this.activeSolid.particles.geometry.attributes.position;
          const seeds = this.activeSolid.particleSeeds;
          const unfoldK = this.uniforms.uUnfold.value;
          const speedBoost = 1 + this.uniforms.uEnergy.value * 4.0 + unfoldK * 5.0;
          const emberTop = 0.95 + unfoldK * 1.6;
          if (this.activeSolid.solidId === 'tetrahedron') {
            for (let i = 0; i < seeds.length; i++) {
              const yIndex = i * 3 + 1;
              posAttr.array[yIndex] += delta * 0.55 * speedBoost;
              if (posAttr.array[yIndex] > emberTop) posAttr.array[yIndex] = -0.3;
            }
          } else {
            const angle = delta * 0.28 * speedBoost;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            for (let i = 0; i < seeds.length; i++) {
              const offset = i * 3;
              const x = posAttr.array[offset];
              const z = posAttr.array[offset + 2];
              posAttr.array[offset] = x * cosA - z * sinA;
              posAttr.array[offset + 2] = x * sinA + z * cosA;
            }
          }
          posAttr.needsUpdate = true;
        }
      }

      // Pooled elemental charge/detonation VFX. If FX is disabled mid-release,
      // reset restores the existing face hierarchy and prevents stale effects.
      const energyNow = this.uniforms.uEnergy.value;
      const richFx = fxState.enabled;
      if (richFx) {
        this.holdFX.update(delta, energyNow, this.activeSolid, elapsed);
      } else if (this.holdFX.phase !== 'idle' || this.holdFX.group.visible) {
        this.holdFX.reset();
      }
      this.detonationActive = richFx && this.holdFX.phase === 'detonating';
      this.bloomPass.strength = richFx ? 0.62 + energyNow * 0.42 + this.holdFX.flash * 0.34 : 0.62;
      // No camera shake is used: energy release remains a geometry-centred effect.

      // Camera rises to look down on the net as it opens
      const unfoldTarget = this.isSolidEffectivelyVisible()
        ? THREE.MathUtils.smoothstep(this.uniforms.uUnfold.value, 0.05, 1.0)
        : 0;
      this._viewK += (unfoldTarget - this._viewK) * Math.min(1, delta * 4);
      const unfoldView = this._viewK;
      this.cameraDistance = THREE.MathUtils.lerp(this.cameraDistance, this.targetCameraDistance, 0.1);
      this._zoom += (this._zoomTarget - this._zoom) * Math.min(1, delta * 5);
      this._cameraPositionTarget.set(
        0,
        THREE.MathUtils.lerp(0.25, 2.3, unfoldView),
        this.cameraDistance * this._zoom
      );
      this._cameraTargetTarget.set(0, 0, 0);

      if (this.bookCameraMode === 'sealed' || this.bookCameraMode === 'prologue') {
        const overheadDistance = this.bookCameraMode === 'sealed' ? 5.75 : 6.25;
        // The Camera Rig owns a fixed world target. BookAnchor is a one-way
        // camera-space child; it must never feed its own position back into the
        // camera target, otherwise small layout changes accumulate into drift.
        this._cameraTargetTarget.copy(this._bookRigTarget);
        this._cameraPositionTarget.set(0, overheadDistance, 0.025);
        this._cameraUpTarget.set(0, 0, -1);
      } else {
        this._cameraUpTarget.set(0, 1, 0);
      }
      const cameraPoseFollow = 1 - Math.exp(-delta * 5.2);
      this._focusNormalPosition.lerp(this._cameraPositionTarget, cameraPoseFollow);
      this._focusNormalTarget.lerp(this._cameraTargetTarget, cameraPoseFollow);
      this._cameraUp.lerp(this._cameraUpTarget, 1 - Math.exp(-delta * 5.0)).normalize();
      this.camera.up.copy(this._cameraUp);

      if (this.focusMode) {
        const focus = this.focusMode;
        if (focus.root?.parent) {
          focus.root.updateMatrixWorld(true);
          focus.target.copy(focus.localCenter).applyMatrix4(focus.root.matrixWorld);
        } else if (focus.active) {
          this.exitFocusMode();
        }

        if (focus.active) this.focusBlend = Math.min(1, this.focusBlend + delta * 4.2);
        else this.focusBlend = Math.max(0, this.focusBlend - delta * 4.2);

        this._focusCameraPosition.copy(focus.target).addScaledVector(focus.direction, focus.distance);
        this._focusCameraTarget.copy(focus.target);
        this.camera.position.lerpVectors(this._focusNormalPosition, this._focusCameraPosition, this.focusBlend);
        this._focusNormalTarget.lerp(this._focusCameraTarget, this.focusBlend);
        this.camera.lookAt(this._focusNormalTarget);

        if (!focus.active && this.focusBlend <= 0.001) this._finishFocusExit();
      } else {
        this.camera.position.copy(this._focusNormalPosition);
        this.camera.lookAt(this._focusNormalTarget);
      }

      this.starField.rotation.y = elapsed * 0.015;
      // One animation clock for the book, camera and all interactive geometry.
      // The book no longer owns a second RAF for cover or page-turn animation.
      if (!this.focusMode) {
        this.book?.updateAnimation?.(delta, elapsed);
        this.book?.updateAnchor?.(delta);
      }

      // Move every interactive 3D object together; the book remains camera-anchored
      // behind this stage, so depth testing makes the objects appear to levitate over it.
      const stageDestination = this.floatingStageEnabled
        ? this.floatingStageTarget
        : this._homeStagePosition;
      const stageFollow = 1 - Math.exp(-delta * 8.5);
      this.worldPivot.position.lerp(stageDestination, stageFollow);

      this._updateChapterSignature(delta);
      this.eventBus.emit('TICK', { elapsed, delta });

      // FX Off bypasses EffectComposer/UnrealBloom entirely. This avoids two
      // full-resolution post-processing targets on the performance-sensitive
      // Polyhedra chapter while keeping the same Scene and WebGLRenderer.
      if (fxState.enabled) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
      this._updatePerformanceDiagnostics(delta);
    };

    animate();
  }
}
