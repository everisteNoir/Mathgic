import * as THREE from 'three';

/**
 * Uniforms.js — Global Shader Uniform Registry
 * All elemental materials, glowing edges, and Mathgic modules read real-time state from here.
 */
export function createGlobalUniforms() {
  return {
    uTime: { value: 0 },
    uDelta: { value: 0 },
    uPointer3D: { value: new THREE.Vector3(0, 0, 0) },
    uHitPoint: { value: new THREE.Vector3(0, 0, 0) },
    uPulseTime: { value: -10.0 },
    uEnergy: { value: 0.0 },        // Energy charge built while holding pointer (0 -> 1)
    uUnfold: { value: 0.0 },        // 2D net unfolding factor (0 -> 1)
    uColorPrimary: { value: new THREE.Color('#ff2a00') },
    uColorSecondary: { value: new THREE.Color('#ffaa00') },
    uColorTertiary: { value: new THREE.Color('#ffe600') },
    uAudioLevel: { value: 0.0 }
  };
}
