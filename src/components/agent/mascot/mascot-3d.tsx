"use client";

/**
 * 3D mascot — React/Three.js port of the vanilla mascot (Personal Website
 * Js/mascot-assistant.js initScene/onModelLoaded/animate/playAnimation/
 * runReaction).
 *
 * Phase 2a: scene + lights + GLB + idle, with full disposal on unmount.
 * Phase 2b (this revision): the mascot is driven by useMascotStore —
 *   • `talking` crossfades the base loop between Talking and Idle,
 *   • the reaction queue plays one-shot clips (Wave/Happy/Confused/Thinking)
 *     for the source's durations, then returns to base.
 * Talking/blink shaders, mood expressions, and particles land in later phases.
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

    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let model: THREE.Object3D | null = null;
    let baseY = 0;

    const actions = new Map<string, THREE.AnimationAction>();
    let currentName = "";
    /** Seconds-timestamp the active reaction ends; 0 ⇒ no reaction (base loop). */
    let reactionEnd = 0;
    const talkingRef = { current: false };

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

    // ── Load the model ──
    new GLTFLoader().load(
      src,
      (gltf) => {
        if (disposed || !renderer) return;
        model = gltf.scene;
        scene.add(model);

        // Fix GLB materials exported fully metallic with no envMap (→ invisible).
        model.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            if ("metalness" in std) std.metalness = 0;
            if ("roughness" in std) std.roughness = 1;
          }
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
          // Intro Enter → base (Idle) on finish; else start on base.
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

    // ── Drive the base loop from the store's `talking` flag ──
    const unsub = useMascotStore.subscribe((s) => {
      if (s.talking === talkingRef.current) return;
      talkingRef.current = s.talking;
      if (reactionEnd === 0) crossfade(baseClip());
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
