"use client";

/**
 * 3D mascot — React/Three.js port of the vanilla mascot (Personal Website
 * Js/mascot-assistant.js).
 *
 * Phase 2a: scene + lights + GLB + idle, full disposal on unmount.
 * Phase 2b: useMascotStore drives skeletal clips (talking → Talking/Idle;
 *           reaction queue → Wave/Happy/Confused/Thinking one-shots).
 * Phase 2c (this revision): sentiment MOOD — store.mood ({valence,energy})
 *           maps to a mood that drives facial morph-target expressions
 *           (MOOD_EXPRESSIONS), the accent-light colour (MOOD_COLORS), and the
 *           animation speed (MOOD_SPEEDS), all eased per frame.
 * Skin/texture material fidelity + the talk/blink shaders + particles are still
 * to come (need an in-browser material inspection to get the look right).
 *
 * Mount lazily (next/dynamic, ssr:false) — ~16MB GLB + WebGL.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useMascotStore, type MascotReaction } from "@/lib/agent/mascot/store";

interface Mascot3DProps {
  width?: number;
  height?: number;
  className?: string;
  /** GLB url (kept in public/mascot, gitignored for now — see .gitignore). */
  src?: string;
}

/** Clip names that loop rather than play once (from the source). */
const LOOPING = new Set(["Idle", "Listening", "Talking", "Thinking"]);

/** Reaction → {GLB clip, hold duration in seconds} — mirrors runReaction(). */
const REACTION: Record<MascotReaction, { clip: string; dur: number }> = {
  thinking: { clip: "Thinking", dur: 4.2 },
  excited: { clip: "Happy", dur: 2.0 },
  nod: { clip: "Happy", dur: 2.0 },
  headShake: { clip: "Confused", dur: 1.5 },
  wave: { clip: "Wave", dur: 2.5 },
  dance: { clip: "Happy", dur: 2.5 },
  confused: { clip: "Confused", dur: 1.5 },
  surprised: { clip: "Happy", dur: 1.5 },
};

/** Mood → facial morph-target influences (from the source's MOOD_EXPRESSIONS). */
const MOOD_EXPRESSIONS: Record<string, Record<string, number>> = {
  serene: { smile: 0.3 },
  playful: { smile: 0.8, eyebrow_raise: 0.3 },
  intense: { eyebrow_furrow: 0.5 },
  curious: { eyebrow_raise: 0.5, smile: 0.2 },
  determined: { eyebrow_furrow: 0.3, squint: 0.2 },
  neutral: {},
  warm: { smile: 0.4 },
};
type MoodName = keyof typeof MOOD_EXPRESSIONS;
const MOOD_COLOR: Record<MoodName, number> = {
  serene: 0x94a3b8,
  playful: 0xf472b6,
  intense: 0xef4444,
  curious: 0x34d399,
  determined: 0xf59e0b,
  neutral: 0x8a95a8,
  warm: 0xfbbf24,
};
const MOOD_SPEED: Record<MoodName, number> = {
  serene: 0.7,
  playful: 1.3,
  intense: 1.5,
  curious: 1.1,
  determined: 1.1,
  neutral: 1.0,
  warm: 1.0,
};

/** Map a sentiment {valence,energy} (0..1 each) to one of the morph moods. */
function moodFor(valence: number, energy: number): MoodName {
  if (valence >= 0.6) return energy >= 0.6 ? "playful" : "warm";
  if (valence <= 0.4) return energy >= 0.6 ? "intense" : "determined";
  return energy >= 0.6 ? "curious" : energy <= 0.35 ? "serene" : "neutral";
}

