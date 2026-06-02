/**
 * Holographic shader injection — ported 1:1 from the vanilla mascot
 * (`injectShaderAnimations`, Personal Website mascot-assistant.js 451-548).
 *
 * Patches the GLB's MeshStandardMaterial via onBeforeCompile:
 *  - VERTEX: computes head/face/eye/jaw region masks from object-space Y (and X
 *    for the eyes), drops the jaw on talk + compresses the eyes on blink, and
 *    exports world normal/position + region/scan varyings.
 *  - FRAGMENT: a vertical scanline sweep, a fresnel rim glow, and an emission
 *    pulse — the cyan holographic look.
 *
 * The region masks (head/face) are passed through as varyings to match the
 * source exactly even though the stock fragment inject doesn't sample them yet;
 * later phases (reactions) can read them. Cache key bumped to v2 since the
 * vertex program changed (added the head/face masks + objectNormal write-back).
 */

import * as THREE from "three";

export const VERT_HEADER = `
uniform float uTalkAmount;
uniform float uBlinkAmount;
varying float vRegionHead;
varying float vRegionFace;
varying float vScanUV;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
`;

export const VERT_TRANSFORM = `{
  vec3 pos = transformed;
  vec3 nrm = objectNormal;
  float ny = pos.y;

  float headMask   = smoothstep(0.30, 0.45, ny);
  float faceMask   = smoothstep(0.45, 0.55, ny) * (1.0 - smoothstep(0.85, 0.95, ny));
  // Symmetric central band (covers both eyes) — the source's two X smoothsteps
  // were mutually exclusive (always 0), so its blink never showed. abs(x) makes
  // it light up the eye band for a real blink compression.
  float eyeMask    = smoothstep(0.55, 0.62, ny) * (1.0 - smoothstep(0.70, 0.78, ny))
                   * (1.0 - smoothstep(0.18, 0.30, abs(pos.x)))
                   * step(0.0, pos.z);
  float jawMask    = smoothstep(0.38, 0.46, ny) * (1.0 - smoothstep(0.50, 0.56, ny))
                   * step(0.0, pos.z);

  pos.y -= eyeMask * uBlinkAmount * 0.02;
  pos.z *= 1.0 - eyeMask * uBlinkAmount * 0.4;

  pos.y -= jawMask * uTalkAmount * 0.015;
  pos.z += jawMask * uTalkAmount * 0.006;

  vRegionHead = headMask;
  vRegionFace = faceMask;
  vScanUV = (ny + 1.0) * 0.5;

  transformed = pos;
  objectNormal = nrm;

  vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
}`;

export const FRAG_HEADER = `
uniform float uScanLine;
uniform vec3 uFresnelColor;
uniform float uFresnelPower;
uniform float uEmissionPulse;
varying float vRegionHead;
varying float vRegionFace;
varying float vScanUV;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
`;

export const FRAG_INJECT = `{
  float scanDist = abs(vScanUV - uScanLine);
  float scanGlow = smoothstep(0.04, 0.0, scanDist) * 0.12;
  gl_FragColor.rgb += vec3(0.0, 0.88, 1.0) * scanGlow;

  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - max(dot(normalize(vWorldNormal), viewDir), 0.0), uFresnelPower);
  gl_FragColor.rgb += uFresnelColor * fresnel * 0.15;

  gl_FragColor.rgb += uFresnelColor * uEmissionPulse * 0.1;
}`;

/** The shader's animation uniforms, owned by the scene + updated per frame. */
export interface HoloUniforms {
  uTalkAmount: { value: number };
  uBlinkAmount: { value: number };
  uScanLine: { value: number };
  uFresnelColor: { value: THREE.Color };
  uFresnelPower: { value: number };
  uEmissionPulse: { value: number };
}

/** Fresh uniform set (fresnel cyan #00e1ff, power 4). */
export function createHoloUniforms(): HoloUniforms {
  return {
    uTalkAmount: { value: 0 },
    uBlinkAmount: { value: 0 },
    uScanLine: { value: 0 },
    uFresnelColor: { value: new THREE.Color(0x00e1ff) },
    uFresnelPower: { value: 4.0 },
    uEmissionPulse: { value: 0 },
  };
}

/** Patch a GLB material with the holographic + talk/blink shader. */
export function injectHoloShader(mat: THREE.Material, u: HoloUniforms): void {
  mat.customProgramCacheKey = () => "mascot-holo-v3";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTalkAmount = u.uTalkAmount;
    shader.uniforms.uBlinkAmount = u.uBlinkAmount;
    shader.uniforms.uScanLine = u.uScanLine;
    shader.uniforms.uFresnelColor = u.uFresnelColor;
    shader.uniforms.uFresnelPower = u.uFresnelPower;
    shader.uniforms.uEmissionPulse = u.uEmissionPulse;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_HEADER}`)
      .replace("#include <morphtarget_vertex>", `#include <morphtarget_vertex>\n${VERT_TRANSFORM}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEADER}`)
      .replace("#include <dithering_fragment>", `${FRAG_INJECT}\n#include <dithering_fragment>`);
  };
  mat.needsUpdate = true;
}
