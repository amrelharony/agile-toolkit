"use client";

/**
 * 3D mascot — React/Three.js port of the vanilla mascot (Personal Website
 * Js/mascot-assistant.js).
 *
 * Phase 2a: scene + lights + GLB + idle, full disposal on unmount.
 * Phase 2b: useMascotStore drives skeletal clips (talking → Talking/Idle;
 *           reaction queue → Wave/Happy/Confused/Thinking one-shots).
 * Phase 2c: sentiment MOOD — store.mood ({valence,energy}) maps to a mood that
 *           drives facial morph-target expressions (MOOD_EXPRESSIONS), the
 *           accent-light colour (MOOD_COLORS), and the animation speed
 *           (MOOD_SPEEDS), all eased per frame.
 * Phase 2 polish: holographic shader (onBeforeCompile — fresnel rim, scanline,
 *           talk-jaw + blink vertex deforms).
 * Phase 7: visual parity with the source — skin retint (engine/retint-skin.ts)
 *           + the full 4-region (head/face/eye/jaw) holographic shader
 *           (engine/holo-shader.ts), both extracted into testable modules.
 * Phase 8: weather particles (engine/particles/weather-particles.ts, fed from
 *           useWeather) + GSAP entrance pop (engine/entrance.ts). The earlier
 *           ad-hoc particle aura is removed — the source's 4-layer ultra
 *           particles are disabled at source, so the live site shows only these.
 * Phase 9: procedural physics (engine/procedural-anim.ts — springs, idle
 *           fidgets, squash-stretch; replaces the sine bob) + cursor head-
 *           tracking (the mascot rotates toward the pointer). Both reduced-
 *           motion gated.
 * Phase 10: reaction parity — procedural spin/wiggle (override head-track) +
 *           emission/squash side-effects, plus micro-expressions + rare idle
 *           personality quirks (engine/reactions.ts).
 *
 * Mount lazily (next/dynamic, ssr:false) — ~16MB GLB + WebGL.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useMascotStore, type MascotReaction } from "@/lib/agent/mascot/store";
import { useAgentStore } from "@/lib/agent/store";
import { createHoloUniforms, injectHoloShader } from "./engine/holo-shader";
import { retintSkinTexture } from "./engine/retint-skin";
import {
  createWeatherParticles,
  weatherCodeToType,
  type WeatherParticles,
} from "./engine/particles/weather-particles";
import { playEntrance } from "./engine/entrance";
import { createProceduralAnim } from "./engine/procedural-anim";
import { createReactionFx } from "./engine/reactions";
import { useWeather } from "@/lib/weather/provider";

interface Mascot3DProps {
  width?: number;
  height?: number;
  className?: string;
  /** GLB url (kept in public/mascot, gitignored for now — see .gitignore). */
  src?: string;
}

/** Clip names that loop rather than play once (from the source). */
const LOOPING = new Set(["Idle", "Listening", "Talking", "Thinking"]);

/**
 * Reaction descriptors (source runReaction). Clip reactions crossfade a skeletal
 * clip; `proc` reactions (spin/wiggle) are procedural Y-rotations applied in the
 * RAF. `emission` flashes the holographic pulse; durations mirror the source.
 */
const REACTION: Record<
  MascotReaction,
  { clip?: string; dur: number; emission?: number; proc?: "spin" | "wiggle" }
> = {
  thinking: { clip: "Thinking", dur: 4.2, emission: 0.3 },
  listening: { clip: "Listening", dur: 3.75 },
  talking: { clip: "Talking", dur: 2.5 },
  excited: { clip: "Happy", dur: 2.0, emission: 0.5 },
  nod: { clip: "Happy", dur: 2.0 },
  headShake: { clip: "Confused", dur: 1.5 },
  wave: { clip: "Wave", dur: 2.5 },
  spin: { dur: 0.7, emission: 0.3, proc: "spin" },
  wiggle: { dur: 0.5, proc: "wiggle" },
  dance: { clip: "Happy", dur: 2.5 },
  confused: { clip: "Confused", dur: 1.5 },
  surprised: { clip: "Happy", dur: 1.5 },
};

