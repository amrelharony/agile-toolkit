"use client";

/**
 * 3D mascot — React/Three.js port of the vanilla mascot (Personal Website
 * Js/mascot-assistant.js initScene/onModelLoaded/animate).
 *
 * Phase 2a (this file): scene + lights + GLB + skeletal idle animation, driven
 * imperatively by useMascotStore, with full disposal on unmount (the vanilla
 * version relied on a page reload and leaked the renderer + GPU resources).
 * Talking/blink shaders, mood expressions, and particles land in later phases.
 *
 * Mount lazily (next/dynamic, ssr:false) — it's a ~16MB GLB + WebGL, only worth
 * loading once the agent is opened.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useMascotStore } from "@/lib/agent/mascot/store";

interface Mascot3DProps {
  width?: number;
  height?: number;
  className?: string;
  /** GLB url (kept in public/mascot, gitignored for now — see .gitignore). */
  src?: string;
}

/** Clip names that should loop rather than play once (from the source). */
const LOOPING = new Set(["Idle", "Listening", "Talking", "Thinking"]);

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
      // No WebGL — render nothing rather than crashing the app shell.
      return;
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

    // ── Load the model ──
    new GLTFLoader().load(
      src,
      (gltf) => {
        if (disposed || !renderer) return;
        model = gltf.scene;
        scene.add(model);

        // Fix GLB materials that export fully metallic with no envMap (→ invisible).
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

        // Auto-center + scale to a stable size (1.4 world units tall).
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.4 / Math.max(size.x, size.y, size.z || 1);
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.position.y -= box.min.y * scale;
        baseY = model.position.y;

        // Skeletal animations: loop Idle-type clips, play others once.
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
          }
          // Play Enter (intro) then fall back to Idle on finish; else Idle.
          const intro = mixer.clipAction(findClip(gltf.animations, "Enter"));
          const idle = findClip(gltf.animations, "Idle");
          if (intro && hasClip(gltf.animations, "Enter")) {
            intro.play();
            mixer.addEventListener("finished", () => {
              if (idle && mixer) mixer.clipAction(idle).reset().fadeIn(0.4).play();
            });
          } else if (idle && mixer) {
            mixer.clipAction(idle).play();
          }
        }

        useMascotStore.getState().setReady(true);
      },
      undefined,
      () => {
        // Load error — leave the scene empty; the chat panel still works.
      }
    );

    // ── Render loop ──
    const animate = () => {
      if (disposed || !renderer) return;
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      const t = clock.getElapsedTime();
      if (mixer) mixer.update(dt);
      // Gentle idle breathing.
      if (model) model.position.y = baseY + Math.sin(t * 1.6) * 0.012;
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

function findClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip {
  return clips.find((c) => c.name === name) ?? clips[0];
}
function hasClip(clips: THREE.AnimationClip[], name: string): boolean {
  return clips.some((c) => c.name === name);
}
function disposeMaterial(m: THREE.Material): void {
  for (const key of Object.keys(m)) {
    const val = (m as unknown as Record<string, unknown>)[key];
    if (val && (val as THREE.Texture).isTexture) (val as THREE.Texture).dispose();
  }
  m.dispose();
}