// ── Holographic shader injection (ported from injectShaderAnimations) ──
// Patches the GLB's MeshStandardMaterial via onBeforeCompile: jaw drops while
// talking, eyes compress on blink (vertex), and a fresnel rim glow + scanline +
// emission pulse give the cyan holographic look (fragment). Masks key off the
// vertex's object-space Y, which is identical for this GLB.
const VERT_HEADER = `
uniform float uTalkAmount;
uniform float uBlinkAmount;
varying float vScanUV;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
`;
const VERT_TRANSFORM = `{
  vec3 pos = transformed;
  float ny = pos.y;
  float eyeMask = smoothstep(0.55, 0.62, ny) * (1.0 - smoothstep(0.70, 0.78, ny))
    * smoothstep(-0.25, -0.12, pos.x) * smoothstep(0.12, 0.25, -pos.x) * step(0.0, pos.z);
  float jawMask = smoothstep(0.38, 0.46, ny) * (1.0 - smoothstep(0.50, 0.56, ny)) * step(0.0, pos.z);
  pos.y -= eyeMask * uBlinkAmount * 0.02;
  pos.z *= 1.0 - eyeMask * uBlinkAmount * 0.4;
  pos.y -= jawMask * uTalkAmount * 0.015;
  pos.z += jawMask * uTalkAmount * 0.006;
  vScanUV = (ny + 1.0) * 0.5;
  transformed = pos;
  vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
}`;
const FRAG_HEADER = `
uniform float uScanLine;
uniform vec3 uFresnelColor;
uniform float uFresnelPower;
uniform float uEmissionPulse;
varying float vScanUV;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
`;
const FRAG_INJECT = `{
  float scanDist = abs(vScanUV - uScanLine);
  float scanGlow = smoothstep(0.04, 0.0, scanDist) * 0.12;
  gl_FragColor.rgb += vec3(0.0, 0.88, 1.0) * scanGlow;
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - max(dot(normalize(vWorldNormal), viewDir), 0.0), uFresnelPower);
  gl_FragColor.rgb += uFresnelColor * fresnel * 0.15;
  gl_FragColor.rgb += uFresnelColor * uEmissionPulse * 0.1;
}`;