/** Quadratic ease-in-out (source easeInOut) — used by the spin reaction. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

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

// Holographic shader (4-region masks + fresnel/scanline/emission) lives in
// engine/holo-shader.ts; the skin retint in engine/retint-skin.ts.

export default function Mascot3D({
  width = 160,
  height = 280,
  className,
  src = "/mascot/mascot.glb",
}: Mascot3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const weatherSysRef = useRef<WeatherParticles | null>(null);

  // Current weather → particle type (the source reads localStorage; we use the
  // toolkit's weather hook). Fed into the live system by the effect below.
  const weatherCode = useWeather().weather?.code ?? null;
  useEffect(() => {
    weatherSysRef.current?.setType(weatherCodeToType(weatherCode));
  }, [weatherCode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
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
    let baseScale = 1;
    let entranceTl: ReturnType<typeof playEntrance> = null;
    let entranceDone = false;

    // Animation state.
    const actions = new Map<string, THREE.AnimationAction>();
    let currentName = "";
    let reactionEnd = 0; // seconds-timestamp the active reaction ends; 0 ⇒ base loop
    let reactionName: MascotReaction = "thinking"; // the active reaction
    let reactionStart = 0; // seconds-timestamp the active reaction began
    let reactionBaseRotY = 0; // model rotation.y captured at reaction start
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
    const animUniforms = createHoloUniforms();
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

    // ── Weather particles (8 points). The source's 4-layer ultra-particles are
    //    DISABLED at source (all counts 0), so the live site shows only these +
    //    the holographic shader. Type fed in below + by the [weatherCode] effect.
    const weatherSys = createWeatherParticles(scene);
    weatherSysRef.current = weatherSys;
    weatherSys.setType(weatherCodeToType(weatherCode));

    // Procedural physics (springs/fidgets/squash) + cursor head-tracking.
    const procedural = createProceduralAnim();
    // Micro-expressions + personality quirks (idle "personality").
    const reactionFx = createReactionFx({
      queueReaction: (r) => useMascotStore.getState().queueReaction(r),
      setBreathTarget: (v) => procedural.setBreathTarget(v),
    });
    const mouseNDC = { x: 0, y: 0 };
    let headCurrentX = 0;
    let headCurrentY = 0;
    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      mouseNDC.x = Math.max(-1, Math.min(1, (e.clientX - cx) / 250));
      mouseNDC.y = Math.max(-1, Math.min(1, -(e.clientY - cy) / 250));
    };
    if (!reducedMotion) window.addEventListener("mousemove", onMouseMove);

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
            // Recolour the baked skin to the owner's tone (source retintSkin),
            // then patch in the holographic shader.
            retintSkinTexture(std.map);
            injectHoloShader(m, animUniforms);
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
        baseScale = scale;

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

        // Entrance: elastic pop-in + accent fade + emission flash (source
        // createEntranceTimeline). Skips to final state under reduced-motion.
        entranceTl = playEntrance({
          model,
          baseScale: scale,
          uniforms: animUniforms,
          accent,
          reducedMotion,
        });
        // Gate procedural scale (squash-stretch) until the entrance scale tween
        // finishes, so the two don't fight over model.scale.
        if (entranceTl) entranceTl.eventCallback("onComplete", () => (entranceDone = true));
        else entranceDone = true;
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

      // Reaction timing. spin/wiggle are PROCEDURAL Y-rotations (procRotY, applied
      // in the head-track block so they win over head-follow); the rest crossfade
      // a clip. On start: capture the base rotation, flash emission, squash.
      let procRotY: number | null = null;
      if (reactionEnd > 0) {
        const desc = REACTION[reactionName];
        const elapsed = t - reactionStart;
        if (desc.proc === "spin") {
          procRotY = reactionBaseRotY + easeInOut(Math.min(elapsed / 0.7, 1)) * Math.PI * 2;
        } else if (desc.proc === "wiggle") {
          procRotY = reactionBaseRotY + Math.sin(elapsed * 16 * Math.PI) * 0.04 * (1 - elapsed * 2);
        }
        if (t >= reactionEnd) {
          reactionEnd = 0;
          crossfade(baseClip(), 0.3);
        }
      } else {
        const r = useMascotStore.getState().dequeueReaction();
        if (r) {
          const desc = REACTION[r];
          reactionName = r;
          reactionStart = t;
          reactionEnd = t + desc.dur;
          reactionBaseRotY = model ? model.rotation.y : 0;
          if (desc.clip) crossfade(desc.clip, 0.2);
          if (desc.emission) animUniforms.uEmissionPulse.value = desc.emission;
          if (r !== "wiggle") procedural.triggerSquashStretch("react");
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

      // Personality: maybe fire a rare idle quirk; overlay any active
      // micro-expression on top of the eased mood morphs.
      reactionFx.updateQuirks(t, {
        isOpen: useAgentStore.getState().open,
        isTalking: talkingRef.current,
        activeReaction: reactionEnd > 0,
      });
      const micro = reactionFx.activeMicroExpression(t);
      if (micro && morphMesh?.morphTargetInfluences) {
        const infl = morphMesh.morphTargetInfluences;
        for (const name of Object.keys(micro.targets)) {
          const idx = morphIndex[name];
          if (idx !== undefined) {
            const base = targetMorphs[name] ?? 0;
            infl[idx] = base + (micro.targets[name] - base) * micro.intensity;
          }
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

      // Procedural physics: springs + idle fidgets + squash-stretch. Replaces
      // the ad-hoc sine bob — the source rests the springs at 0 (the Idle clip
      // carries base motion) and nudges them with fidgets every 8-20s.
      const pa = procedural.update({
        dt,
        activeReaction: reactionEnd > 0,
        isTalking: talkingRef.current,
        isOpen: useAgentStore.getState().open,
        reducedMotion,
        hooks: {
          requestBlink: () => {
            if (blinkPhase < 0) {
              blinkPhase = 0;
              nextBlinkTime = 0.15;
            }
          },
          emitSparkles: () => {
            /* ultra-particles disabled at source — no-op */
          },
        },
      });
      if (model) {
        model.position.x = pa.bodyLean;
        model.position.y = baseY + pa.bobY + pa.breathScale;
        if (entranceDone) {
          model.scale.y = baseScale * pa.scaleY;
          model.scale.x = model.scale.z = baseScale * pa.scaleXZ;
        }
        // Cursor head-tracking: rotate toward the pointer, kept upright. A
        // spin/wiggle reaction (procRotY) overrides the Y rotation while active.
        if (!reducedMotion) {
          if (procRotY !== null) {
            model.rotation.y = procRotY;
          } else {
            headCurrentX += (-mouseNDC.y * 0.06 - headCurrentX) * dt * 3;
            headCurrentY += (mouseNDC.x * 0.15 - headCurrentY) * dt * 3;
            model.rotation.x = Math.max(-0.06, Math.min(0.06, headCurrentX));
            model.rotation.y = headCurrentY;
          }
        }
      }

      // Weather particles drift, following the mascot's position.
      weatherSys.update({
        t,
        offX: model?.position.x ?? 0,
        offY: model ? model.position.y - baseY : 0,
        accent,
        reducedMotion,
      });

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
      window.removeEventListener("mousemove", onMouseMove);
      unsub();
      entranceTl?.kill();
      weatherSys.dispose();
      weatherSysRef.current = null;
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
