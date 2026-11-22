import * as THREE from 'three';

export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * PlatonicMath.js — Pure Mathematical Data for the 5 Platonic Solids
 * Contains normalized vertex coordinates, edge/face topology, Timaeus philosophy,
 * multi-stop edge color palettes, and the BFS Spanning-Tree Hinge algorithm.
 */
export const PLATONIC_DATA = {
  tetrahedron: {
    id: 'tetrahedron',
    name: 'Tetrahedron',
    element: 'Fire',
    elementGreek: 'PYR',
    primaryColor: '#ff2400',   // Crimson Red
    secondaryColor: '#ff7b00', // Blazing Orange
    tertiaryColor: '#ffd60a',  // Radiant Gold
    baseFreq: 174.61, // F3
    damping: 0.965,
    floatAmp: 0.055,
    floatSpeed: 1.8,
    faceShape: '4 equilateral triangles • Dual: Self-dual',
    dualId: 'tetrahedron',
    philosophy:
      '“Among regular solids, the tetrahedron has the sharpest angles and smallest volume-to-surface ratio — Plato assigned it to Fire for its piercing heat and swift motion.”',
    interactionTip:
      'Click & hold to stoke the inner flame from crimson-orange to white-hot gold; touch glowing edges to pluck harmonic notes.'
  },
  cube: {
    id: 'cube',
    name: 'Hexahedron (Cube)',
    element: 'Earth',
    elementGreek: 'GĒ',
    primaryColor: '#059669',   // Deep Emerald
    secondaryColor: '#10b981', // Jade Green
    tertiaryColor: '#a7f3d0',  // Luminous Mint
    baseFreq: 130.81, // C3
    damping: 0.91,
    floatAmp: 0.025,
    floatSpeed: 0.8,
    faceShape: '6 regular squares • Dual: Octahedron',
    dualId: 'octahedron',
    philosophy:
      '“Standing most steadily upon any plane thanks to its square bases — the Cube embodies the stability, endurance, and solidity of Earth.”',
    interactionTip:
      'Double-click or press Trigger Resonance to send a seismic emerald pulse through the inner crystal core and grid.'
  },
  octahedron: {
    id: 'octahedron',
    name: 'Octahedron',
    element: 'Air',
    elementGreek: 'AĒR',
    primaryColor: '#0284c7',   // Azure Sky
    secondaryColor: '#38bdf8', // Luminous Cyan
    tertiaryColor: '#e0f2fe',  // Ice White
    baseFreq: 196.00, // G3
    damping: 0.988,
    floatAmp: 0.11,
    floatSpeed: 2.1,
    faceShape: '8 equilateral triangles • Dual: Cube',
    dualId: 'cube',
    philosophy:
      '“Slender, balanced, and spinning effortlessly when held by two opposite vertices — Plato saw the Octahedron as the freely flowing corpuscle of Air.”',
    interactionTip:
      'Move your cursor around the crystal to accelerate the swirling wind vortex ribbons inside.'
  },
  icosahedron: {
    id: 'icosahedron',
    name: 'Icosahedron',
    element: 'Water',
    elementGreek: 'HYDŌR',
    primaryColor: '#1d4ed8',   // Deep Cobalt
    secondaryColor: '#3b82f6', // Ocean Blue
    tertiaryColor: '#67e8f9',  // Aqua Caustic
    baseFreq: 146.83, // D3
    damping: 0.96,
    floatAmp: 0.075,
    floatSpeed: 1.4,
    faceShape: '20 equilateral triangles • Dual: Dodecahedron',
    dualId: 'dodecahedron',
    philosophy:
      '“Closest to a sphere among the triangular solids, rolling smoothly without resistance — representing the fluidity and gentle flow of Water.”',
    interactionTip:
      'Click anywhere on the frame to send harmonic water ripples across the suspended liquid core inside.'
  },
  dodecahedron: {
    id: 'dodecahedron',
    name: 'Dodecahedron',
    element: 'Aether',
    elementGreek: 'KOSMOS',
    primaryColor: '#7e22ce',   // Royal Violet
    secondaryColor: '#c084fc', // Nebula Orchid
    tertiaryColor: '#fde047',  // Starlight Gold
    baseFreq: 220.00, // A3
    damping: 0.975,
    floatAmp: 0.05,
    floatSpeed: 1.0,
    faceShape: '12 regular pentagons • Dual: Icosahedron',
    dualId: 'icosahedron',
    philosophy:
      '“Its 12 pentagonal faces correspond to the 12 signs of the zodiac; Plato wrote that the Creator used this solid to embroider the constellations across the cosmos.”',
    interactionTip:
      'Scroll your mouse wheel to zoom right through the pentagonal edges into the miniature cosmos core inside.'
  }
};

