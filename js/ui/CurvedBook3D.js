import * as THREE from 'three';

/**
 * CurvedBook3D.js — book geometry embedded in the Engine scene.
 * It shares the Engine camera, renderer and depth buffer; only the page-turn deforms geometry.
 */
export class CurvedBook3D {
  constructor(engine, container, { onPrev, onNext } = {}) {
    this.engine = engine;
    this.container = container;
    this.onPrev = onPrev;
    this.onNext = onNext;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.renderer = engine.renderer;

    this.opened = false;
    this.theme = { id: 'elemental', primary: '#ff5722', secondary: '#fbbf24' };
    this.flipState = null;
    this.animationFrame = null;
    this.flipStartedAt = null;

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

    this.archScale = 0.80;
    this.coverWarpScale = 1.38;

    this._initScene();
    this._buildBook();
    this._rebuildAllGeometry();
    this.bookGroup.visible = false;
    this.bookLights.visible = false;
    // Keep culling per mesh and disable the world fog on the close-up paper,
    // otherwise the Engine's deep-space fog would wash the book out.
    this.bookGroup.traverse((object) => {
      if (!object.isMesh) return;
      object.frustumCulled = true;
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
      color: '#ddd1b8',
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

    const clothTex = this._createCoverClothTextures();
    this.coverOuterMat = new THREE.MeshStandardMaterial({
      map: clothTex.map,
      bumpMap: clothTex.bumpMap,
      bumpScale: 0.014,
      roughness: 0.76,
      metalness: 0.1
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
    this.bookGroup.add(this.leftBoardGroup, this.rightBoardGroup);
    this.bookGroup.add(this._createSpineMesh());
    this.bookGroup.add(this._createHeadbandMesh());

    // Thick layered paper blocks under the curved sheets
    const stackMat = this._createPaperStackMaterial();
    this.leftBlockGeo = this._buildPageBlockGeometry(-1);
    this.rightBlockGeo = this._buildPageBlockGeometry(1);
    const leftBlockMesh = new THREE.Mesh(this.leftBlockGeo, stackMat);
    const rightBlockMesh = new THREE.Mesh(this.rightBlockGeo, stackMat);
    leftBlockMesh.castShadow = false;
    leftBlockMesh.receiveShadow = false;
    rightBlockMesh.castShadow = false;
    rightBlockMesh.receiveShadow = false;
    this.bookGroup.add(leftBlockMesh, rightBlockMesh);
    this.leftBlockMesh = leftBlockMesh;
    this.rightBlockMesh = rightBlockMesh;

    // Four static page textures (two resting faces + front/back of the flipping leaf)
    this.pageLeftCanvas = this._createStaticPageCanvas(true);
    this.pageRightCanvas = this._createStaticPageCanvas(false);
    this.flipFrontCanvas = this._createStaticPageCanvas(false);
    this.flipBackCanvas = this._createStaticPageCanvas(true);

    this.leftPageMat = new THREE.MeshStandardMaterial({
      map: this.pageLeftCanvas.texture,
      roughness: 0.92
    });
    this.rightPageMat = new THREE.MeshStandardMaterial({
      map: this.pageRightCanvas.texture,
      roughness: 0.92
    });

    this.leftPageGeo = this._createCurvedSheetGeometry(true);
    this.rightPageGeo = this._createCurvedSheetGeometry(false);
    const leftPageMesh = new THREE.Mesh(this.leftPageGeo, this.leftPageMat);
    const rightPageMesh = new THREE.Mesh(this.rightPageGeo, this.rightPageMat);
    leftPageMesh.receiveShadow = true;
    rightPageMesh.receiveShadow = true;
    this.bookGroup.add(leftPageMesh, rightPageMesh);

    // Deformable 2-sided flipping leaf
    this.flipGroup = new THREE.Group();
    this.flipGroup.visible = false;
    this.bookGroup.add(this.flipGroup);

    const flipFrontMat = new THREE.MeshStandardMaterial({
      map: this.flipFrontCanvas.texture,
      roughness: 0.9,
      side: THREE.FrontSide
    });
    const flipBackMat = new THREE.MeshStandardMaterial({
      map: this.flipBackCanvas.texture,
      roughness: 0.9,
      side: THREE.BackSide
    });

    this.flipFrontGeo = this._createCurvedSheetGeometry(false);
    this.flipBackGeo = this._createCurvedSheetGeometry(false);
    const flipFrontMesh = new THREE.Mesh(this.flipFrontGeo, flipFrontMat);
    const flipBackMesh = new THREE.Mesh(this.flipBackGeo, flipBackMat);
    flipFrontMesh.castShadow = true;
    flipFrontMesh.receiveShadow = true;
    flipBackMesh.castShadow = true;
    flipBackMesh.receiveShadow = true;
    this.flipGroup.add(flipFrontMesh, flipBackMesh);
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

  _applyCurveToSheet(geo, curvePts, normalOffset = 0) {
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
    // The flipping leaf changes its bounds as it bends; keep frustum culling accurate.
    geo.computeBoundingSphere();
  }

  _rebuildAllGeometry() {
    const leftPts = this._sampleRestingCurve(this.SEG_U, -1);
    const rightPts = this._sampleRestingCurve(this.SEG_U, 1);
    this._applyCurveToSheet(this.leftPageGeo, leftPts);
    this._applyCurveToSheet(this.rightPageGeo, rightPts);
    this._updateBlockGeometry(this.leftBlockGeo, leftPts);
    this._updateBlockGeometry(this.rightBlockGeo, rightPts);
  }

  /* =========================================================================
     PUBLIC API: SHARED-SCENE BOOK + PHYSICAL PAGE FLIP
     ========================================================================= */
  setOpen(isOpen) {
    this.opened = !!isOpen;
    if (!this.opened) {
      this._stopAnimation();
      this.flipState = null;
      if (this.flipGroup) this.flipGroup.visible = false;
    }
    if (this.bookGroup) this.bookGroup.visible = this.opened;
    if (this.bookLights) this.bookLights.visible = this.opened;
    this.updateAnchor();
  }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme };
    if (!this.flipState) {
      this.pageLeftCanvas?.render(this.theme);
      this.pageRightCanvas?.render(this.theme);
    }
  }

  /**
   * Place the shared-scene book where Build 11's book-stage used to be.
   * The transparent DOM stage is a projection reference only: its dimensions and
   * the page dock position reproduce the old bottom-centred layout. The book itself
   * remains a normal Engine-scene object, so solids occlude it through the depth buffer.
   */
  updateAnchor() {
    if (!this.bookGroup || !this.camera || !this.engine?.renderer?.domElement) return;

    const canvasRect = this.engine.renderer.domElement.getBoundingClientRect();
    const stageRect = this.container?.getBoundingClientRect?.();
    if (!canvasRect.width || !canvasRect.height || !stageRect?.width || !stageRect?.height) return;

    this.camera.updateMatrixWorld(true);

    // Build 11 placed the stage above the unboxed page dock. Its flex-flow used an
    // 8px overlap, so the visible book stage ends 8px below the dock's top edge.
    const dock = this.container.parentElement?.querySelector('.book-bottom-bar');
    const dockRect = dock?.getBoundingClientRect?.();
    const stageBottomY = dockRect && dockRect.height > 0
      ? dockRect.top + 8
      : canvasRect.bottom - this.LEGACY_STAGE_BOTTOM;

    const stageCenterX = stageRect.left + stageRect.width * 0.5;
    const stageCenterY = stageBottomY - stageRect.height * 0.5;
    // In Build 11 the book origin was slightly below the old camera's look-at
    // point (y=0 versus y=0.44). Preserve that exact projected offset too.
    const targetX = stageCenterX - this.LEGACY_BOOK_ORIGIN_NDC.x * stageRect.width * 0.5;
    const targetY = stageCenterY - this.LEGACY_BOOK_ORIGIN_NDC.y * stageRect.height * 0.5;
    const ndcX = ((targetX - canvasRect.left) / canvasRect.width) * 2 - 1;
    const ndcY = 1 - ((targetY - canvasRect.top) / canvasRect.height) * 2;

    // Keep the whole book behind the current solid, even while the user zooms out.
    const cameraToOrigin = this.camera.position.length();
    const depth = Math.max(6.4, cameraToOrigin + 2.8);
    const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5);
    const aspect = canvasRect.width / canvasRect.height;
    const local = new THREE.Vector3(
      ndcX * depth * halfFovTangent * aspect,
      ndcY * depth * halfFovTangent,
      -depth
    );

    this.bookGroup.position.copy(this.camera.localToWorld(local));
    // The old book camera's inverse quaternion preserves its original top-down
    // perspective relative to the Engine camera, without rotating the Engine itself.
    this.bookGroup.quaternion.copy(this.camera.quaternion).multiply(this.localBookRotation);

    // Match Build 11's apparent pixel size across viewport heights and zoom levels.
    // Perspective scaling compensates for Engine FOV 45° versus the old book FOV 34°.
    const oldHalfFovTangent = Math.tan(THREE.MathUtils.degToRad(this.LEGACY_BOOK_FOV) * 0.5);
    const scale = (stageRect.height / canvasRect.height)
      * (depth / this.LEGACY_BOOK_VIEW_DEPTH)
      * (halfFovTangent / oldHalfFovTangent);
    this.bookGroup.scale.setScalar(scale);
    this.bookGroup.updateMatrixWorld(true);
  }

  triggerFlip(dir, newTheme) {
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

    this.flipState = {
      dir: direction,
      progress: direction > 0 ? 0 : 1,
      duration: 760 // original Build 11 physical page-turn duration
    };
    this.flipGroup.visible = true;
    this.flipStartedAt = null;
    this._startFlipAnimation();
  }

  finishFlip() {
    this._stopAnimation();
    this.flipState = null;
    if (this.flipGroup) this.flipGroup.visible = false;
    if (this.opened) {
      this.pageLeftCanvas?.render(this.theme);
      this.pageRightCanvas?.render(this.theme);
    }
  }

  resize() {
    // The main Engine owns the only renderer and updates it on window resize.
    this.updateAnchor();
  }

  _renderOnce() {
    // Rendering is handled by Engine.start() for the entire shared scene.
  }

  _stopAnimation() {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.flipStartedAt = null;
  }

  _startFlipAnimation() {
    this._stopAnimation();
    const animate = (timestamp) => {
      if (!this.opened || !this.flipState) {
        this.animationFrame = null;
        return;
      }

      const state = this.flipState;
      if (this.flipStartedAt === null) this.flipStartedAt = timestamp;
      const linear = Math.min(1, (timestamp - this.flipStartedAt) / state.duration);
      const eased = linear < 0.5
        ? 4 * linear * linear * linear
        : 1 - Math.pow(-2 * linear + 2, 3) / 2;
      state.progress = state.dir > 0 ? eased : 1 - eased;

      const p = Math.max(0.001, Math.min(0.999, state.progress));
      const flipPoints = this._sampleFlipCurve(this.SEG_U, p);
      this._applyCurveToSheet(this.flipFrontGeo, flipPoints, 0.003);
      this._applyCurveToSheet(this.flipBackGeo, flipPoints, 0.001);

      if (linear < 1) {
        this.animationFrame = requestAnimationFrame(animate);
        return;
      }

      this.animationFrame = null;
      this.flipState = null;
      this.flipGroup.visible = false;
      this.pageLeftCanvas.render(this.theme);
      this.pageRightCanvas.render(this.theme);
    };

    this.animationFrame = requestAnimationFrame(animate);
  }

  _bindEvents() {
    // Pointer hit-testing is performed by the shared Engine raycaster so a
    // nearer solid naturally takes precedence over the book behind it.
  }

  handleRaycastHit(worldPoint) {
    if (!this.opened || !worldPoint) return false;
    const localPoint = this.bookGroup.worldToLocal(worldPoint.clone());
    if (localPoint.x < 0) this.onPrev?.();
    else this.onNext?.();
    return true;
  }

  dispose() {
    this._stopAnimation();
    if (this.bookGroup) this.scene.remove(this.bookGroup);
    if (this.bookLights) this.scene.remove(this.bookLights);
  }

}
