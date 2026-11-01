"use client";

/**
 * Amr — the 2D sprite that stands in the corner of every page. It replaces the
 * 3D mascot: no WebGL, no model parse, one image and CSS frame steps.
 *
 * useMascotStore drives it the way it drove the 3D figure: reactions play one at
 * a time as poses (engine/sprite-poses.ts), `talking` holds the review pose, the
 * mood sets the playback speed and the drone. Between reactions Amr looks at the
 * cursor through the 16 look poses, then settles back to idle. The springs in
 * engine/procedural-anim.ts add small fidgets and a squash on each reaction, and
 * write to the DOM only when they move.
 *
 * Reduced motion shows a still frame of the current pose: no frame steps, no
 * springs, no cursor tracking, no entrance.
 *
 * Mount lazily (next/dynamic, ssr:false).
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore, type MascotReaction } from "@/lib/agent/mascot/store";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { MASCOT_SPRITE_URL } from "./mascot-asset";
import { createMascotDrone } from "./engine/audio/mascot-drone";
import { playMascotSound } from "./engine/audio/mascot-audio";
import { createGestureTracker } from "./engine/interactions/gestures";
import { MOOD_DRONE, MOOD_SPEED, moodFor, type MoodName } from "./engine/mood";
import { createProceduralAnim } from "./engine/procedural-anim";
import { createReactionFx, type MicroName } from "./engine/reactions";
import {
  SHEET,
  chooseShot,
  lookIndex,
  reactionSeconds,
  type Shot,
  type SpritePose,
} from "./engine/sprite-poses";
import styles from "./mascot-assistant.module.css";

interface MascotSpriteProps {
  width?: number;
  height?: number;
  className?: string;
  /** Sheet url — defaults to the committed, content-hashed sheet. */
  src?: string;
  /** The sheet failed to load. */
  onLoadError?: () => void;
}

/** Seconds between spring updates (about 30 fps). */
const TICK_S = 1 / 32;
/** How long Amr keeps looking after the cursor stops moving. */
const LOOK_HOLD_MS = 1800;
/** Where his face sits in the box, for aiming the look poses. */
const FACE_ROW = 0.25;
/** The springs work in model units; the old model was this many units tall. */
const SPRING_UNITS_TALL = 1.4;

const IDLE_SHOT = chooseShot({
  drag: null,
  reaction: null,
  micro: null,
  talking: false,
  look: null,
  reducedMotion: false,
  speed: 1,
});

/** CSS class that plays a shot. `take` flips the keyframes so each new loop restarts. */
function animClass(shot: Shot, take: number): string | undefined {
  if (shot.anim === "frames") return take % 2 ? styles.framesA : styles.framesB;
  if (shot.anim === "idle") return styles.idleLoop;
  if (shot.anim === "spin") return styles.spinTurn;
  if (shot.anim === "wiggle") return styles.wiggleShake;
  return undefined;
}

