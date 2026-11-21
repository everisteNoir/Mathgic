import * as THREE from 'three';

/**
 * ElementShaders.js — Custom GLSL Elemental Materials
 * Combines real-time interaction uniforms (uPointer3D, uEnergy, uPulseTime) for reactive visuals.
 */
export function createElementMaterial(solidId, globalUniforms) {
  const elementTypeMap = {
    tetrahedron: 0, // Fire
    cube: 1,        // Earth
    octahedron: 2,  // Air
    icosahedron: 3, // Water
    dodecahedron: 4 // Aether
  };

  const vertexShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform float uPulseTime;
    uniform vec3 uHitPoint;
    uniform int uElementType;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vLocalPos;
    varying float vWave;

    void main() {
      vLocalPos = position;
      vec3 pos = position;

      float timeSincePulse = uTime - uPulseTime;
      float distToHit = distance(position, uHitPoint);
      float pulseWave = 0.0;

      if (timeSincePulse >= 0.0 && timeSincePulse < 2.5) {
        pulseWave = sin(distToHit * 14.0 - timeSincePulse * 9.0) * exp(-timeSincePulse * 1.8) * exp(-distToHit * 1.5);
      }

      // Micro-displacement per element
      if (uElementType == 0) {
        // Fire: Subtle thermal vibration during energy charge
        pos += normal * (sin(uTime * 12.0 + position.y * 8.0) * 0.012 * (0.2 + uEnergy));
      } else if (uElementType == 3) {
        // Water: Fluid droplet oscillation + surface ripple
        float waterRipple = sin(position.x * 6.0 + uTime * 3.0) * cos(position.y * 6.0 + uTime * 2.5) * 0.015;
        pos += normal * (waterRipple + pulseWave * 0.06);
      } else {
        pos += normal * (pulseWave * 0.035);
      }

      vWave = pulseWave;
      vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
      vWorldPos = worldPosition.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform float uPulseTime;
    uniform vec3 uColorPrimary;
    uniform vec3 uColorSecondary;
    uniform int uElementType;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vLocalPos;
    varying float vWave;

    // Smooth 3D Procedural Value Noise
    float hash(vec3 p) {
      p = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z
      );
    }

    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.2);

      vec3 col = uColorPrimary;
      float alpha = 0.72;

      if (uElementType == 0) {
        // FIRE: Rising plasma currents + white-hot core when charged
        float n = noise(vLocalPos * 4.5 - vec3(0.0, uTime * 2.2, 0.0));
        float n2 = noise(vLocalPos * 9.0 - vec3(0.0, uTime * 3.8, 0.0));
        float flame = n * 0.65 + n2 * 0.35;
        col = mix(vec3(0.65, 0.08, 0.02), uColorPrimary, flame);
        col = mix(col, uColorSecondary, smoothstep(0.45, 0.9, flame + uEnergy * 0.4));
        col += vec3(1.0, 0.95, 0.85) * pow(uEnergy, 1.5) * 0.85;
        alpha = 0.82 + fresnel * 0.18;
      } else if (uElementType == 1) {
        // EARTH: Crystalline mineral stone with glowing emerald veins
        float vein = abs(sin((vLocalPos.x + vLocalPos.y * 1.3 + vLocalPos.z) * 9.0 + noise(vLocalPos * 5.0) * 3.0));
        float crystal = smoothstep(0.92, 0.99, vein);
        col = mix(vec3(0.04, 0.14, 0.11), uColorPrimary * 0.65, 0.5 + 0.5 * noise(vLocalPos * 6.0));
        col += uColorSecondary * crystal * (0.9 + abs(vWave) * 4.0);
        alpha = 0.90;
      } else if (uElementType == 2) {
        // AIR: Translucent wind crystal with swirling atmospheric currents
        float wind = sin(vLocalPos.y * 8.0 + uTime * 3.5 + noise(vLocalPos * 4.0) * 4.0) * 0.5 + 0.5;
        col = mix(uColorPrimary * 0.55, uColorSecondary, wind * 0.6 + fresnel * 0.6);
        alpha = 0.36 + fresnel * 0.48;
      } else if (uElementType == 3) {
        // WATER: Underwater light caustics & interactive ripples
        float c1 = noise(vLocalPos * 5.0 + vec3(uTime * 0.8, -uTime * 0.6, uTime * 0.5));
        float c2 = noise(vLocalPos * 8.0 - vec3(uTime * 0.7, uTime * 0.9, -uTime * 0.4));
        float caustic = pow(1.0 - abs(c1 - c2), 4.0);
        col = mix(vec3(0.03, 0.15, 0.42), uColorPrimary, 0.6);
        col += uColorSecondary * caustic * 1.1;
        col += vec3(0.7, 0.95, 1.0) * max(0.0, vWave) * 2.5;
        alpha = 0.64 + fresnel * 0.3;
      } else if (uElementType == 4) {
        // AETHER: Deep cosmic nebula + twinkling starfield
        float nebula = noise(vLocalPos * 3.5 + vec3(uTime * 0.25));
        float stars = smoothstep(0.86, 0.94, hash(floor(vLocalPos * 32.0)));
        col = mix(vec3(0.08, 0.03, 0.2), uColorPrimary, nebula);
        col = mix(col, uColorSecondary, fresnel * 0.75);
        col += vec3(1.0, 0.96, 1.0) * stars * (0.6 + 0.4 * sin(uTime * 4.0 + vLocalPos.x * 20.0));
        alpha = 0.58 + fresnel * 0.36;
      }

      // Sacred Fresnel edge glow
      col += uColorSecondary * fresnel * 0.45;
      col += uColorSecondary * uEnergy * 0.35;

      gl_FragColor = vec4(col, clamp(alpha, 0.2, 0.96));
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms: {
      ...globalUniforms,
      uElementType: { value: elementTypeMap[solidId] ?? 0 }
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: solidId === 'cube' || solidId === 'tetrahedron'
  });
}
