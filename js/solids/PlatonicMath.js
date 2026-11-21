import * as THREE from 'three';

export const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * PlatonicMath.js — Pure Mathematical Data for the 5 Platonic Solids
 * Contains normalized vertex coordinates, edge/face topology, Timaeus philosophy,
 * and the BFS Spanning-Tree Hinge algorithm for exact 2D net unfolding.
 */
export const PLATONIC_DATA = {
  tetrahedron: {
    id: 'tetrahedron',
    name: 'Tetrahedron',
    element: 'Fire',
    elementGreek: 'PYR',
    primaryColor: '#ff5722',
    secondaryColor: '#ffca28',
    baseFreq: 174.61, // F3
    damping: 0.965,
    floatAmp: 0.06,
    floatSpeed: 1.8,
    faceShape: '4 equilateral triangles • Dual: Self-dual',
    dualId: 'tetrahedron',
    philosophy:
      '“Among regular solids, the tetrahedron has the sharpest angles and smallest volume-to-surface ratio — Plato assigned it to Fire for its piercing heat and swift motion.”',
    interactionTip:
      'Click & hold on the solid to build thermal charge from crimson to white-hot; touch edges to pluck harmonic notes.'
  },
  cube: {
    id: 'cube',
    name: 'Hexahedron (Cube)',
    element: 'Earth',
    elementGreek: 'GĒ',
    primaryColor: '#10b981',
    secondaryColor: '#a7f3d0',
    baseFreq: 130.81, // C3
    damping: 0.91, // Heavy inertia, stops quickly
    floatAmp: 0.025,
    floatSpeed: 0.8,
    faceShape: '6 regular squares • Dual: Octahedron',
    dualId: 'octahedron',
    philosophy:
      '“Standing most steadily upon any plane thanks to its square bases — the Cube embodies the stability, endurance, and solidity of Earth.”',
    interactionTip:
      'Double-click or press Trigger Resonance to send a seismic wave rippling across the spatial grid beneath.'
  },
  octahedron: {
    id: 'octahedron',
    name: 'Octahedron',
    element: 'Air',
    elementGreek: 'AĒR',
    primaryColor: '#38bdf8',
    secondaryColor: '#e0f2fe',
    baseFreq: 196.00, // G3
    damping: 0.988, // Weightless, spins freely
    floatAmp: 0.11,
    floatSpeed: 2.1,
    faceShape: '8 equilateral triangles • Dual: Cube',
    dualId: 'cube',
    philosophy:
      '“Slender, balanced, and spinning effortlessly when held by two opposite vertices — Plato saw the Octahedron as the freely flowing corpuscle of Air.”',
    interactionTip:
      'Move your cursor around the solid to generate air currents that tilt and drift the crystal.'
  },
  icosahedron: {
    id: 'icosahedron',
    name: 'Icosahedron',
    element: 'Water',
    elementGreek: 'HYDŌR',
    primaryColor: '#3b82f6',
    secondaryColor: '#67e8f9',
    baseFreq: 146.83, // D3
    damping: 0.96,
    floatAmp: 0.075,
    floatSpeed: 1.4,
    faceShape: '20 equilateral triangles • Dual: Dodecahedron',
    dualId: 'dodecahedron',
    philosophy:
      '“Closest to a sphere among the triangular solids, rolling smoothly without resistance — representing the fluidity and gentle flow of Water.”',
    interactionTip:
      'Click anywhere on the surface to send caustic water ripples radiating across all 20 triangular faces.'
  },
  dodecahedron: {
    id: 'dodecahedron',
    name: 'Dodecahedron',
    element: 'Aether',
    elementGreek: 'KOSMOS',
    primaryColor: '#c084fc',
    secondaryColor: '#f5d0fe',
    baseFreq: 220.00, // A3
    damping: 0.975,
    floatAmp: 0.05,
    floatSpeed: 1.0,
    faceShape: '12 regular pentagons • Dual: Icosahedron',
    dualId: 'icosahedron',
    philosophy:
      '“Its 12 pentagonal faces correspond to the 12 signs of the zodiac; Plato wrote that the Creator used this solid to embroider the constellations across the cosmos.”',
    interactionTip:
      'Scroll your mouse wheel to zoom right through the pentagonal shell and inspect the celestial core inside.'
  }
};

/**
 * Generates exact normalized vertex coordinates (circumradius R = 1) and face topology
 */
export function getSolidGeometryData(id) {
  let rawVertices = [];
  let faces = [];

  if (id === 'tetrahedron') {
    const s = 1 / Math.sqrt(3);
    rawVertices = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1]
    ].map(([x, y, z]) => new THREE.Vector3(x * s, y * s, z * s));
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

    // Automatically derive the 12 regular pentagonal faces from shortest-edge adjacency
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

  // Build BFS Spanning Hinge Tree for exact 2D net unfolding
  const visited = new Set([0]);
  const queue = [0];
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
    hingeTree
  };
}