export default function Mascot3D({
  width = 160,
  height = 280,
  className,
  src = "/mascot/mascot.glb",
}: Mascot3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Idempotent (re)mount — React StrictMode/HMR runs the effect twice and the
    // async GLB load races the cleanup; drop any canvas a prior run left behind
    // so we never stack renderers.
    while (container.firstChild) container.removeChild(container.firstChild);

    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let model: THREE.Object3D | null = null;
    let baseY = 0;

    // Animation state.
    const actions = new Map<string, THREE.AnimationAction>();
    let currentName = "";
    let reactionEnd = 0; // seconds-timestamp the active reaction ends; 0 ⇒ base loop
    const talkingRef = { current: false };

    // Mood state.
    let morphMesh: THREE.Mesh | null = null;
    let morphIndex: Record<string, number> = {};
    const targetMorphs: Record<string, number> = {};
    let currentMood: MoodName = "neutral";
    const moodColor = new THREE.Color(MOOD_COLOR.neutral);
    const targetColor = new THREE.Color(MOOD_COLOR.neutral);
    let moodSpeed = 1;
    let targetSpeed = 1;

    // Shader state (holographic look + talk/blink vertex deforms).
    const animUniforms = {
      uTalkAmount: { value: 0 },
      uBlinkAmount: { value: 0 },
      uScanLine: { value: 0 },
      uFresnelColor: { value: new THREE.Color(0x00e1ff) },
      uFresnelPower: { value: 4.0 },
      uEmissionPulse: { value: 0 },
    };
    let nextBlinkTime = 2 + Math.random() * 4;
    let blinkPhase = -1;
    let talkIntensity = 0;

    const scene = new THREE.Scene();
    const clock = new THREE.Clock();

    const W = container.clientWidth || width;
    const H = container.clientHeight || height;

    const camera = new THREE.PerspectiveCamera(62, W / H, 0.1, 50);
    camera.position.set(0, 0.7, 2.5);
    camera.lookAt(0, 0.6, 0);

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "default",
      });
    } catch {
      return; // No WebGL — render nothing rather than crashing the shell.
    }
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.6;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // ── Lighting (desktop set from the source) ──
    const hemi = new THREE.HemisphereLight(0xffffff, 0x887766, 1.0);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 4);
    const fill = new THREE.DirectionalLight(0xffeedd, 0.5);
    fill.position.set(-2, 1, 2);
    const accent = new THREE.PointLight(0x00e1ff, 0.4, 10);
    accent.position.set(-1, 1, 2);
    const rim = new THREE.PointLight(0x6366f1, 0.25, 8);
    rim.position.set(0, 0.5, -2);
    scene.add(hemi, key, fill, accent, rim);

    /** Crossfade to a clip (no-op if it's already the running clip). */
    const crossfade = (name: string, fade = 0.3) => {
      const next = actions.get(name);
      if (!next) return;
      if (name === currentName && next.isRunning()) return;
      next.reset();
      const cur = actions.get(currentName);
      if (cur) cur.crossFadeTo(next, fade, true);
      next.play();
      currentName = name;
    };
    const baseClip = () => (talkingRef.current && actions.has("Talking") ? "Talking" : "Idle");

    /** Apply a mood: target morphs + accent colour + animation speed. */
    const applyMood = (mood: MoodName) => {
      for (const k of Object.keys(targetMorphs)) targetMorphs[k] = 0;
      const expr = MOOD_EXPRESSIONS[mood] ?? {};
      for (const k of Object.keys(expr)) if (k in targetMorphs) targetMorphs[k] = expr[k];
      targetColor.set(MOOD_COLOR[mood]);
      targetSpeed = MOOD_SPEED[mood];
    };

    /** Patch a GLB material with the holographic + talk/blink shader. */
    const injectShader = (mat: THREE.Material) => {
      mat.customProgramCacheKey = () => "mascot-holo-v1";
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTalkAmount = animUniforms.uTalkAmount;
        shader.uniforms.uBlinkAmount = animUniforms.uBlinkAmount;
        shader.uniforms.uScanLine = animUniforms.uScanLine;
        shader.uniforms.uFresnelColor = animUniforms.uFresnelColor;
        shader.uniforms.uFresnelPower = animUniforms.uFresnelPower;
        shader.uniforms.uEmissionPulse = animUniforms.uEmissionPulse;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\n${VERT_HEADER}`)
          .replace(
            "#include <morphtarget_vertex>",
            `#include <morphtarget_vertex>\n${VERT_TRANSFORM}`
          );
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>\n${FRAG_HEADER}`)
          .replace(
            "#include <dithering_fragment>",
            `${FRAG_INJECT}\n#include <dithering_fragment>`
          );
      };
      mat.needsUpdate = true;
    };

    // ── Load the model ──
    new GLTFLoader().load(
      src,
      (gltf) => {
        if (disposed || !renderer) return;
        model = gltf.scene;
        scene.add(model);

        model.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Fix GLB materials exported fully metallic with no envMap (→ invisible).
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            if ("metalness" in std) std.metalness = 0;
            if ("roughness" in std) std.roughness = 1;
            injectShader(m);
          }
          // Remember the mesh that carries the facial shape keys.
          if (!morphMesh && mesh.morphTargetDictionary) morphMesh = mesh;
        });

        // Auto-center + scale to ~1.4 world units tall.
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.4 / Math.max(size.x, size.y, size.z || 1);
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.position.y -= box.min.y * scale;
        baseY = model.position.y;

        if (morphMesh?.morphTargetDictionary) {
          morphIndex = morphMesh.morphTargetDictionary;
          for (const k of Object.keys(morphIndex)) targetMorphs[k] = 0;
        }

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          for (const clip of gltf.animations) {
            const action = mixer.clipAction(clip);
            if (LOOPING.has(clip.name)) {
              action.setLoop(THREE.LoopRepeat, Infinity);
            } else {
              action.setLoop(THREE.LoopOnce, 1);
              action.clampWhenFinished = true;
            }
            actions.set(clip.name, action);
          }
          if (actions.has("Enter")) {
            crossfade("Enter", 0);
            mixer.addEventListener("finished", () => {
              if (reactionEnd === 0) crossfade(baseClip(), 0.4);
            });
          } else {
            crossfade(baseClip(), 0);
          }
        }

        useMascotStore.getState().setReady(true);
      },
      undefined,
      () => {
        /* load error — leave the scene empty; the chat panel still works. */
      }
    );

    // ── Drive base loop + mood from the store ──
    const unsub = useMascotStore.subscribe((s) => {
      if (s.talking !== talkingRef.current) {
        talkingRef.current = s.talking;
        if (reactionEnd === 0) crossfade(baseClip());
      }
      const mood = moodFor(s.mood.valence, s.mood.energy);
      if (mood !== currentMood) {
        currentMood = mood;
        applyMood(mood);
      }
    });

    // ── Render loop ──
    const animate = () => {
      if (disposed || !renderer) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.getElapsedTime();
      if (mixer) mixer.update(dt);

      // Reaction timing: end the active one, else start the next queued one.
      if (reactionEnd > 0) {
        if (t >= reactionEnd) {
          reactionEnd = 0;
          crossfade(baseClip(), 0.3);
        }
      } else {
        const r = useMascotStore.getState().dequeueReaction();
        if (r) {
          const { clip, dur } = REACTION[r];
          crossfade(clip, 0.2);
          reactionEnd = t + dur;
        }
      }

      // Mood: ease facial morphs, accent colour, animation speed.
      if (morphMesh?.morphTargetInfluences) {
        const infl = morphMesh.morphTargetInfluences;
        for (const k of Object.keys(targetMorphs)) {
          const idx = morphIndex[k];
          if (idx !== undefined) infl[idx] += (targetMorphs[k] - infl[idx]) * dt * 5;
        }
      }
      moodColor.lerp(targetColor, dt * 3);
      accent.color.copy(moodColor);
      moodSpeed += (targetSpeed - moodSpeed) * dt * 3;
      if (mixer) mixer.timeScale = moodSpeed;

      // Shader: scanline sweep, blink, jaw (talk), emission decay, fresnel colour.
      animUniforms.uScanLine.value = (t * 0.15 * moodSpeed) % 1.0;
      nextBlinkTime -= dt;
      if (nextBlinkTime <= 0 && blinkPhase < 0) {
        blinkPhase = 0;
        nextBlinkTime = 2.5 + Math.random() * 5;
      }
      if (blinkPhase >= 0) {
        blinkPhase += dt * 8;
        if (blinkPhase < 1) animUniforms.uBlinkAmount.value = Math.sin(blinkPhase * Math.PI);
        else {
          animUniforms.uBlinkAmount.value = 0;
          blinkPhase = -1;
        }
      }
      if (talkingRef.current) {
        talkIntensity += (1 - talkIntensity) * dt * 8;
        const tv = Math.sin(t * 18) * 0.4 + Math.sin(t * 13.7) * 0.3 + Math.sin(t * 27.3) * 0.3;
        animUniforms.uTalkAmount.value = Math.max(0, tv) * talkIntensity;
      } else {
        talkIntensity *= 1 - dt * 6;
        animUniforms.uTalkAmount.value *= 1 - dt * 6;
        if (talkIntensity < 0.01) talkIntensity = 0;
      }
      if (animUniforms.uEmissionPulse.value > 0) {
        animUniforms.uEmissionPulse.value *= 1 - dt * 3;
        if (animUniforms.uEmissionPulse.value < 0.01) animUniforms.uEmissionPulse.value = 0;
      }
      animUniforms.uFresnelColor.value.copy(moodColor);

      if (model) model.position.y = baseY + Math.sin(t * 1.6) * 0.012; // breathing
      renderer.render(scene, camera);
    };
    animate();

    // ── Resize ──
    const onResize = () => {
      if (!renderer || !container) return;
      const w = container.clientWidth || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // ── Cleanup (dispose everything; the vanilla version never did) ──
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      unsub();
      mixer?.stopAllAction();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(disposeMaterial);
        else if (mat) disposeMaterial(mat);
      });
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
      useMascotStore.getState().setReady(false);
    };
    // Mount-once: the scene is imperative and self-contained.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className={className} style={{ width, height }} aria-hidden="true" />
  );
}

function disposeMaterial(m: THREE.Material): void {
  for (const key of Object.keys(m)) {
    const val = (m as unknown as Record<string, unknown>)[key];
    if (val && (val as THREE.Texture).isTexture) (val as THREE.Texture).dispose();
  }
  m.dispose();
}
