import * as THREE from 'three';

/**
 * ElementShaders.js — Custom GLSL Shaders for:
 * 1. Ultra-sheer crystal faces (nearly invisible so internal cores & inscribed Mathgic spells shine through)
 * 2. Luminous 3-color gradient glowing edges (e.g., Red-Orange-Gold for Fire)
 * 3. Volumetric-style flickering 3D Flame shader for the Fire Tetrahedron core
 */

function bindSharedUniforms(material, globalUniforms) {
  for (const key of Object.keys(globalUniforms)) {
    material.uniforms[key] = globalUniforms[key];
  }
  return material;
}

export function createSheerFaceMaterial(globalUniforms) {
  const vertexShader = /* glsl */ `
    uniform float uTime;
    uniform float uPulseTime;
    uniform vec3 uHitPoint;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vWave;

    void main() {
      float timeSincePulse = uTime - uPulseTime;
      float distToHit = distance(position, uHitPoint);
      float pulseWave = 0.0;

      if (timeSincePulse >= 0.0 && timeSincePulse < 2.2) {
        pulseWave = sin(distToHit * 16.0 - timeSincePulse * 10.0) * exp(-timeSincePulse * 2.0) * exp(-distToHit * 1.6);
      }

      vWave = max(0.0, pulseWave);
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPosition.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);

      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform float uEnergy;
    uniform vec3 uColorPrimary;
    uniform vec3 uColorSecondary;
    uniform vec3 uColorTertiary;
    uniform float uFaceBurst;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vWave;

    void main() {
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      // Very tight grazing Fresnel so the face center is nearly 100% transparent
      float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 3.6);

      vec3 col = mix(uColorPrimary, uColorTertiary, fresnel);
      col = mix(col, vec3(1.0, 0.94, 0.78), clamp(uFaceBurst * 0.58, 0.0, 0.58));
      // Faces remain translucent at rest and become readable during fracture/rebirth.
      float alpha = 0.018 + fresnel * 0.13 + vWave * 0.25 + uEnergy * 0.04 + uFaceBurst * 0.34;

      gl_FragColor = vec4(col, clamp(alpha, 0.015, 0.35));
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...globalUniforms, uFaceBurst: { value: 0 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return bindSharedUniforms(mat, globalUniforms);
}

/**
 * Luminous 3-color gradient glowing edge shader
 * Gives each edge a rich multi-stop color flow (e.g., Red -> Orange -> Gold for Fire)
 */
export function createGlowingEdgeMaterial(globalUniforms) {
  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vInstanceColor;

    void main() {
      vUv = uv;
      vec4 localPosition = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        localPosition = instanceMatrix * localPosition;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vInstanceColor = instanceColor;
      #else
        vInstanceColor = vec3(1.0);
      #endif
      vec4 worldPosition = modelMatrix * localPosition;
      vWorldPos = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform vec3 uColorPrimary;
    uniform vec3 uColorSecondary;
    uniform vec3 uColorTertiary;
    uniform float uHoverBoost;
    uniform float uDetonation;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vInstanceColor;

    void main() {
      float flow = 0.5 + 0.5 * sin(vUv.y * 6.2831 - uTime * 3.0 + (vWorldPos.x + vWorldPos.y) * 2.5);
      vec3 grad1 = mix(uColorPrimary, uColorSecondary, vUv.y);
      vec3 col = mix(grad1, uColorTertiary, flow * 0.65 + uEnergy * 0.35);
      col += vec3(1.0, 0.95, 0.85) * (uEnergy * 0.45 + uHoverBoost * 0.45 + uDetonation * 0.72);
      col *= vInstanceColor;
      float alpha = 0.72 + uEnergy * 0.25 + uHoverBoost * 0.28 + uDetonation * 0.16;
      gl_FragColor = vec4(col, clamp(alpha, 0.5, 1.0));
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...globalUniforms,
      uHoverBoost: { value: 0.0 },
      uDetonation: { value: 0.0 }
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return bindSharedUniforms(mat, globalUniforms);
}

/**
 * Volumetric-style 3D Flickering Flame Shader for the interior of the Fire Tetrahedron
 */
export function createInnerFlameMaterial(globalUniforms) {
  const vertexShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPos;

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
      vUv = uv;
      vec3 pos = position;

      // Height factor (0 at base -> 1 at flame tip)
      float h = clamp((pos.y + 0.35) / 0.75, 0.0, 1.0);

      // Taper upper half into a sharp dancing flame tip
      float taper = mix(1.05, 0.08, pow(h, 1.25));
      pos.xz *= taper;

      // Flickering flame tongues rising upward
      float n1 = noise(vec3(pos.x * 5.0, pos.y * 4.5 - uTime * 4.8, pos.z * 5.0));
      float n2 = noise(vec3(pos.x * 9.0 + 3.1, pos.y * 7.0 - uTime * 7.5, pos.z * 9.0));
      float flicker = (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.08;

      pos.x += flicker * (0.3 + h * 1.4) * (1.0 + uEnergy * 0.6);
      pos.z += (n2 - 0.5) * 0.14 * (0.3 + h * 1.4);
      pos.y += sin(uTime * 8.0 + n1 * 6.0) * 0.035 * h + uEnergy * 0.12 * h;

      vPos = pos;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPos;

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
      float h = clamp((vPos.y + 0.35) / 0.78, 0.0, 1.0);
      float turb = noise(vPos * 7.5 - vec3(0.0, uTime * 5.5, 0.0));
      float coreHeat = (1.0 - h * 0.65) * 0.65 + turb * 0.45 + uEnergy * 0.35;

      // Red -> Orange -> Gold -> White-hot plasma palette
      vec3 red = vec3(0.95, 0.10, 0.01);
      vec3 orange = vec3(1.0, 0.45, 0.02);
      vec3 gold = vec3(1.0, 0.88, 0.22);
      vec3 whiteHot = vec3(1.0, 0.98, 0.90);

      vec3 col = mix(red, orange, smoothstep(0.15, 0.5, coreHeat));
      col = mix(col, gold, smoothstep(0.45, 0.8, coreHeat));
      col = mix(col, whiteHot, smoothstep(0.78, 1.15, coreHeat));

      // Soft dissolve near the wispy flame tip
      float tipFade = smoothstep(1.02, 0.45, h + (turb - 0.5) * 0.25);
      float baseFade = smoothstep(-0.36, -0.22, vPos.y);
      float alpha = tipFade * baseFade * 0.92;

      gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms: globalUniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return bindSharedUniforms(mat, globalUniforms);
}
