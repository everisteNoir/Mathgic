import * as THREE from 'three';

/**
 * CurvedBook3D.js — book geometry embedded in the Engine scene.
 * It shares the Engine camera, renderer and depth buffer; only the page-turn deforms geometry.
 */
export class CurvedBook3D {
  constructor(engine, container, { onPrev, onNext, onChapterSelect } = {}) {
    this.engine = engine;
    this.container = container;
    this.onPrev = onPrev;
    this.onNext = onNext;
    this.onChapterSelect = onChapterSelect;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.renderer = engine.renderer;

    this.opened = false;
    this.focusHidden = false;
    this.poseMode = 'chapter';
    this._poseInitialized = false;
    // Cover opening/closing and page turns are advanced by Engine.start() so the
    // book never runs a second requestAnimationFrame loop beside the renderer.
    this.coverTransition = null;
    this.theme = { id: 'elemental', primary: '#ff5722', secondary: '#fbbf24' };
    this.flipState = null;

    // Recreate the exact relative viewing pose from Build 11's dedicated book camera.
    // The old camera used FOV 34°, distance 8.95, pitch 0.34 rad and looked at y=0.44.
    // We keep that camera only as a mathematical reference; it does not render anything.
    this.LEGACY_BOOK_FOV = 34;
    this.LEGACY_BOOK_DISTANCE = 8.95;
    this.LEGACY_BOOK_PITCH = 0.34;
    this.LEGACY_BOOK_TARGET_Y = 0.44;
    this.LEGACY_STAGE_BOTTOM = 12;
    const legacyCamera = new THREE.PerspectiveCamera(this.LEGACY_BOOK_FOV, 650 / 260, 0.1, 60);
    legacyCamera.position.set(
      0,
      Math.sin(this.LEGACY_BOOK_PITCH) * this.LEGACY_BOOK_DISTANCE,
      Math.cos(this.LEGACY_BOOK_PITCH) * this.LEGACY_BOOK_DISTANCE
    );
    legacyCamera.lookAt(0, this.LEGACY_BOOK_TARGET_Y, 0);
    legacyCamera.updateMatrixWorld(true);
    this.localBookRotation = legacyCamera.quaternion.clone().invert();
    const legacyOrigin = legacyCamera.worldToLocal(new THREE.Vector3(0, 0, 0));
    this.LEGACY_BOOK_VIEW_DEPTH = Math.max(0.1, -legacyOrigin.z);
    const legacyHalfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.LEGACY_BOOK_FOV) * 0.5);
    this.LEGACY_BOOK_ORIGIN_NDC = new THREE.Vector2(
      legacyOrigin.x / (this.LEGACY_BOOK_VIEW_DEPTH * legacyHalfFovTangent * legacyCamera.aspect),
      legacyOrigin.y / (this.LEGACY_BOOK_VIEW_DEPTH * legacyHalfFovTangent)
    );

    // Tuned geometric proportions matching the physical curved hardcover book
    // These are the original Build 11 page dimensions and deformation resolution.
    this.PAGE_W = 4.58;
    this.PAGE_D = 4.92;
    this.SEG_U = 64;
    this.SEG_V = 16;

    this.HINGE_X = 0.44;
    this.BOARD_W = 4.34;
    this.BOARD_D = 5.14;
    this.BOARD_THICK = 0.095;
    this.FRONT_COVER_LIFT = 0.105;

    this.archScale = 0.80;
    this.coverWarpScale = 1.38;

    this._initScene();
    this._buildBook();
    // Cache the front-cover's open and folded profiles once. During animation
    // the same geometry morphs between them; no second book model is created.
    this._prepareFrontCoverMorph();
    this._rebuildAllGeometry();
    this._cachePaperGeometryStates();
    this._setPaperFlatten(1);
    this._poseCenterBlend = 0;
    this._poseCenters = { sealed: new THREE.Vector3(), open: new THREE.Vector3() };
    this._anchorCenterLocal = new THREE.Vector3();
    this._anchorCenterOffset = new THREE.Vector3();
    this._anchorLocalPoint = new THREE.Vector3();
    this._anchorWorldPoint = new THREE.Vector3();
    this._anchorNormal = new THREE.Vector3();
    this._anchorRight = new THREE.Vector3();
    this._anchorPageDepthAxis = new THREE.Vector3();
    this._anchorPageWorldPoint = new THREE.Vector3();
    this._anchorPageCameraPoint = new THREE.Vector3();
    this._anchorStageCameraPoint = new THREE.Vector3();
    this._anchorChapterPose = new THREE.Quaternion();
    this._anchorTargetPose = new THREE.Quaternion();
    this._anchorBasisMatrix = new THREE.Matrix4();
    this._anchorZero = new THREE.Vector3();
    this._cacheBookPoseCenters();
    // One physical BookGroup serves every state. Sealed mode is applied as an
    // explicit pose (including which hidden back-side parts are covered), not
    // by keeping both open-spread halves visible under the front cover.
    this._applySealedPose();
    this.bookLights.visible = true;
    // Keep culling per mesh and disable the world fog on the close-up paper,
    // otherwise the Engine's deep-space fog would wash the book out.
    this.bookGroup.traverse((object) => {
      if (!object.isMesh) return;
      // The book is camera-anchored and its page geometry morphs between cached
      // profiles. Disable per-mesh frustum rejection: a stale local bound must
      // never make the whole grimoire disappear after the camera eases.
      object.frustumCulled = false;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => { material.fog = false; });
    });
    this._bindEvents();
    this.engine.attachBook(this);
  }

  _initScene() {
    // Book meshes share the main Engine scene and depth buffer. Add gentle studio
    // lights once; the book itself has no independent camera or WebGL renderer.
    this.bookLights = new THREE.Group();
    this.bookLights.name = 'GrimoireLighting';
    this.bookLights.add(new THREE.HemisphereLight(0xdce8ff, 0x161b29, 0.82));

    const keyLight = new THREE.DirectionalLight(0xfff2d6, 1.05);
    keyLight.position.set(3.6, 8.6, 5.2);
    this.bookLights.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8bb6ff, 0.42);
    rimLight.position.set(-5.0, 2.2, 6.2);
    this.bookLights.add(rimLight);
    this.scene.add(this.bookLights);
  }


  /* =========================================================================
     TEXTURES: CLOTH HARDCOVER, ENDPAPERS, HEADBAND, PAPER STACK & ETHEREAL PAGES
     ========================================================================= */
  _createCoverClothTextures() {
    const size = 512;
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = size;
    colorCanvas.height = size;
    const cCtx = colorCanvas.getContext('2d');

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d');

    cCtx.fillStyle = '#1b1626';
    cCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = '#808080';
    bCtx.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        const weave = (x + y) % 8 === 0 ? 14 : -10;
        const noise = (Math.random() - 0.5) * 10;
        const bVal = Math.max(0, Math.min(255, 128 + weave * 2.2 + noise));
        bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
        bCtx.fillRect(x, y, 3, 3);

        const cR = 28 + weave * 0.45 + noise * 0.2;
        const cG = 24 + weave * 0.4 + noise * 0.2;
        const cB = 42 + weave * 0.6 + noise * 0.25;
        cCtx.fillStyle = `rgb(${cR},${cG},${cB})`;
        cCtx.fillRect(x, y, 3, 3);
      }
    }

    const map = new THREE.CanvasTexture(colorCanvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(6, 6);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(6, 6);

    return { map, bumpMap };
  }

  _createEndpaperTexture(isLeft) {
    const w = 512, h = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#171321';
    ctx.fillRect(0, 0, w, h);

    const border = 16;
    const x0 = isLeft ? border : 0;
    const x1 = isLeft ? w : w - border;
    ctx.fillStyle = '#10152b';
    ctx.fillRect(x0, border, x1 - x0, h - border * 2);

    // Subtle arcane gold border frame on the inner cover
    ctx.strokeStyle = 'rgba(245, 198, 105, 0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 10, border + 10, x1 - x0 - 20, h - border * 2 - 20);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _createHeadbandTexture() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext('2d');
    for (let x = 0; x < 256; x += 8) {
      ctx.fillStyle = (x / 8) % 2 === 0 ? '#e6c27a' : '#3b2d5e';
      ctx.fillRect(x, 0, 8, 32);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _createPaperStackMaterial() {
    // A single warm paper tone: no canvas texture, stripes or decorative pattern.
    return new THREE.MeshStandardMaterial({
      color: '#111a31',
      roughness: 0.91,
      metalness: 0
    });
  }

  /**
   * Creates a static page illustration. It is redrawn only when the chapter theme changes,
   * never from the render loop.
   */
  _createStaticPageCanvas(isLeftPage) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 800;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;

    // Generate the star field once so that every redraw remains visually stable.
    let seed = isLeftPage ? 173 : 419;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const stars = Array.from({ length: 56 }, () => ({
      x: 38 + random() * (canvas.width - 76),
      y: 42 + random() * (canvas.height - 84),
      r: 0.6 + random() * 1.5,
      a: 0.22 + random() * 0.48
    }));

    const hexToRgba = (hex, alpha) => {
      const color = new THREE.Color(hex || '#fbbf24');
      return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;
    };

    const render = (theme = this.theme) => {
      const W = canvas.width;
      const H = canvas.height;
      const cx = W * 0.5;
      const cy = H * 0.5;
      const primary = theme?.primary || '#fbbf24';
      const secondary = theme?.secondary || '#38bdf8';
      const mode = theme?.id || 'elemental';

      const bg = ctx.createRadialGradient(cx, cy * 0.9, 16, cx, cy, H * 0.72);
      bg.addColorStop(0, '#1b2747');
      bg.addColorStop(0.58, '#0d1730');
      bg.addColorStop(1, '#070b18');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // A subtle, completely static colour wash.
      const wash = ctx.createRadialGradient(cx, cy, 20, cx, cy, 300);
      wash.addColorStop(0, hexToRgba(primary, 0.13));
      wash.addColorStop(0.58, hexToRgba(secondary, 0.075));
      wash.addColorStop(1, 'rgba(5, 9, 22, 0)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);

      // Fixed star field.
      for (const star of stars) {
        ctx.fillStyle = `rgba(232, 244, 255, ${star.a})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Fine double border and restrained corner marks.
      const pad = 36;
      ctx.strokeStyle = hexToRgba(secondary, 0.32);
      ctx.lineWidth = 1.4;
      ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
      ctx.strokeStyle = hexToRgba(primary, 0.2);
      ctx.lineWidth = 1;
      ctx.strokeRect(pad + 8, pad + 8, W - (pad + 8) * 2, H - (pad + 8) * 2);

      const corners = [[pad, pad], [W - pad, pad], [pad, H - pad], [W - pad, H - pad]];
      ctx.fillStyle = hexToRgba(secondary, 0.7);
      for (const [x, y] of corners) {
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        ctx.fill();
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = hexToRgba(secondary, 0.43);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 194, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([5, 8]);
      ctx.strokeStyle = hexToRgba(primary, 0.34);
      ctx.beginPath();
      ctx.arc(0, 0, 164, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ctx.strokeStyle = hexToRgba(secondary, k % 3 === 0 ? 0.72 : 0.34);
        ctx.lineWidth = k % 3 === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 182, Math.sin(a) * 182);
        ctx.lineTo(Math.cos(a) * 201, Math.sin(a) * 201);
        ctx.stroke();
      }

      if (mode === 'golden') {
        ctx.strokeStyle = hexToRgba(primary, 0.78);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 260; i++) {
          const a = i * 0.075;
          const r = 3.2 * Math.exp(0.19 * a);
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (mode === 'projection') {
        for (let layer = 0; layer < 3; layer++) {
          const sides = 6;
          const radius = 136 - layer * 34;
          ctx.strokeStyle = layer === 1 ? hexToRgba(primary, 0.72) : hexToRgba(secondary, 0.58);
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          for (let j = 0; j <= sides; j++) {
            const a = (j / sides) * Math.PI * 2 + (layer % 2) * 0.18;
            const x = Math.cos(a) * radius;
            const y = Math.sin(a) * radius;
            if (j === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else if (mode === 'non-euclidean') {
        for (let ring = 0; ring < 4; ring++) {
          ctx.strokeStyle = ring % 2 === 0 ? hexToRgba(secondary, 0.56) : hexToRgba(primary, 0.52);
          ctx.lineWidth = 1.7;
          ctx.beginPath();
          for (let step = 0; step <= 96; step++) {
            const a = (step / 96) * Math.PI * 2;
            const r = 48 + ring * 34 + Math.sin(a * 4 + ring * 0.7) * 12;
            const x = Math.cos(a) * r;
            const y = Math.sin(a) * r;
            if (step === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = hexToRgba(primary, 0.65);
        ctx.lineWidth = 1.8;
        for (let tri = 0; tri < 2; tri++) {
          ctx.beginPath();
          for (let k = 0; k < 3; k++) {
            const a = (k * Math.PI * 2) / 3 + tri * Math.PI / 3;
            const x = Math.cos(a) * 142;
            const y = Math.sin(a) * 142;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }

        const nodes = Array.from({ length: 7 }, (_, i) => {
          const a = (i / 7) * Math.PI * 2 + (isLeftPage ? 0.24 : 0.8);
          const r = 88 + (i % 3) * 34;
          return { x: Math.cos(a) * r, y: Math.sin(a) * r };
        });
        ctx.strokeStyle = hexToRgba(secondary, 0.45);
        ctx.beginPath();
        nodes.forEach((node, i) => {
          if (i === 0) ctx.moveTo(node.x, node.y);
          else ctx.lineTo(node.x, node.y);
        });
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = hexToRgba(secondary, 0.8);
        nodes.forEach((node) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.restore();

      // A quiet gutter shade helps the paper sit naturally in the book.
      const gutter = ctx.createLinearGradient(isLeftPage ? W : 0, 0, isLeftPage ? W - 74 : 74, 0);
      gutter.addColorStop(0, 'rgba(3, 5, 14, 0.45)');
      gutter.addColorStop(1, 'rgba(3, 5, 14, 0)');
      ctx.fillStyle = gutter;
      ctx.fillRect(0, 0, W, H);

      texture.needsUpdate = true;
    };

    render(this.theme);
    return { texture, render };
  }


  /** Paint a readable, interactive table of contents directly onto each physical page. */
  _createContentsPageCanvas(isLeftPage) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const entries = isLeftPage
      ? [
          { id: 'prologue', number: '01', symbol: 'α', title: 'PROLOGUE', subtitle: 'The map of this grimoire' },
          { id: 'polyhedra', number: '02', symbol: 'Δ', title: 'POLYHEDRA', subtitle: 'The five Platonic solids' },
          { id: 'golden-ratio', number: '03', symbol: 'φ', title: 'GOLDEN RATIO', subtitle: 'Proportion, spirals and growth' }
        ]
      : [
          { id: 'projection', number: '04', symbol: 'π', title: 'PROJECTION', subtitle: 'Dimensions, sections and shadows' },
          { id: 'infinity', number: '05', symbol: 'ℵ', title: 'INFINITY', subtitle: 'Cantor and the hierarchy of infinities' },
          { id: 'non-euclidean', number: '06', symbol: 'κ', title: 'NON-EUCLIDEAN', subtitle: 'Curvature and alternative spaces' }
        ];

    const zones = [];
    let redrawCount = 0;
    const render = (hoverId = null, activeId = null) => {
      redrawCount++;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#17213a');
      bg.addColorStop(0.52, '#111a31');
      bg.addColorStop(1, '#0d162b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Restrained page grain and printed double rules, never animated.
      let seed = isLeftPage ? 913 : 1729;
      for (let i = 0; i < 900; i++) {
        seed = (seed * 16807) % 2147483647;
        const x = (seed / 2147483647) * W;
        seed = (seed * 16807) % 2147483647;
        const y = (seed / 2147483647) * H;
        ctx.fillStyle = `rgba(236,220,184,${0.012 + (seed % 18) / 1800})`;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
      const gold = '#d9b979';
      ctx.strokeStyle = 'rgba(217,185,121,.56)';
      ctx.lineWidth = 2;
      ctx.strokeRect(58, 58, W - 116, H - 116);
      ctx.strokeStyle = 'rgba(217,185,121,.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(76, 76, W - 152, H - 152);

      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(217,185,121,.82)';
      ctx.font = '500 24px Georgia, serif';
      ctx.letterSpacing = '8px';
      ctx.fillText(isLeftPage ? 'MATHGIC  ·  LIBER I' : 'MATHGIC  ·  LIBER II', W / 2, 148);
      ctx.fillStyle = '#f0dfbd';
      ctx.font = '600 48px Georgia, serif';
      ctx.letterSpacing = '3px';
      ctx.fillText(isLeftPage ? 'TABLE OF CONTENTS' : 'THE JOURNEY CONTINUES', W / 2, 238);
      ctx.strokeStyle = 'rgba(217,185,121,.58)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(180, 282); ctx.lineTo(W - 180, 282); ctx.stroke();
      ctx.fillStyle = 'rgba(226,211,181,.62)';
      ctx.font = 'italic 25px Georgia, serif';
      ctx.letterSpacing = '1px';
      ctx.fillText(isLeftPage ? 'Select a chapter to begin your exploration.' : 'Choose the next world to unfold.', W / 2, 330);

      zones.length = 0;
      const rowTops = [410, 640, 870];
      entries.forEach((entry, i) => {
        const y = rowTops[i];
        const selected = activeId === entry.id;
        const hovered = hoverId === entry.id;
        if (hovered || selected) {
          const glow = ctx.createLinearGradient(116, y - 48, W - 116, y + 130);
          glow.addColorStop(0, hovered ? 'rgba(217,185,121,.16)' : 'rgba(217,185,121,.10)');
          glow.addColorStop(1, 'rgba(217,185,121,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(104, y - 62, W - 208, 174);
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(217,185,121,.68)';
        ctx.font = '500 25px Georgia, serif';
        ctx.fillText(entry.number, 134, y + 8);
        ctx.fillStyle = hovered || selected ? '#f8e5b6' : '#d9b979';
        ctx.font = '52px Georgia, serif';
        ctx.fillText(entry.symbol, 238, y + 18);
        ctx.fillStyle = hovered || selected ? '#fff0d0' : '#e8dcc2';
        ctx.font = '600 34px Georgia, serif';
        ctx.letterSpacing = '2px';
        ctx.fillText(entry.title, 326, y + 2);
        ctx.fillStyle = 'rgba(224,214,194,.68)';
        ctx.font = 'italic 24px Georgia, serif';
        ctx.letterSpacing = '.2px';
        ctx.fillText(entry.subtitle, 326, y + 48);
        ctx.strokeStyle = hovered || selected ? 'rgba(217,185,121,.72)' : 'rgba(217,185,121,.28)';
        ctx.lineWidth = hovered ? 3 : 1.5;
        ctx.beginPath(); ctx.moveTo(132, y + 91); ctx.lineTo(W - 132, y + 91); ctx.stroke();
        // UV normalized zones correspond to the three printed rows. A wide x-range
        // makes selection forgiving while still mapping directly to the page surface.
        zones.push({ id: entry.id, minY: (y - 78) / H, maxY: (y + 112) / H, minX: 0.055, maxX: 0.945 });
      });

      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(217,185,121,.62)';
      ctx.font = 'italic 22px Georgia, serif';
      ctx.fillText(isLeftPage ? 'Touch an inscription to open its chapter' : 'Six paths · One living grimoire', W / 2, 1130);
      ctx.fillStyle = 'rgba(217,185,121,.46)';
      ctx.font = '20px Georgia, serif';
      ctx.fillText(isLeftPage ? '—  I  —' : '—  II  —', W / 2, 1180);
      texture.needsUpdate = true;
    };

    render();
    return {
      texture,
      zones,
      render,
      get redrawCount() { return redrawCount; },
      chapterAt(pagePoint) {
        if (!pagePoint) return null;
        // pagePoint is normalized in the book's local frame, with (0,0) at
        // the outer/top corner of the printed page. Using the physical hit
        // point avoids V/flipY differences between CanvasTexture and raycaster UVs.
        const x = THREE.MathUtils.clamp(pagePoint.x, 0, 1);
        const y = THREE.MathUtils.clamp(pagePoint.y, 0, 1);
        return zones.find((zone) => x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY)?.id || null;
      },
      rowForChapterId(chapterId) {
        return zones.findIndex((zone) => zone.id === chapterId);
      }
    };
  }

  /** Add a cheap page-surface hover highlight without repainting CanvasTexture. */
  _installContentsHighlight(material) {
    const rowStarts = new THREE.Vector3(332 / 1280, 562 / 1280, 792 / 1280);
    const rowEnds = new THREE.Vector3(522 / 1280, 752 / 1280, 982 / 1280);
    const uniforms = {
      hoverRow: { value: -1 },
      activeRow: { value: -1 },
      enabled: { value: 0 },
      rowStarts: { value: rowStarts },
      rowEnds: { value: rowEnds },
      glowColor: { value: new THREE.Color('#e6c47d') }
    };
    material.userData.contentsHighlightUniforms = uniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTocHoverRow = uniforms.hoverRow;
      shader.uniforms.uTocActiveRow = uniforms.activeRow;
      shader.uniforms.uTocEnabled = uniforms.enabled;
      shader.uniforms.uTocRowStarts = uniforms.rowStarts;
      shader.uniforms.uTocRowEnds = uniforms.rowEnds;
      shader.uniforms.uTocGlowColor = uniforms.glowColor;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
uniform float uTocHoverRow;
uniform float uTocActiveRow;
uniform float uTocEnabled;
uniform vec3 uTocRowStarts;
uniform vec3 uTocRowEnds;
uniform vec3 uTocGlowColor;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_UV
if (uTocEnabled > 0.5) {
  float tocY = 1.0 - vMapUv.y;
  float tocX = vMapUv.x;
  float r0 = step(uTocRowStarts.x, tocY) * (1.0 - step(uTocRowEnds.x, tocY));
  float r1 = step(uTocRowStarts.y, tocY) * (1.0 - step(uTocRowEnds.y, tocY));
  float r2 = step(uTocRowStarts.z, tocY) * (1.0 - step(uTocRowEnds.z, tocY));
  float h0 = 1.0 - step(0.5, abs(uTocHoverRow - 0.0));
  float h1 = 1.0 - step(0.5, abs(uTocHoverRow - 1.0));
  float h2 = 1.0 - step(0.5, abs(uTocHoverRow - 2.0));
  float a0 = 1.0 - step(0.5, abs(uTocActiveRow - 0.0));
  float a1 = 1.0 - step(0.5, abs(uTocActiveRow - 1.0));
  float a2 = 1.0 - step(0.5, abs(uTocActiveRow - 2.0));
  float rowGlow = max(max(r0 * (h0 * 0.82 + a0 * 0.34), r1 * (h1 * 0.82 + a1 * 0.34)), r2 * (h2 * 0.82 + a2 * 0.34));
  float xFade = smoothstep(0.055, 0.14, tocX) * (1.0 - smoothstep(0.86, 0.945, tocX));
  diffuseColor.rgb = mix(diffuseColor.rgb, uTocGlowColor, rowGlow * xFade * 0.20);
}
#endif`
      );
      material.userData.contentsHighlightShader = shader;
    };
    material.customProgramCacheKey = () => 'mathgic-toc-highlight-v1';
  }

  _setContentsHighlight(chapterId, pageMesh = null) {
    const leftRow = pageMesh === this.leftPageMesh && chapterId
      ? this.contentsLeftCanvas.rowForChapterId(chapterId) : -1;
    const rightRow = pageMesh === this.rightPageMesh && chapterId
      ? this.contentsRightCanvas.rowForChapterId(chapterId) : -1;
    const leftUniforms = this.leftPageMat?.userData?.contentsHighlightUniforms;
    const rightUniforms = this.rightPageMat?.userData?.contentsHighlightUniforms;
    if (leftUniforms) leftUniforms.hoverRow.value = leftRow;
    if (rightUniforms) rightUniforms.hoverRow.value = rightRow;
  }

  /* =========================================================================
     3D GEOMETRY: BEVELED HARDCOVER BOARDS, HOLLOW SPINE & CURVED PAGES
     ========================================================================= */
  _evalCoverBoard(side, u, zNorm) {
    const liftAngle = ((5.6 * Math.PI) / 180) * this.coverWarpScale;
    const x = side * (this.HINGE_X + u * this.BOARD_W * Math.cos(liftAngle));

    const midSag = -0.055 * Math.sin(u * Math.PI) * this.coverWarpScale;
    const outerCurl = 0.042 * Math.pow(u, 2.2) * this.coverWarpScale;
    const cornerWarp = 0.026 * Math.pow(u, 1.7) * (zNorm * zNorm) * this.coverWarpScale;

    const yTop = 0.145 + u * this.BOARD_W * Math.sin(liftAngle) + midSag + outerCurl + cornerWarp;

    const edgeU = Math.max(0, (u - 0.965) / 0.035);
    const edgeZ = Math.max(0, (Math.abs(zNorm) - 0.965) / 0.035);
    const bevelFactor = Math.sqrt(Math.max(0, 1 - 0.55 * (edgeU * edgeU + edgeZ * edgeZ)));
    const localThick = this.BOARD_THICK * bevelFactor;

    return { x, yTop, yBottom: yTop - localThick };
  }

  _getSupportHeightAtX(x) {
    const absX = Math.abs(x);
    if (absX <= this.HINGE_X) {
      const t = absX / this.HINGE_X;
      return 0.255 - 0.11 * (t * t);
    }
    const liftAngle = ((5.6 * Math.PI) / 180) * this.coverWarpScale;
    const u = Math.min(1, (absX - this.HINGE_X) / (this.BOARD_W * Math.cos(liftAngle)));
    return this._evalCoverBoard(1, u, 0).yTop;
  }

  _sampleRestingCurve(uSteps, side) {
    const pts = [];
    let x = 0;
    let y = this._getSupportHeightAtX(0) + 0.005;
    const ds = this.PAGE_W / uSteps;

    const startAngle = ((61 * Math.PI) / 180) * this.archScale;
    const endAngle = ((-18 * Math.PI) / 180) * this.archScale;

    pts.push({ x: 0, y });
    for (let i = 1; i <= uSteps; i++) {
      const u = i / uSteps;
      const phi = startAngle * Math.pow(1 - u, 1.45) + endAngle * Math.pow(u, 1.12);
      x += side * Math.cos(phi) * ds;
      y += Math.sin(phi) * ds;

      const floorY = this._getSupportHeightAtX(x) + 0.024;
      pts.push({ x, y: Math.max(floorY, y) });
    }
    return pts;
  }

  _sampleFlipCurve(uSteps, p) {
    const pts = [];
    let x = 0;
    let y = this._getSupportHeightAtX(0) + 0.012;
    const ds = this.PAGE_W / uSteps;

    const startAngleR = ((61 * Math.PI) / 180) * this.archScale;
    const endAngleR = ((-18 * Math.PI) / 180) * this.archScale;

    pts.push({ x: 0, y });
    for (let i = 1; i <= uSteps; i++) {
      const u = i / uSteps;
      const localP = Math.max(0, Math.min(1, p * 1.26 - u * 0.26));
      const smoothP = localP * localP * (3 - 2 * localP);

      const phiR = startAngleR * Math.pow(1 - u, 1.45) + endAngleR * Math.pow(u, 1.12);
      const phiL = Math.PI - phiR;

      const billow = Math.sin(smoothP * Math.PI) * Math.sin(u * Math.PI) * 0.34;
      const phi = phiR + (phiL - phiR) * smoothP - billow;

      x += Math.cos(phi) * ds;
      y += Math.sin(phi) * ds;
      const floorY = this._getSupportHeightAtX(x) + 0.028;
      pts.push({ x, y: Math.max(floorY, y) });
    }
    return pts;
  }

  _buildBook() {
    this.bookGroup = new THREE.Group();
    // Kept as a direct child of the shared Engine scene so real depth testing
    // decides when the mathematical solid occludes the book.
    this.scene.add(this.bookGroup);
    this.openBookGroup = new THREE.Group();
    this.openBookGroup.name = 'OpenGrimoireSpread';
    this.bookGroup.add(this.openBookGroup);

    const clothTex = this._createCoverClothTextures();
    this.coverOuterMat = new THREE.MeshStandardMaterial({
      map: clothTex.map,
      bumpMap: clothTex.bumpMap,
      bumpScale: 0.014,
      roughness: 0.76,
      metalness: 0.1,
      // The outer cloth must remain visible through the final hinge pose even
      // when a platform's winding/back-face convention differs.
      side: THREE.DoubleSide
    });

    const endpaperLeftMat = new THREE.MeshStandardMaterial({
      map: this._createEndpaperTexture(true),
      roughness: 0.85
    });
    const endpaperRightMat = new THREE.MeshStandardMaterial({
      map: this._createEndpaperTexture(false),
      roughness: 0.85
    });

    this.leftBoardGroup = this._createBeveledBoardMesh(-1, endpaperLeftMat);
    this.rightBoardGroup = this._createBeveledBoardMesh(1, endpaperRightMat);

    // Reading orientation: the left board is the FRONT cover. It swings across
    // the spread onto the right/back board. Its outer cloth face is the lower
    // shell in the open pose and therefore faces the camera once folded over.
    this.frontCoverPivot = new THREE.Group();
    this.frontCoverPivot.name = 'FrontCoverHinge';
    this.frontCoverPivot.position.set(0, 0.26, 0);
    this.leftBoardGroup.position.y = -0.26;
    this.frontCoverPivot.add(this.leftBoardGroup);
    // The right board is the stationary back cover.
    this.openBookGroup.add(this.frontCoverPivot, this.rightBoardGroup);
    this.openBookGroup.add(this._createSpineMesh());
    this.openBookGroup.add(this._createHeadbandMesh());

    // The left half of the paper block folds together with the front cover;
    // the right half is the stationary back-cover side. This gives the closed
    // book the correct reading orientation and keeps the front board on top.
    const stackMat = this._createPaperStackMaterial();
    this.paperStackMat = stackMat;
    this.leftBlockGeo = this._buildPageBlockGeometry(-1);
    this.rightBlockGeo = this._buildPageBlockGeometry(1);
    this.leftBlockMesh = new THREE.Mesh(this.leftBlockGeo, stackMat);
    this.rightBlockMesh = new THREE.Mesh(this.rightBlockGeo, stackMat);
    [this.leftBlockMesh, this.rightBlockMesh].forEach((mesh) => {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    this.openBookGroup.add(this.rightBlockMesh);
    this.leftPagesPivot = new THREE.Group();
    this.leftPagesPivot.name = 'FrontPageBlockHinge';
    this.leftPagesPivot.position.set(0, 0.26, 0);
    this.leftBlockMesh.position.y = -0.26;
    this.leftPagesPivot.add(this.leftBlockMesh);
    this.openBookGroup.add(this.leftPagesPivot);

    // Chapter page textures and the two one-time painted Prologue table-of-contents textures.
    this.pageLeftCanvas = this._createStaticPageCanvas(true);
    this.pageRightCanvas = this._createStaticPageCanvas(false);
    this.contentsLeftCanvas = this._createContentsPageCanvas(true);
    this.contentsRightCanvas = this._createContentsPageCanvas(false);
    this.flipFrontCanvas = this._createStaticPageCanvas(false);
    this.flipBackCanvas = this._createStaticPageCanvas(true);

    // DoubleSide keeps both printed page meshes raycastable from the overhead
    // Prologue camera and from the inclined reading camera without changing their appearance.
    this.leftPageMat = new THREE.MeshStandardMaterial({ map: this.pageLeftCanvas.texture, roughness: 0.92, side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: true });
    this.rightPageMat = new THREE.MeshStandardMaterial({ map: this.pageRightCanvas.texture, roughness: 0.92, side: THREE.DoubleSide, transparent: true, opacity: 1, depthWrite: true });
    this._installContentsHighlight(this.leftPageMat);
    this._installContentsHighlight(this.rightPageMat);
    this.leftPageGeo = this._createCurvedSheetGeometry(true);
    this.rightPageGeo = this._createCurvedSheetGeometry(false);
    this.leftPageMesh = new THREE.Mesh(this.leftPageGeo, this.leftPageMat);
    this.rightPageMesh = new THREE.Mesh(this.rightPageGeo, this.rightPageMat);
    this.leftPageMesh.receiveShadow = true;
    this.rightPageMesh.receiveShadow = true;
    this.openBookGroup.add(this.rightPageMesh);

    // The left printed leaf folds with the front cover; the right leaf stays
    // attached to the stationary back-cover side.
    this.leftPagePivot = new THREE.Group();
    this.leftPagePivot.name = 'FrontPrintedLeafHinge';
    this.leftPagePivot.position.set(0, 0.26, 0);
    this.leftPageMesh.position.y = -0.26;
    this.leftPagePivot.add(this.leftPageMesh);
    this.openBookGroup.add(this.leftPagePivot);

    // Deformable two-sided leaf used for the eased 950ms physical page-turn animation.
    this.flipGroup = new THREE.Group();
    this.flipGroup.visible = false;
    this.openBookGroup.add(this.flipGroup);
    this.flipFrontMat = new THREE.MeshStandardMaterial({
      map: this.flipFrontCanvas.texture, roughness: 0.9, side: THREE.FrontSide
    });
    this.flipBackMat = new THREE.MeshStandardMaterial({
      map: this.flipBackCanvas.texture, roughness: 0.9, side: THREE.BackSide
    });
    this.flipFrontGeo = this._createCurvedSheetGeometry(false);
    // FrontSide and BackSide material passes can share one deforming buffer.
    // This halves the flip-leaf vertex and normal work on every turn frame.
    this.flipBackGeo = this.flipFrontGeo;
    const flipFrontMesh = new THREE.Mesh(this.flipFrontGeo, this.flipFrontMat);
    const flipBackMesh = new THREE.Mesh(this.flipBackGeo, this.flipBackMat);
    flipFrontMesh.castShadow = true;
    flipFrontMesh.receiveShadow = true;
    flipBackMesh.castShadow = true;
    flipBackMesh.receiveShadow = true;
    this.flipGroup.add(flipFrontMesh, flipBackMesh);
    this.contentsMode = false;
    this.pendingContentsMode = null;
    this._contentsHoverId = null;
    this._contentsHoverChanges = 0;
    this._scheduleContentsTextureWarmup();
  }

  /** Upload the two immutable TOC textures during idle time, not on first hover/click. */
  _scheduleContentsTextureWarmup() {
    const warm = () => {
      this._tocWarmupTimer = null;
      this._tocWarmupHandle = null;
      if (!this.renderer || this._tocTexturesWarmed) return;
      const textures = [this.contentsLeftCanvas?.texture, this.contentsRightCanvas?.texture].filter(Boolean);
      textures.forEach((texture) => this.renderer.initTexture?.(texture));
      this._tocTexturesWarmed = true;
    };
    if (typeof window.requestIdleCallback === 'function') {
      this._tocWarmupTimer = window.setTimeout(() => {
        this._tocWarmupTimer = null;
        this._tocWarmupHandle = window.requestIdleCallback(warm, { timeout: 1800 });
      }, 420);
    } else {
      this._tocWarmupTimer = window.setTimeout(warm, 700);
    }
  }

  _cancelContentsTextureWarmup() {
    if (this._tocWarmupTimer) {
      window.clearTimeout(this._tocWarmupTimer);
      this._tocWarmupTimer = null;
    }
    if (this._tocWarmupHandle) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(this._tocWarmupHandle);
      this._tocWarmupHandle = null;
    }
  }

  _createBeveledBoardMesh(side, topMat) {
    const nu = 44, nv = 20;
    const topGeo = new THREE.BufferGeometry();
    const shellGeo = new THREE.BufferGeometry();

    const topPos = new Float32Array((nu + 1) * (nv + 1) * 3);
    const topUV = new Float32Array((nu + 1) * (nv + 1) * 2);
    const topIdx = [];

    let p = 0;
    for (let iv = 0; iv <= nv; iv++) {
      const v = iv / nv;
      const zNorm = v * 2 - 1;
      const z = zNorm * (this.BOARD_D / 2);
      for (let iu = 0; iu <= nu; iu++) {
        const u = iu / nu;
        const pt = this._evalCoverBoard(side, u, zNorm);
        topPos[p * 3] = pt.x;
        topPos[p * 3 + 1] = pt.yTop;
        topPos[p * 3 + 2] = z;
        topUV[p * 2] = side === -1 ? 1 - u : u;
        topUV[p * 2 + 1] = 1 - v;
        p++;
      }
    }

    for (let iv = 0; iv < nv; iv++) {
      for (let iu = 0; iu < nu; iu++) {
        const a = iv * (nu + 1) + iu, b = a + 1, c = (iv + 1) * (nu + 1) + iu, d = c + 1;
        if (side === 1) topIdx.push(a, c, b, b, c, d);
        else topIdx.push(a, b, c, b, d, c);
      }
    }
    topGeo.setAttribute('position', new THREE.BufferAttribute(topPos, 3));
    topGeo.setAttribute('uv', new THREE.BufferAttribute(topUV, 2));
    topGeo.setIndex(topIdx);
    topGeo.computeVertexNormals();

    const botPos = new Float32Array((nu + 1) * (nv + 1) * 3);
    const botUV = new Float32Array((nu + 1) * (nv + 1) * 2);
    const botIdx = [];
    p = 0;
    for (let iv = 0; iv <= nv; iv++) {
      const v = iv / nv;
      const zNorm = v * 2 - 1;
      const z = zNorm * (this.BOARD_D / 2);
      for (let iu = 0; iu <= nu; iu++) {
        const u = iu / nu;
        const pt = this._evalCoverBoard(side, u, zNorm);
        botPos[p * 3] = pt.x;
        botPos[p * 3 + 1] = pt.yBottom;
        botPos[p * 3 + 2] = z;
        botUV[p * 2] = u;
        botUV[p * 2 + 1] = v;
        p++;
      }
    }
    for (let iv = 0; iv < nv; iv++) {
      for (let iu = 0; iu < nu; iu++) {
        const a = iv * (nu + 1) + iu, b = a + 1, c = (iv + 1) * (nu + 1) + iu, d = c + 1;
        if (side === 1) botIdx.push(a, b, c, b, d, c);
        else botIdx.push(a, c, b, b, c, d);
      }
    }

    const rimPositions = [], rimUVs = [], rimIndices = [];
    const addRimStrip = (ringPts, flip) => {
      const base = rimPositions.length / 3;
      for (let i = 0; i < ringPts.length; i++) {
        const { x, yT, yB, z, t } = ringPts[i];
        rimPositions.push(x, yT, z, x, yB, z);
        rimUVs.push(t * 4, 1, t * 4, 0);
      }
      for (let i = 0; i < ringPts.length - 1; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (!flip) rimIndices.push(a, b, c, c, b, d);
        else rimIndices.push(a, c, b, c, d, b);
      }
    };

    const frontRing = [], backRing = [];
    for (let iu = 0; iu <= nu; iu++) {
      const u = iu / nu;
      const ptF = this._evalCoverBoard(side, u, 1);
      const ptB = this._evalCoverBoard(side, u, -1);
      frontRing.push({ x: ptF.x, yT: ptF.yTop, yB: ptF.yBottom, z: this.BOARD_D / 2, t: u });
      backRing.push({ x: ptB.x, yT: ptB.yTop, yB: ptB.yBottom, z: -this.BOARD_D / 2, t: u });
    }
    addRimStrip(frontRing, side !== 1);
    addRimStrip(backRing, side === 1);

    const outerRing = [], innerRing = [];
    for (let iv = 0; iv <= nv; iv++) {
      const v = iv / nv;
      const zNorm = v * 2 - 1;
      const z = zNorm * (this.BOARD_D / 2);
      const ptOut = this._evalCoverBoard(side, 1, zNorm);
      const ptIn = this._evalCoverBoard(side, 0, zNorm);
      outerRing.push({ x: ptOut.x, yT: ptOut.yTop, yB: ptOut.yBottom, z, t: v });
      innerRing.push({ x: ptIn.x, yT: ptIn.yTop, yB: ptIn.yBottom, z, t: v });
    }
    addRimStrip(outerRing, side === 1);
    addRimStrip(innerRing, side !== 1);

    shellGeo.setAttribute('position', new THREE.BufferAttribute(botPos, 3));
    shellGeo.setAttribute('uv', new THREE.BufferAttribute(botUV, 2));
    shellGeo.setIndex(botIdx);
    shellGeo.computeVertexNormals();

    const rimGeo = new THREE.BufferGeometry();
    rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimPositions, 3));
    rimGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rimUVs, 2));
    rimGeo.setIndex(rimIndices);
    rimGeo.computeVertexNormals();

    const group = new THREE.Group();
    const topMesh = new THREE.Mesh(topGeo, topMat);
    const botMesh = new THREE.Mesh(shellGeo, this.coverOuterMat);
    const rimMesh = new THREE.Mesh(rimGeo, this.coverOuterMat);
    topMesh.name = side < 0 ? 'FrontCoverInnerSurface' : 'BackCoverInnerSurface';
    botMesh.name = side < 0 ? 'FrontCoverOuterSurface' : 'BackCoverOuterSurface';
    rimMesh.name = side < 0 ? 'FrontCoverRim' : 'BackCoverRim';
    topMesh.receiveShadow = true;
    botMesh.castShadow = true;
    rimMesh.castShadow = true;
    rimMesh.receiveShadow = true;
    group.add(topMesh, botMesh, rimMesh);
    return group;
  }

  _createSpineMesh() {
    const segs = 40;
    const geo = new THREE.BufferGeometry();
    const positions = [], uvs = [], indices = [];

    const spineProfile = (t) => {
      const x = t * this.HINGE_X;
      const absT = Math.abs(t);
      let yTop, yBot;
      if (absT > 0.72) {
        const g = (absT - 0.72) / 0.28;
        yTop = 0.095 + 0.05 * g;
        yBot = 0.02 + 0.03 * g;
      } else {
        const s = absT / 0.72;
        yTop = 0.072 + 0.023 * (s * s);
        yBot = 0.0 + 0.02 * (s * s);
      }
      return { x, yTop, yBot };
    };

    const zF = this.BOARD_D / 2, zB = -this.BOARD_D / 2;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const { x, yTop, yBot } = spineProfile(u * 2 - 1);
      positions.push(x, yTop, zF, x, yBot, zF, x, yTop, zB, x, yBot, zB);
      uvs.push(u * 2, 1, u * 2, 0, u * 2, 1, u * 2, 0);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 4, b = a + 1, c = a + 2, d = a + 3;
      const e = a + 4, f = a + 5, g = a + 6, h = a + 7;
      indices.push(a, c, e, e, c, g, b, f, d, d, f, h, a, e, b, b, e, f, c, d, g, g, d, h);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, this.coverOuterMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  _createHeadbandMesh() {
    const segs = 28;
    const geo = new THREE.BufferGeometry();
    const pos = [], uvs = [], idx = [];
    const zF = this.PAGE_D / 2 + 0.015, zB = this.PAGE_D / 2 - 0.14;

    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const x = (u * 2 - 1) * (this.HINGE_X * 0.92);
      const yTop = this._getSupportHeightAtX(x) + 0.004;
      const yBot = yTop - 0.042;
      pos.push(x, yTop, zF, x, yBot, zF, x, yTop, zB, x, yBot, zB);
      uvs.push(u * 4, 1, u * 4, 0, u * 4, 1, u * 4, 0);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 4, b = a + 1, c = a + 2, d = a + 3;
      const e = a + 4, f = a + 5, g = a + 6, h = a + 7;
      idx.push(a, e, b, b, e, f, a, c, e, e, c, g);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    return new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: this._createHeadbandTexture(), roughness: 0.7 })
    );
  }

  _buildPageBlockGeometry(side) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array((this.SEG_U + 1) * 4 * 3 + 4 * 3);
    const uvs = new Float32Array((this.SEG_U + 1) * 4 * 2 + 4 * 2);
    const indices = [];

    for (let i = 0; i <= this.SEG_U; i++) {
      const u = i / this.SEG_U;
      uvs[i * 4] = u * 4;
      uvs[i * 4 + 1] = 1;
      uvs[i * 4 + 2] = u * 4;
      uvs[i * 4 + 3] = 0;

      const bOffset = (this.SEG_U + 1) * 2;
      uvs[(bOffset + i * 2) * 2] = u * 4;
      uvs[(bOffset + i * 2) * 2 + 1] = 1;
      uvs[(bOffset + i * 2 + 1) * 2] = u * 4;
      uvs[(bOffset + i * 2 + 1) * 2 + 1] = 0;
    }

    for (let i = 0; i < this.SEG_U; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side === 1) indices.push(a, b, c, c, b, d);
      else indices.push(a, c, b, c, d, b);

      const off = (this.SEG_U + 1) * 2;
      const a2 = off + i * 2, b2 = a2 + 1, c2 = a2 + 2, d2 = a2 + 3;
      if (side === 1) indices.push(a2, c2, b2, c2, d2, b2);
      else indices.push(a2, b2, c2, c2, b2, d2);
    }

    const fOff = (this.SEG_U + 1) * 4;
    uvs[fOff * 2] = 0;
    uvs[fOff * 2 + 1] = 1;
    uvs[(fOff + 1) * 2] = 0;
    uvs[(fOff + 1) * 2 + 1] = 0;
    uvs[(fOff + 2) * 2] = 4;
    uvs[(fOff + 2) * 2 + 1] = 1;
    uvs[(fOff + 3) * 2] = 4;
    uvs[(fOff + 3) * 2 + 1] = 0;
    if (side === 1) indices.push(fOff, fOff + 1, fOff + 2, fOff + 2, fOff + 1, fOff + 3);
    else indices.push(fOff, fOff + 2, fOff + 1, fOff + 2, fOff + 3, fOff + 1);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  _updateBlockGeometry(geo, curvePts) {
    const pos = geo.attributes.position.array;
    const zFront = this.PAGE_D / 2, zBack = -this.PAGE_D / 2;
    const off = (this.SEG_U + 1) * 2;

    for (let i = 0; i <= this.SEG_U; i++) {
      const pt = curvePts[i];
      const baseY = this._getSupportHeightAtX(pt.x);

      pos[i * 6] = pt.x;
      pos[i * 6 + 1] = pt.y - 0.003;
      pos[i * 6 + 2] = zFront;
      pos[i * 6 + 3] = pt.x;
      pos[i * 6 + 4] = baseY;
      pos[i * 6 + 5] = zFront;

      pos[(off + i * 2) * 3] = pt.x;
      pos[(off + i * 2) * 3 + 1] = pt.y - 0.003;
      pos[(off + i * 2) * 3 + 2] = zBack;
      pos[(off + i * 2 + 1) * 3] = pt.x;
      pos[(off + i * 2 + 1) * 3 + 1] = baseY;
      pos[(off + i * 2 + 1) * 3 + 2] = zBack;
    }

    const tip = curvePts[this.SEG_U];
    const tipBaseY = this._getSupportHeightAtX(tip.x);
    const fOff = (this.SEG_U + 1) * 4;
    pos[fOff * 3] = tip.x;
    pos[fOff * 3 + 1] = tip.y - 0.003;
    pos[fOff * 3 + 2] = zFront;
    pos[(fOff + 1) * 3] = tip.x;
    pos[(fOff + 1) * 3 + 1] = tipBaseY;
    pos[(fOff + 1) * 3 + 2] = zFront;
    pos[(fOff + 2) * 3] = tip.x;
    pos[(fOff + 2) * 3 + 1] = tip.y - 0.003;
    pos[(fOff + 2) * 3 + 2] = zBack;
    pos[(fOff + 3) * 3] = tip.x;
    pos[(fOff + 3) * 3 + 1] = tipBaseY;
    pos[(fOff + 3) * 3 + 2] = zBack;

    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  _createCurvedSheetGeometry(flipUVHorizontal = false) {
    const geo = new THREE.BufferGeometry();
    const count = (this.SEG_U + 1) * (this.SEG_V + 1);
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const indices = [];

    let ptr = 0;
    for (let iv = 0; iv <= this.SEG_V; iv++) {
      const v = iv / this.SEG_V;
      for (let iu = 0; iu <= this.SEG_U; iu++) {
        const u = iu / this.SEG_U;
        uvs[ptr * 2] = flipUVHorizontal ? 1 - u : u;
        uvs[ptr * 2 + 1] = 1 - v;
        ptr++;
      }
    }

    for (let iv = 0; iv < this.SEG_V; iv++) {
      for (let iu = 0; iu < this.SEG_U; iu++) {
        const a = iv * (this.SEG_U + 1) + iu, b = a + 1, c = (iv + 1) * (this.SEG_U + 1) + iu, d = c + 1;
        if (!flipUVHorizontal) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  _applyCurveToSheet(geo, curvePts, normalOffset = 0, { computeBounds = false } = {}) {
    const pos = geo.attributes.position.array;
    let ptr = 0;
    for (let iv = 0; iv <= this.SEG_V; iv++) {
      const z = (iv / this.SEG_V - 0.5) * this.PAGE_D;
      for (let iu = 0; iu <= this.SEG_U; iu++) {
        const pt = curvePts[iu];
        pos[ptr * 3] = pt.x;
        pos[ptr * 3 + 1] = pt.y + normalOffset;
        pos[ptr * 3 + 2] = z;
        ptr++;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    // The flip sheet stays inside a conservative page-sized sphere. Updating
    // the bound on every animation frame is unnecessary CPU work.
    if (computeBounds || !geo.boundingSphere) geo.computeBoundingSphere();
  }

  _rebuildAllGeometry() {
    const leftPts = this._sampleRestingCurve(this.SEG_U, -1);
    const rightPts = this._sampleRestingCurve(this.SEG_U, 1);
    this._applyCurveToSheet(this.leftPageGeo, leftPts);
    this._applyCurveToSheet(this.rightPageGeo, rightPts);
    this._updateBlockGeometry(this.leftBlockGeo, leftPts);
    this._updateBlockGeometry(this.rightBlockGeo, rightPts);
  }

  /** Cache open/closed page profiles once. During the cover animation we interpolate
   * existing GPU buffers rather than rebuilding meshes or creating a second book. */
  _cachePaperGeometryStates() {
    const refs = [this.leftPageGeo, this.rightPageGeo, this.leftBlockGeo, this.rightBlockGeo];
    const arch = this.archScale;
    this.archScale = 0.025;
    this._rebuildAllGeometry();
    this._paperFlatBuffers = refs.map((geo) => geo.attributes.position.array.slice());
    this._paperFlatNormalBuffers = refs.map((geo) => geo.attributes.normal.array.slice());

    this.archScale = arch;
    this._rebuildAllGeometry();
    this._paperOpenBuffers = refs.map((geo) => geo.attributes.position.array.slice());
    this._paperOpenNormalBuffers = refs.map((geo) => geo.attributes.normal.array.slice());
    this._paperGeometryRefs = refs;

    // One conservative bound encloses both cached profiles. During morphing we
    // only interpolate CPU buffers; normals and bounds are never recomputed per frame.
    refs.forEach((geo, index) => {
      const flat = this._paperFlatBuffers[index];
      const open = this._paperOpenBuffers[index];
      const min = new THREE.Vector3(Infinity, Infinity, Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < flat.length; i += 3) {
        min.x = Math.min(min.x, flat[i], open[i]);
        min.y = Math.min(min.y, flat[i + 1], open[i + 1]);
        min.z = Math.min(min.z, flat[i + 2], open[i + 2]);
        max.x = Math.max(max.x, flat[i], open[i]);
        max.y = Math.max(max.y, flat[i + 1], open[i + 1]);
        max.z = Math.max(max.z, flat[i + 2], open[i + 2]);
      }
      const box = new THREE.Box3(min, max);
      geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    });
    this.paperFlatten = 0;
  }

  _setPaperFlatten(amount) {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    if (!this._paperGeometryRefs || !this._paperFlatBuffers || !this._paperOpenBuffers) return;
    const inv = 1 - t;
    for (let index = 0; index < this._paperGeometryRefs.length; index++) {
      const geo = this._paperGeometryRefs[index];
      const positions = geo.attributes.position.array;
      const normals = geo.attributes.normal.array;
      const flat = this._paperFlatBuffers[index];
      const open = this._paperOpenBuffers[index];
      const flatNormals = this._paperFlatNormalBuffers[index];
      const openNormals = this._paperOpenNormalBuffers[index];
      for (let i = 0; i < positions.length; i++) {
        positions[i] = open[i] * inv + flat[i] * t;
        normals[i] = openNormals[i] * inv + flatNormals[i] * t;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.normal.needsUpdate = true;
    }
    this.paperFlatten = t;
  }

  /**
   * Prepare one closed-profile morph for the existing front-cover meshes.
   * The left cover is authored for the open spread. A 180° hinge rotation
   * reverses its vertical warp, so the stored closed profile compensates for
   * that inversion and places the outside cloth above the paper block.
   * All position/normal buffers are precomputed once, then interpolated in place.
   */
  _prepareFrontCoverMorph() {
    if (!this.leftBoardGroup) return;
    const lift = this.FRONT_COVER_LIFT;
    this._frontCoverMorphParts = [];
    const hingeLift = 0.52 + lift;
    const innerOffset = 0.08;
    const outerOffset = 0.015;
    const liftAngle = ((5.6 * Math.PI) / 180) * this.coverWarpScale;
    const widthScale = this.BOARD_W * Math.cos(liftAngle);

    for (const mesh of this.leftBoardGroup.children) {
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position) continue;
      const geometry = mesh.geometry;
      const position = geometry.attributes.position;
      const normal = geometry.attributes.normal;
      const openPositions = position.array.slice();
      const openNormals = normal?.array?.slice() || null;
      const closedPositions = openPositions.slice();
      const vertexCount = position.count;
      const isInner = mesh.name === 'FrontCoverInnerSurface';
      const isOuter = mesh.name === 'FrontCoverOuterSurface';

      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const offset = vertex * 3;
        const x = openPositions[offset];
        const z = openPositions[offset + 2];
        const u = THREE.MathUtils.clamp((Math.abs(x) - this.HINGE_X) / widthScale, 0, 1);
        const zNorm = THREE.MathUtils.clamp(z / (this.BOARD_D * 0.5), -1, 1);
        const topY = this._evalCoverBoard(-1, u, zNorm).yTop;

        let targetY;
        if (isInner) {
          // The inner endpaper becomes the underside of the folded cover.
          targetY = hingeLift - topY + innerOffset;
        } else if (isOuter) {
          // The outer cloth becomes the top face and clears the paper block.
          targetY = hingeLift - topY - outerOffset;
        } else {
          // Rim vertices are emitted in top/bottom pairs by _createBeveledBoardMesh.
          const isTopVertex = (vertex % 2) === 0;
          targetY = isTopVertex
            ? hingeLift - topY + innerOffset
            : hingeLift - topY - outerOffset;
        }
        closedPositions[offset + 1] = targetY;
      }

      // Calculate folded normals once and restore the open profile.
      position.array.set(closedPositions);
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      const closedNormals = geometry.attributes.normal.array.slice();
      position.array.set(openPositions);
      position.needsUpdate = true;
      if (openNormals && geometry.attributes.normal) {
        geometry.attributes.normal.array.set(openNormals);
        geometry.attributes.normal.needsUpdate = true;
      } else {
        geometry.computeVertexNormals();
      }

      this._frontCoverMorphParts.push({ geometry, openPositions, closedPositions, openNormals, closedNormals });
    }
    this.frontCoverFold = 0;
    this.leftBoardGroup.position.y = -0.26;
  }

  _setFrontCoverFold(amount) {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    if (!this._frontCoverMorphParts?.length) return;
    const inv = 1 - t;
    for (const part of this._frontCoverMorphParts) {
      const position = part.geometry.attributes.position;
      const target = position.array;
      const open = part.openPositions;
      const closed = part.closedPositions;
      for (let i = 0; i < target.length; i++) {
        target[i] = open[i] * inv + closed[i] * t;
      }
      position.needsUpdate = true;
      const normal = part.geometry.attributes.normal;
      if (normal && part.openNormals && part.closedNormals) {
        const values = normal.array;
        const nOpen = part.openNormals;
        const nClosed = part.closedNormals;
        for (let i = 0; i < values.length; i++) {
          values[i] = nOpen[i] * inv + nClosed[i] * t;
        }
        normal.needsUpdate = true;
      }
    }
    this.frontCoverFold = t;
    // Moving the child slightly toward the front-facing side creates a real
    // cover-over-pages stack when the hinge reaches its sealed pose.
    this.leftBoardGroup.position.y = -0.26 - this.FRONT_COVER_LIFT * t;
  }

  /**
   * Fade every paper-bearing surface as one coherent stack. During closing the
   * paper fades only after the front cover has travelled 75% of its hinge arc;
   * during opening the same curve is naturally reversed. Once fully hidden,
   * paper meshes are removed from the render list to prevent edge clipping.
   */
  _setPaperOpacity(value, { hideAtZero = true } = {}) {
    const opacity = THREE.MathUtils.clamp(value, 0, 1);
    const pageMaterials = [this.leftPageMat, this.rightPageMat];
    for (const material of pageMaterials) {
      if (!material) continue;
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = opacity > 0.985;
      material.needsUpdate = false;
    }
    if (this.paperStackMat) {
      this.paperStackMat.transparent = true;
      this.paperStackMat.opacity = opacity;
      this.paperStackMat.depthWrite = opacity > 0.985;
    }

    const visible = !hideAtZero || opacity > 0.008;
    if (this.leftPageMesh) this.leftPageMesh.visible = visible;
    if (this.rightPageMesh) this.rightPageMesh.visible = visible;
    if (this.leftBlockMesh) this.leftBlockMesh.visible = visible;
    if (this.rightBlockMesh) this.rightBlockMesh.visible = visible;
    this.paperOpacity = opacity;
  }

  _applyOpenPose() {
    this.frontCoverPivot.rotation.z = 0;
    this.leftPagesPivot.rotation.z = 0;
    this.leftPagePivot.rotation.z = 0;
    this._setFrontCoverFold(0);
    this._setPaperFlatten(0);
    this.frontCoverPivot.visible = true;
    this.leftBoardGroup.visible = true;
    this.rightBoardGroup.visible = true;
    this.leftBlockMesh.visible = true;
    this.rightBlockMesh.visible = true;
    this.leftPageMesh.visible = true;
    this.rightPageMesh.visible = true;
    this._setPaperOpacity(1, { hideAtZero: false });
    if (this.flipGroup) this.flipGroup.visible = false;
    this.openBookGroup.visible = true;
    this.bookGroup.visible = !this.focusHidden;
    if (this.bookLights) this.bookLights.visible = !this.focusHidden;
    this._poseCenterBlend = 1;
    this.bookGroup.updateMatrixWorld(true);
  }

  _applySealedPose() {
    this.frontCoverPivot.rotation.z = -Math.PI;
    this.leftPagesPivot.rotation.z = -Math.PI;
    this.leftPagePivot.rotation.z = -Math.PI;
    this._setFrontCoverFold(1);
    this._setPaperFlatten(1);
    this.frontCoverPivot.visible = true;
    this.leftBoardGroup.visible = true;
    // The back board and the folded duplicate page block sit underneath the
    // closed front cover; showing them from above creates the extra black slabs
    // that appeared in the previous Sealed View.
    this.rightBoardGroup.visible = false;
    this.leftBlockMesh.visible = false;
    this.rightBlockMesh.visible = false;
    this.leftPageMesh.visible = false;
    this.rightPageMesh.visible = false;
    this._setPaperOpacity(0, { hideAtZero: true });
    if (this.flipGroup) this.flipGroup.visible = false;
    this.openBookGroup.visible = true;
    this.bookGroup.visible = !this.focusHidden;
    if (this.bookLights) this.bookLights.visible = !this.focusHidden;
    this._poseCenterBlend = 0;
    this.bookGroup.updateMatrixWorld(true);
  }

  _cacheBookPoseCenters() {
    if (!this.openBookGroup || !this.frontCoverPivot || !this.leftPagesPivot || !this.leftPagePivot) return;
    const saved = {
      cover: this.frontCoverPivot.rotation.z,
      pages: this.leftPagesPivot.rotation.z,
      leaf: this.leftPagePivot.rotation.z,
      flatten: this.paperFlatten,
      fold: this.frontCoverFold ?? 0,
      paperOpacity: this.paperOpacity ?? 1,
      stackTransparent: this.paperStackMat?.transparent ?? false,
      stackDepthWrite: this.paperStackMat?.depthWrite ?? true,
      vis: {
        book: this.bookGroup.visible,
        open: this.openBookGroup.visible,
        front: this.frontCoverPivot.visible,
        leftBoard: this.leftBoardGroup.visible,
        rightBoard: this.rightBoardGroup.visible,
        leftBlock: this.leftBlockMesh.visible,
        rightBlock: this.rightBlockMesh.visible,
        leftPage: this.leftPageMesh.visible,
        rightPage: this.rightPageMesh.visible
      }
    };
    const capture = (sealed) => {
      this.frontCoverPivot.rotation.z = sealed ? -Math.PI : 0;
      this.leftPagesPivot.rotation.z = sealed ? -Math.PI : 0;
      this.leftPagePivot.rotation.z = sealed ? -Math.PI : 0;
      this._setFrontCoverFold(sealed ? 1 : 0);
      this._setPaperFlatten(sealed ? 1 : 0);
      this.frontCoverPivot.visible = true;
      this.leftBoardGroup.visible = true;
      this.rightBoardGroup.visible = !sealed;
      this.leftBlockMesh.visible = !sealed;
      this.rightBlockMesh.visible = !sealed;
      this.leftPageMesh.visible = !sealed;
      this.rightPageMesh.visible = !sealed;
      this._setPaperOpacity(sealed ? 0 : 1, { hideAtZero: true });
      this.openBookGroup.visible = true;
      this.bookGroup.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(this.openBookGroup);
      const worldCenter = bounds.getCenter(new THREE.Vector3());
      return this.bookGroup.worldToLocal(worldCenter.clone());
    };
    this._poseCenters.sealed.copy(capture(true));
    this._poseCenters.open.copy(capture(false));

    this.frontCoverPivot.rotation.z = saved.cover;
    this.leftPagesPivot.rotation.z = saved.pages;
    this.leftPagePivot.rotation.z = saved.leaf;
    this._setFrontCoverFold(saved.fold);
    this._setPaperFlatten(saved.flatten ?? 1);
    this._setPaperOpacity(saved.paperOpacity ?? 1, { hideAtZero: true });
    if (this.paperStackMat) {
      this.paperStackMat.transparent = saved.stackTransparent;
      this.paperStackMat.depthWrite = saved.stackDepthWrite;
    }
    this.bookGroup.visible = saved.vis.book;
    this.openBookGroup.visible = saved.vis.open;
    this.frontCoverPivot.visible = saved.vis.front;
    this.leftBoardGroup.visible = saved.vis.leftBoard;
    this.rightBoardGroup.visible = saved.vis.rightBoard;
    this.leftBlockMesh.visible = saved.vis.leftBlock;
    this.rightBlockMesh.visible = saved.vis.rightBlock;
    this.leftPageMesh.visible = saved.vis.leftPage;
    this.rightPageMesh.visible = saved.vis.rightPage;
    this.bookGroup.updateMatrixWorld(true);
  }

  /* =========================================================================
     PUBLIC API: SHARED-SCENE BOOK + PHYSICAL PAGE FLIP
     ========================================================================= */
  setOpen(isOpen) {
    const next = !!isOpen;
    if (next === this.opened && !this.coverTransition) return;
    this.opened = next;
    if (!next) {
      this.flipState = null;
      if (this.flipGroup) this.flipGroup.visible = false;
    } else {
      // Restore the parts hidden by the sealed pose before the same physical
      // cover and page stack begin unfolding; no model swap is involved.
      this.openBookGroup.visible = true;
      this.frontCoverPivot.visible = true;
      this.leftBoardGroup.visible = true;
      this.rightBoardGroup.visible = true;
      this.leftBlockMesh.visible = true;
      this.rightBlockMesh.visible = true;
      this.leftPageMesh.visible = true;
      this.rightPageMesh.visible = true;
      this._setPaperOpacity(0, { hideAtZero: false });
      this._setFrontCoverFold(this.frontCoverFold ?? 1);
    }
    this.bookGroup.visible = !this.focusHidden;
    if (this.bookLights) this.bookLights.visible = !this.focusHidden;
    if (this.renderer?.domElement) this.renderer.domElement.style.cursor = 'default';
    this._animateCoverTransition(next);
    this.updateAnchor();
  }

  setPose(mode = 'chapter') {
    this.poseMode = mode === 'sealed' ? 'sealed' : (mode === 'top-down' ? 'top-down' : 'chapter');
    this.updateAnchor();
  }

  setFocusHidden(hidden) {
    this.focusHidden = !!hidden;
    if (this.bookGroup) this.bookGroup.visible = !this.focusHidden;
    if (this.bookLights) this.bookLights.visible = !this.focusHidden;
  }

  _animateCoverTransition(opening) {
    const duration = opening ? 1.72 : 1.92;
    this.coverTransition = {
      opening,
      elapsed: 0,
      duration,
      fromCover: this.frontCoverPivot.rotation.z,
      fromPages: this.leftPagesPivot.rotation.z,
      fromLeaf: this.leftPagePivot.rotation.z,
      fromFlatten: this.paperFlatten ?? (opening ? 1 : 0),
      fromFold: this.frontCoverFold ?? (opening ? 1 : 0),
      to: opening ? 0 : -Math.PI
    };
    this.bookGroup.visible = !this.focusHidden;
    this.openBookGroup.visible = true;
    this.frontCoverPivot.visible = true;
    this.leftBoardGroup.visible = true;
    this.rightBoardGroup.visible = true;
    this.leftBlockMesh.visible = true;
    this.rightBlockMesh.visible = true;
    this.leftPageMesh.visible = true;
    this.rightPageMesh.visible = true;
    this._setPaperOpacity(opening ? 0 : 1, { hideAtZero: false });
  }

  /** Called once per Engine frame; no independent book requestAnimationFrame. */
  updateAnimation(delta) {
    if (this.coverTransition) {
      const state = this.coverTransition;
      state.elapsed = Math.min(state.duration, state.elapsed + delta);
      const t = THREE.MathUtils.clamp(state.elapsed / state.duration, 0, 1);
      const ease = (x) => {
        const v = THREE.MathUtils.clamp(x, 0, 1);
        return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
      };
      const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
      // Let the page block gather first, then fold the cover over it. On open,
      // reverse the same choreography. The front-cover geometry morphs to a
      // complementary closed profile so its outer cloth lands flush over paper.
      const coverT = state.opening
        ? ease((t - 0.015) / 0.70)
        : ease((t - 0.30) / 0.70);
      const pagesT = state.opening
        ? ease((t - 0.10) / 0.90)
        : ease(t / 0.60);
      const flattenT = state.opening ? smooth(0.08, 0.96, t) : smooth(0.0, 0.62, t);
      const foldTarget = state.opening ? 0 : 1;
      const foldT = THREE.MathUtils.lerp(state.fromFold, foldTarget, coverT);

      this.frontCoverPivot.rotation.z = THREE.MathUtils.lerp(state.fromCover, state.to, coverT);
      this.leftPagesPivot.rotation.z = THREE.MathUtils.lerp(state.fromPages, state.to, pagesT);
      this.leftPagePivot.rotation.z = THREE.MathUtils.lerp(state.fromLeaf, state.to, pagesT);
      this._setFrontCoverFold(foldT);
      this._setPaperFlatten(THREE.MathUtils.lerp(state.fromFlatten, state.opening ? 0 : 1, flattenT));

      // Use the real hinge travel, not wall-clock transition time: paper remains
      // visible until the cover has completed 75% of its closing arc, then fades
      // over a short 0.18s-equivalent hinge window. Opening reverses this curve.
      const closedProgress = THREE.MathUtils.clamp(Math.abs(this.frontCoverPivot.rotation.z) / Math.PI, 0, 1);
      const paperOpacity = 1 - THREE.MathUtils.smoothstep(closedProgress, 0.75, 0.90);
      this._setPaperOpacity(paperOpacity, { hideAtZero: true });
      this._poseCenterBlend = state.opening ? ease(t) : 1 - ease(t);

      if (t >= 1) {
        if (state.opening) this._applyOpenPose();
        else this._applySealedPose();
        if (state.opening) this._setPaperOpacity(1, { hideAtZero: false });
        else this._setPaperOpacity(0, { hideAtZero: true });
        this.bookGroup.visible = !this.focusHidden;
        this.coverTransition = null;
      }
    }

    if (this.flipState && this.opened) {
      const state = this.flipState;
      state.elapsed = Math.min(state.duration, state.elapsed + delta * 1000);
      const linear = THREE.MathUtils.clamp(state.elapsed / state.duration, 0, 1);
      const eased = linear < 0.5
        ? 4 * linear * linear * linear
        : 1 - Math.pow(-2 * linear + 2, 3) / 2;
      state.progress = state.dir > 0 ? eased : 1 - eased;
      const progress = THREE.MathUtils.clamp(state.progress, 0.001, 0.999);
      const points = this._sampleFlipCurve(this.SEG_U, progress);
      // The front/back meshes share one geometry, so deform and compute normals once.
      this._applyCurveToSheet(this.flipFrontGeo, points, 0.003, { computeBounds: false });
      if (linear >= 1) this.finishFlip();
    }
  }

  setContentsMode(enabled, { defer = false } = {}) {
    const next = !!enabled;
    if (defer) {
      this.pendingContentsMode = next;
      return;
    }
    this.contentsMode = next;
    this.pendingContentsMode = null;
    if (!this.leftPageMat || !this.rightPageMat) return;
    // All page variants are CanvasTextures, so the shader program stays identical.
    // Swap only the sampler texture; do not trigger a material recompile on every
    // Prologue entry/exit.
    this.leftPageMat.map = next ? this.contentsLeftCanvas.texture : this.pageLeftCanvas.texture;
    this.rightPageMat.map = next ? this.contentsRightCanvas.texture : this.pageRightCanvas.texture;
    this._contentsHoverId = null;
    const leftHighlight = this.leftPageMat.userData.contentsHighlightUniforms;
    const rightHighlight = this.rightPageMat.userData.contentsHighlightUniforms;
    if (leftHighlight) { leftHighlight.enabled.value = next ? 1 : 0; leftHighlight.hoverRow.value = -1; }
    if (rightHighlight) { rightHighlight.enabled.value = next ? 1 : 0; rightHighlight.hoverRow.value = -1; }
    if (this.renderer?.domElement) this.renderer.domElement.style.cursor = 'default';
  }

  _chapterAtPageHit(hit) {
    if (!this.contentsMode || !hit?.uv) return null;
    const onLeft = hit.object === this.leftPageMesh;
    if (!onLeft && hit.object !== this.rightPageMesh) return null;

    // The page geometry deliberately encodes the printed reading direction in
    // its UVs: the left sheet's U axis is mirrored, while the right sheet's is
    // normal. Therefore hit.uv.x already maps to the CanvasTexture's horizontal
    // coordinate on both pages. Geometry V is 1 at the printed top edge, so
    // invert it to the canvas's top-origin Y coordinate. This also respects the
    // curved page profile (unlike deriving U from local X, which is nonlinear).
    const point = {
      x: THREE.MathUtils.clamp(hit.uv.x, 0, 1),
      y: THREE.MathUtils.clamp(1 - hit.uv.y, 0, 1)
    };
    return onLeft
      ? this.contentsLeftCanvas.chapterAt(point)
      : this.contentsRightCanvas.chapterAt(point);
  }

  handlePageHover(hit) {
    if (!this.contentsMode || !this.opened) return;
    const chapterId = this._chapterAtPageHit(hit);
    const pageMesh = hit?.object === this.leftPageMesh || hit?.object === this.rightPageMesh ? hit.object : null;
    const hoverKey = chapterId ? `${chapterId}:${pageMesh === this.leftPageMesh ? 'L' : 'R'}` : null;
    if (hoverKey === this._contentsHoverId) return;
    this._contentsHoverId = hoverKey;
    this._contentsHoverChanges++;
    if (this.renderer?.domElement) this.renderer.domElement.style.cursor = chapterId ? 'pointer' : 'default';
    // Hover only changes two scalar shader uniforms. The printed page textures
    // are immutable after creation and are never re-uploaded while moving the pointer.
    this._setContentsHighlight(chapterId, pageMesh);
  }

  clearPageHover() {
    if (!this.contentsMode || !this._contentsHoverId) return;
    this._contentsHoverId = null;
    if (this.renderer?.domElement) this.renderer.domElement.style.cursor = 'default';
    this._setContentsHighlight(null, null);
  }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme };
    if (!this.flipState) {
      this.pageLeftCanvas?.render(this.theme);
      this.pageRightCanvas?.render(this.theme);
      if (!this.contentsMode) {
        if (this.leftPageMat) this.leftPageMat.map = this.pageLeftCanvas.texture;
        if (this.rightPageMat) this.rightPageMat.map = this.pageRightCanvas.texture;
      }
    }
  }

  /**
   * Place the shared-scene book where Build 11's book-stage used to be.
   * The transparent DOM stage is a projection reference only: its dimensions and
   * the page dock position reproduce the old bottom-centred layout. The book itself
   * remains a normal Engine-scene object, so solids occlude it through the depth buffer.
   */
  /** Return the actual visual centre of the current book pose for camera framing. */
  getCameraAimPoint(mode = this.poseMode, out = new THREE.Vector3()) {
    if (!this.bookGroup) return out.set(0, 0, 0);
    this.bookGroup.updateMatrixWorld(true);
    const blend = THREE.MathUtils.clamp(this._poseCenterBlend ?? (mode === 'sealed' ? 0 : 1), 0, 1);
    this._anchorCenterLocal.copy(this._poseCenters.sealed).lerp(this._poseCenters.open, blend);
    return out.copy(this._anchorCenterLocal).applyMatrix4(this.bookGroup.matrixWorld);
  }

  updateAnchor(delta = 1 / 60) {
    if (!this.bookGroup || !this.camera || !this.engine?.renderer?.domElement) return;

    // The book is persistent outside Focus Mode. Do not force individual cover
    // or page meshes visible here: Sealed View intentionally hides the back board
    // and folded duplicate leaf beneath the front cover.
    this.bookGroup.visible = !this.focusHidden;

    const canvasRect = this.engine.renderer.domElement.getBoundingClientRect();
    if (!(canvasRect.width > 0 && canvasRect.height > 0)) return;
    const measuredStage = this.container?.getBoundingClientRect?.();
    const stageRect = measuredStage && measuredStage.width > 0 && measuredStage.height > 0
      ? measuredStage
      : { left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: canvasRect.height };

    this.camera.updateMatrixWorld(true);
    const overhead = this.poseMode === 'top-down' || this.poseMode === 'sealed';
    const dock = this.container.parentElement?.querySelector('.book-bottom-bar');
    const dockRect = dock?.getBoundingClientRect?.();

    const stageCenterX = stageRect.left + stageRect.width * 0.5;
    const stageCenterY = overhead
      ? stageRect.top + stageRect.height * 0.5
      : (dockRect && dockRect.height > 0
        ? dockRect.top + 8 - stageRect.height * 0.5
        : canvasRect.bottom - this.LEGACY_STAGE_BOTTOM - stageRect.height * 0.5);

    const visualAspect = this.poseMode === 'sealed'
      ? this.BOARD_W / this.BOARD_D
      : (this.PAGE_W * 2) / this.PAGE_D;
    const fitHeight = Math.min(stageRect.height, stageRect.width / visualAspect);
    const targetX = stageCenterX - (overhead ? 0 : this.LEGACY_BOOK_ORIGIN_NDC.x * stageRect.width * 0.5);
    const targetY = stageCenterY - (overhead ? 0 : this.LEGACY_BOOK_ORIGIN_NDC.y * stageRect.height * 0.5);
    const ndcX = ((targetX - canvasRect.left) / canvasRect.width) * 2 - 1;
    const ndcY = 1 - ((targetY - canvasRect.top) / canvasRect.height) * 2;

    // One-way camera rig: book position is derived from the stable camera target,
    // never used to calculate that target. Reuse vectors to avoid frame allocations.
    const rigTarget = this.engine?._cameraTargetTarget || this._anchorZero;
    const rigDistance = this.camera.position.distanceTo(rigTarget);
    const depth = Math.max(6.4, rigDistance + 2.8);
    const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const aspect = canvasRect.width / canvasRect.height;
    this._anchorLocalPoint.set(
      ndcX * depth * halfFovTangent * aspect,
      ndcY * depth * halfFovTangent,
      -depth
    );
    this._anchorWorldPoint.copy(this._anchorLocalPoint).applyMatrix4(this.camera.matrixWorld);
    this.bookGroup.position.copy(this._anchorWorldPoint);

    this._anchorChapterPose.copy(this.camera.quaternion).multiply(this.localBookRotation);
    this._anchorTargetPose.copy(this._anchorChapterPose);
    if (overhead) {
      this._anchorNormal.copy(this.camera.position).sub(this.bookGroup.position).normalize();
      this._anchorRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
      this._anchorPageDepthAxis.crossVectors(this._anchorRight, this._anchorNormal).normalize();
      this._anchorBasisMatrix.makeBasis(this._anchorRight, this._anchorNormal, this._anchorPageDepthAxis);
      this._anchorTargetPose.setFromRotationMatrix(this._anchorBasisMatrix);
    }
    if (!this._poseInitialized) {
      this.bookGroup.quaternion.copy(this._anchorTargetPose);
      this._poseInitialized = true;
    } else {
      this.bookGroup.quaternion.slerp(this._anchorTargetPose, 1 - Math.exp(-Math.max(0.001, delta) * 6.5));
    }

    const engineHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    let scale;
    if (overhead) {
      const worldHeight = this.poseMode === 'sealed' ? this.BOARD_D : this.PAGE_D;
      scale = (fitHeight / canvasRect.height) * (2 * depth * engineHalfFov) / worldHeight;
    } else {
      const oldHalfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.LEGACY_BOOK_FOV) * 0.5);
      scale = (stageRect.height / canvasRect.height)
        * (depth / this.LEGACY_BOOK_VIEW_DEPTH)
        * (engineHalfFov / oldHalfFovTangent);
    }
    this.bookGroup.scale.setScalar(scale);

    // Centre the visible physical mass for the current pose (closed cover vs spread).
    const blend = THREE.MathUtils.clamp(this._poseCenterBlend ?? (this.poseMode === 'sealed' ? 0 : 1), 0, 1);
    this._anchorCenterLocal.copy(this._poseCenters.sealed).lerp(this._poseCenters.open, blend);
    this._anchorCenterOffset.copy(this._anchorCenterLocal).multiplyScalar(scale).applyQuaternion(this.bookGroup.quaternion);
    this.bookGroup.position.sub(this._anchorCenterOffset);
    this.bookGroup.updateMatrixWorld(true);

    if (this.opened && this.poseMode === 'chapter') {
      const pageSurfaceY = this._getSupportHeightAtX(0) + 0.035;
      this._anchorPageWorldPoint.set(0, pageSurfaceY, 0).applyMatrix4(this.bookGroup.matrixWorld);
      this._anchorPageCameraPoint.copy(this._anchorPageWorldPoint).applyMatrix4(this.camera.matrixWorldInverse);
      const pageDepth = Math.max(0.1, -this._anchorPageCameraPoint.z);
      const modelDepth = Math.max(1.65, rigDistance - 0.08);
      const depthRatio = modelDepth / pageDepth;
      const hoverGap = 1.08;
      this._anchorStageCameraPoint.set(
        this._anchorPageCameraPoint.x * depthRatio,
        this._anchorPageCameraPoint.y * depthRatio + hoverGap,
        -modelDepth
      );
      this._anchorStageCameraPoint.applyMatrix4(this.camera.matrixWorld);
      this.engine.setFloatingStageAnchor(this._anchorStageCameraPoint);
    } else {
      this.engine.setFloatingStageAnchor(null);
    }
  }

  triggerFlip(dir, newTheme, { nextContents = this.contentsMode } = {}) {
    if (!this.opened) {
      this.setTheme(newTheme || {});
      return;
    }

    const previousTheme = { ...this.theme };
    if (newTheme) this.theme = { ...this.theme, ...newTheme };
    const direction = dir >= 0 ? 1 : -1;

    // Prepare each page texture once before the physical leaf starts moving.
    const leftTheme = direction > 0 ? previousTheme : this.theme;
    const rightTheme = direction > 0 ? this.theme : previousTheme;
    const frontTheme = direction > 0 ? previousTheme : this.theme;
    const backTheme = direction > 0 ? this.theme : previousTheme;
    this.pageLeftCanvas.render(leftTheme);
    this.pageRightCanvas.render(rightTheme);
    this.flipFrontCanvas.render(frontTheme);
    this.flipBackCanvas.render(backTheme);
    const frontMap = this.contentsMode
      ? (direction > 0 ? this.contentsRightCanvas.texture : this.contentsLeftCanvas.texture)
      : (direction > 0 ? this.pageRightCanvas.texture : this.pageLeftCanvas.texture);
    const backMap = nextContents
      ? (direction > 0 ? this.contentsLeftCanvas.texture : this.contentsRightCanvas.texture)
      : (direction > 0 ? this.pageLeftCanvas.texture : this.pageRightCanvas.texture);
    this.flipFrontMat.map = frontMap;
    this.flipBackMat.map = backMap;
    this.flipFrontMat.needsUpdate = true;
    this.flipBackMat.needsUpdate = true;
    this.pendingContentsMode = !!nextContents;

    this.flipState = {
      dir: direction,
      progress: direction > 0 ? 0 : 1,
      duration: 950 // slower physical page turn for a more deliberate paper motion
    };
    this.flipGroup.visible = true;
    this.flipStartedAt = null;
    this._startFlipAnimation();
  }

  finishFlip() {
    this.flipState = null;
    if (this.flipGroup) this.flipGroup.visible = false;
    if (this.opened) {
      if (this.pendingContentsMode !== null) this.setContentsMode(this.pendingContentsMode);
    }
    this.flipFrontMat.map = this.contentsMode ? this.contentsLeftCanvas.texture : this.pageLeftCanvas.texture;
    this.flipBackMat.map = this.contentsMode ? this.contentsRightCanvas.texture : this.pageRightCanvas.texture;
  }

  resize() {
    // The main Engine owns the only renderer and updates it on window resize.
    this.updateAnchor();
  }

  _renderOnce() {
    // Rendering is handled by Engine.start() for the entire shared scene.
  }

  _stopAnimation() {
    this.flipState = null;
    if (this.flipGroup) this.flipGroup.visible = false;
  }

  _startFlipAnimation() {
    // Compatibility entry point: Engine.updateAnimation() owns the actual turn.
    if (this.flipState) this.flipState.elapsed = 0;
  }

  _bindEvents() {
    // Pointer hit-testing is performed by the shared Engine raycaster so a
    // nearer solid naturally takes precedence over the book behind it.
  }

  handleRaycastHit(hit) {
    if (!this.opened || !hit?.point) return false;
    if (this.contentsMode) {
      const chapterId = this._chapterAtPageHit(hit);
      if (chapterId) {
        this.onChapterSelect?.(chapterId);
        return true;
      }
      // In Prologue only the printed entries are interactive; blank paper is inert.
      return hit.object === this.leftPageMesh || hit.object === this.rightPageMesh;
    }
    const localPoint = this.bookGroup.worldToLocal(hit.point.clone());
    if (localPoint.x < 0) this.onPrev?.();
    else this.onNext?.();
    return true;
  }

  dispose() {
    this._stopAnimation();
    this._cancelContentsTextureWarmup();
    this.coverTransition = null;
    if (this.bookGroup) this.scene.remove(this.bookGroup);
    if (this.bookLights) this.scene.remove(this.bookLights);
  }

}