/**
 * Generates exact normalized vertex coordinates (circumradius R = 1) and face topology
 */
export function getSolidGeometryData(id) {
  let rawVertices = [];
  let faces = [];

  if (id === 'tetrahedron') {
    // Upright orientation: apex (vertex 0) points up (+Y), the triangular base (face 3) lies flat facing down.
    // Circumradius = 1, so the base plane sits at y = -1/3 and its vertices have radius sqrt(8)/3.
    const baseY = -1 / 3;
    const baseR = Math.sqrt(8) / 3;
    rawVertices = [new THREE.Vector3(0, 1, 0)];
    for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k * 2 * Math.PI) / 3;
      rawVertices.push(new THREE.Vector3(baseR * Math.cos(a), baseY, baseR * Math.sin(a)));
    }
    faces = [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 1],
      [1, 3, 2]
    ];
  } else if (id === 'cube') {
    const s = 1 / Math.sqrt(3);
    rawVertices = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1]
    ].map(([x, y, z]) => new THREE.Vector3(x * s, y * s, z * s));
    faces = [
      [4, 5, 6, 7],
      [0, 3, 2, 1],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [0, 4, 7, 3],
      [1, 2, 6, 5]
    ];
  } else if (id === 'octahedron') {
    rawVertices = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1]
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    faces = [
      [0, 2, 4],
      [2, 1, 4],
      [1, 3, 4],
      [3, 0, 4],
      [2, 0, 5],
      [1, 2, 5],
      [3, 1, 5],
      [0, 3, 5]
    ];
  } else if (id === 'icosahedron') {
    const norm = Math.sqrt(1 + PHI * PHI);
    rawVertices = [
      [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
      [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
      [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
    ].map(([x, y, z]) => new THREE.Vector3(x / norm, y / norm, z / norm));
    faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
    ];
  } else if (id === 'dodecahedron') {
    const invPhi = 1 / PHI;
    const s = 1 / Math.sqrt(3);
    rawVertices = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
      [0, -invPhi, -PHI], [0, invPhi, -PHI], [0, -invPhi, PHI], [0, invPhi, PHI],
      [-invPhi, -PHI, 0], [invPhi, -PHI, 0], [invPhi, PHI, 0], [-invPhi, PHI, 0],
      [-PHI, 0, -invPhi], [PHI, 0, -invPhi], [PHI, 0, invPhi], [-PHI, 0, invPhi]
    ].map(([x, y, z]) => new THREE.Vector3(x * s, y * s, z * s));

    let minEdge = Infinity;
    for (let i = 0; i < rawVertices.length; i++) {
      for (let j = i + 1; j < rawVertices.length; j++) {
        const d = rawVertices[i].distanceTo(rawVertices[j]);
        if (d > 1e-4 && d < minEdge) minEdge = d;
      }
    }
    const adj = Array.from({ length: 20 }, () => []);
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        if (i !== j && Math.abs(rawVertices[i].distanceTo(rawVertices[j]) - minEdge) < 1e-3) {
          adj[i].push(j);
        }
      }
    }

    const seen = new Set();
    for (let a = 0; a < 20; a++) {
      for (const b of adj[a]) {
        for (const c of adj[b]) {
          if (c === a) continue;
          for (const d of adj[c]) {
            if (d === a || d === b) continue;
            for (const e of adj[d]) {
              if (e === a || e === b || e === c || !adj[e].includes(a)) continue;
              let cycle = [a, b, c, d, e];
              const pts = cycle.map((idx) => rawVertices[idx]);
              const center = new THREE.Vector3();
              pts.forEach((p) => center.add(p));
              center.divideScalar(5);

              const normal = new THREE.Vector3()
                .subVectors(pts[1], pts[0])
                .cross(new THREE.Vector3().subVectors(pts[2], pts[0]))
                .normalize();

              if (normal.dot(center) < 0) {
                normal.negate();
                cycle.reverse();
              }

              const coplanar = cycle.every(
                (idx) => Math.abs(new THREE.Vector3().subVectors(rawVertices[idx], center).dot(normal)) < 1e-3
              );
              if (!coplanar) continue;

              const minIdx = cycle.indexOf(Math.min(...cycle));
              const canon = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)].join(',');
              if (!seen.has(canon)) {
                seen.add(canon);
                faces.push(cycle);
              }
            }
          }
        }
      }
    }
  }

  // Resting pose: octahedron, icosahedron and dodecahedron are turned so face 0 lies flat on the ground
  // (the tetrahedron and cube already rest on a base face), so every solid has a clear base to unfold from.
  if (id === 'octahedron' || id === 'icosahedron' || id === 'dodecahedron') {
    const c = new THREE.Vector3();
    faces[0].forEach((i) => c.add(rawVertices[i]));
    const toDown = new THREE.Quaternion().setFromUnitVectors(c.normalize(), new THREE.Vector3(0, -1, 0));
    rawVertices.forEach((v) => v.applyQuaternion(toDown));
  }

  // Ensure outward-facing vertex winding for every face
  faces = faces.map((face) => {
    const pts = face.map((i) => rawVertices[i]);
    const center = new THREE.Vector3();
    pts.forEach((p) => center.add(p));
    center.divideScalar(pts.length);
    const n = new THREE.Vector3()
      .subVectors(pts[1], pts[0])
      .cross(new THREE.Vector3().subVectors(pts[2], pts[0]))
      .normalize();
    return n.dot(center) < 0 ? [...face].reverse() : face;
  });

  // Extract unique edges
  const edgeMap = new Map();
  const edgeToFaces = new Map();

  faces.forEach((face, fi) => {
    const m = face.length;
    for (let k = 0; k < m; k++) {
      const u = face[k];
      const w = face[(k + 1) % m];
      const key = u < w ? `${u}_${w}` : `${w}_${u}`;
      if (!edgeMap.has(key)) edgeMap.set(key, [u, w]);
      if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
      edgeToFaces.get(key).push({ faceIndex: fi, u, w });
    }
  });

  const edges = Array.from(edgeMap.values());

  // Compute face normals and centroids
  const faceNormals = faces.map((face) => {
    const p0 = rawVertices[face[0]];
    const p1 = rawVertices[face[1]];
    const p2 = rawVertices[face[2]];
    return new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
  });

  const faceCenters = faces.map((face) => {
    const c = new THREE.Vector3();
    face.forEach((idx) => c.add(rawVertices[idx]));
    return c.divideScalar(face.length);
  });

  // Build BFS Spanning Hinge Tree for exact 2D net unfolding.
  // The net always unfolds from the downward-facing base, which stays still while the other faces flatten onto the ground.
  let rootFace = 0;
  faceNormals.forEach((n, i) => {
    if (n.y < faceNormals[rootFace].y) rootFace = i;
  });
  const baseY = Math.min(...rawVertices.map((v) => v.y));
  const visited = new Set([rootFace]);
  const queue = [rootFace];
  const hingeTree = Array.from({ length: faces.length }, (_, i) => ({
    faceIndex: i,
    parentIndex: -1,
    pivot: new THREE.Vector3(),
    axis: new THREE.Vector3(0, 1, 0),
    unfoldAngle: 0,
    children: []
  }));

  while (queue.length > 0) {
    const curr = queue.shift();
    const nCurr = faceNormals[curr];
    const face = faces[curr];
    const m = face.length;

    for (let k = 0; k < m; k++) {
      const u = face[k];
      const w = face[(k + 1) % m];
      const key = u < w ? `${u}_${w}` : `${w}_${u}`;
      const neighbors = edgeToFaces.get(key) || [];

      for (const item of neighbors) {
        const nbr = item.faceIndex;
        if (!visited.has(nbr)) {
          visited.add(nbr);
          queue.push(nbr);

          const nNbr = faceNormals[nbr];
          const edgeDir = new THREE.Vector3().subVectors(rawVertices[w], rawVertices[u]).normalize();
          const cross = new THREE.Vector3().crossVectors(edgeDir, nNbr);
          const angle = Math.atan2(cross.dot(nCurr), nNbr.dot(nCurr));

          hingeTree[nbr].parentIndex = curr;
          hingeTree[nbr].pivot = rawVertices[u].clone();
          hingeTree[nbr].axis = edgeDir;
          hingeTree[nbr].unfoldAngle = angle;
          hingeTree[curr].children.push(nbr);
        }
      }
    }
  }

  return {
    vertices: rawVertices,
    edges,
    faces,
    faceNormals,
    faceCenters,
    hingeTree,
    rootFace,
    baseY
  };
}