export default function MascotSprite({
  width = 132,
  height = 143,
  className,
  src = MASCOT_SPRITE_URL,
  onLoadError,
}: MascotSpriteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The effect runs once, so it reads the latest callback and height via a ref.
  const latestRef = useRef({ onLoadError, height });
  latestRef.current = { onLoadError, height };

  const [{ shot, take }, setPlaying] = useState({ shot: IDLE_SHOT, take: 0 });
  const [loaded, setLoaded] = useState(false);
  const auraColor = useMascotStore((s) => s.auraColor);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    let disposed = false;
    let raf = 0;
    let reaction: MascotReaction | null = null;
    let reactionTimer: ReturnType<typeof setTimeout> | undefined;
    let micro: SpritePose | null = null;
    let look: number | null = null;
    let lastMoveAt = 0;
    let speed = 1;
    let currentMood: MoodName = "neutral";
    let shownKey = "";
    let shownTransform = "";
    let pumping = false;

    const nowS = () => performance.now() / 1000;

    const procedural = createProceduralAnim();
    const reactionFx = createReactionFx({
      queueReaction: (r) => useMascotStore.getState().queueReaction(r),
      setBreathTarget: (v) => procedural.setBreathTarget(v),
    });
    // Ambient mood drone (piggybacks the sonification engine; silent unless sound
    // is enabled + the context already exists from another mascot sound).
    const drone = createMascotDrone();
    // Circle gesture → spin, zigzag → wiggle (tracked from the same mousemove).
    const gestureTracker = createGestureTracker((g) =>
      useMascotStore.getState().queueReaction(g === "circle" ? "spin" : "wiggle")
    );

    /** Show the shot the current inputs call for, if it isn't showing already. */
    const refresh = () => {
      const s = useMascotStore.getState();
      const next = chooseShot({
        drag: s.dragDirection,
        reaction,
        micro,
        talking: s.talking,
        look,
        reducedMotion,
        speed,
      });
      if (next.key === shownKey) return;
      shownKey = next.key;
      setPlaying((p) => ({ shot: next, take: p.take + 1 }));
    };

    const startReaction = (r: MascotReaction) => {
      reaction = r;
      if (r !== "wiggle" && !reducedMotion) procedural.triggerSquashStretch("react");
      playMascotSound(r); // reaction sound (no-op if not in the palette / muted)
      reactionTimer = setTimeout(
        () => {
          reaction = null;
          pump();
          refresh();
        },
        reactionSeconds(r, speed) * 1000
      );
    };

    /** Take the next queued reaction and micro-expression off the store. */
    const pump = () => {
      if (pumping) return; // dequeuing notifies the subscriber below
      pumping = true;
      const store = useMascotStore.getState();
      if (!reaction) {
        const r = store.dequeueReaction();
        if (r) startReaction(r);
      }
      const queuedMicro = store.dequeueMicroExpression();
      if (queuedMicro && !reducedMotion) {
        reactionFx.triggerMicroExpression(queuedMicro as MicroName, nowS());
      }
      pumping = false;
    };

    const unsub = useMascotStore.subscribe((s) => {
      const mood = moodFor(s.mood.valence, s.mood.energy);
      if (mood !== currentMood) {
        currentMood = mood;
        speed = MOOD_SPEED[mood];
        drone.setMood(MOOD_DRONE[mood]);
        playMascotSound("mood"); // soft swell on mood change (source plays 'mood')
      }
      pump();
      refresh();
    });

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      gestureTracker.track(e.clientX, e.clientY, cx, cy, nowS());
      look = lookIndex(e.clientX - cx, e.clientY - (rect.top + rect.height * FACE_ROW));
      lastMoveAt = performance.now();
      refresh();
    };

    // Springs, quirks and the look timeout. The frames themselves are CSS.
    let lastTick = 0;
    const tick = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const elapsed = (now - lastTick) / 1000;
      if (elapsed < TICK_S) return;
      lastTick = now;

      const talking = useMascotStore.getState().talking;
      const isOpen = useAgentStore.getState().open;
      const t = now / 1000;
      reactionFx.updateQuirks(t, { isOpen, isTalking: talking, activeReaction: !!reaction });
      micro = reactionFx.activeMicroExpression(t)?.pose ?? null;
      if (look !== null && now - lastMoveAt > LOOK_HOLD_MS) look = null;
      refresh();

      const pa = procedural.update({
        dt: Math.min(elapsed, 0.1),
        activeReaction: !!reaction,
        isTalking: talking,
        isOpen,
        reducedMotion,
        hooks: {
          requestBlink: () => {
            /* the idle row blinks on its own */
          },
          emitSparkles: () => {
            /* no particles on the sprite */
          },
        },
      });
      const unit = latestRef.current.height / SPRING_UNITS_TALL;
      const transform = `translate(${(pa.bodyLean * unit).toFixed(1)}px, ${(
        -(pa.bobY + pa.breathScale) * unit
      ).toFixed(1)}px) scale(${pa.scaleXZ.toFixed(3)}, ${pa.scaleY.toFixed(3)})`;
      if (transform !== shownTransform && bodyRef.current) {
        shownTransform = transform;
        bodyRef.current.style.transform = transform;
      }

      // Ambient drone: gated on the sound pref + reduced-motion, modulated by
      // the procedural springs (breath = louder, lean = brighter, bob = wobble).
      drone.setEnabled(useSonificationStore.getState().enabled && !reducedMotion);
      drone.update({ breath: pa.breathScale, lean: pa.bodyLean, bob: pa.bobY });
    };

    const sheet = new Image();
    sheet.onload = () => {
      if (disposed) return;
      setLoaded(true);
      useMascotStore.getState().setReady(true);
      playMascotSound("open"); // entrance chime (source plays 'open')
      if (!reducedMotion) {
        window.addEventListener("mousemove", onMouseMove, { passive: true });
        raf = requestAnimationFrame(tick);
      }
      pump();
      refresh();
    };
    sheet.onerror = () => {
      // Leave the launcher up; the panel still works.
      if (!disposed) latestRef.current.onLoadError?.();
    };
    sheet.src = src;

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(reactionTimer);
      window.removeEventListener("mousemove", onMouseMove);
      gestureTracker.dispose();
      unsub();
      drone.dispose();
      sheet.onload = null;
      sheet.onerror = null;
      useMascotStore.getState().setReady(false);
    };
    // Mount-once: the state machine is imperative and self-contained.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheetStyle = {
    width,
    height,
    backgroundImage: `url(${src})`,
    backgroundSize: `${width * SHEET.columns}px ${height * SHEET.rows}px`,
    backgroundPosition: `${-shot.col * width}px ${-shot.row * height}px`,
    "--cell-w": `${width}px`,
    "--cell-h": `${height}px`,
    "--frames": shot.frames,
    "--loop": `${shot.seconds}s`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className={cn(loaded && styles.enter, className)}
      style={{ width, height }}
      aria-hidden="true"
      data-amr-shot={shot.key}
    >
      <div
        ref={bodyRef}
        className={styles.body}
        style={auraColor ? { filter: `drop-shadow(0 0 10px ${auraColor})` } : undefined}
      >
        <div className={cn(styles.sheet, animClass(shot, take))} style={sheetStyle} />
      </div>
    </div>
  );
}
