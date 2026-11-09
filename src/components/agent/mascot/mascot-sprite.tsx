"use client";

/**
 * Amr — the 2D sprite that stands in the corner of every page. It replaces the
 * 3D mascot: no WebGL, no model parse, one image and CSS frame steps.
 *
 * useMascotStore drives it the way it drove the 3D figure: reactions play one at
 * a time as poses (engine/sprite-poses.ts), `talking` holds the talking clip, the
 * mood sets the playback speed and the drone. Between reactions Amr looks at the
 * cursor through the 16 look poses, then settles back to idle. The springs in
 * engine/procedural-anim.ts add small fidgets and a squash on each reaction, and
 * write to the DOM only when they move.
 *
 * The interactive pet's reactions and held poses (engine/clips.ts) play on a
 * second layer, from lazy packs (engine/packs.ts) fetched when the page is idle
 * or the first time a clip needs one; a live-sheet pose stands in until then.
 * That layer is painted here, frame by frame, without re-rendering React: the
 * lip-sync while a reply streams (engine/talk.ts), the dangle while he's
 * carried (with a pendulum swing), the stroll's slide along the bottom. A pack's
 * cells are taller than the live sheet's, with room on top for a raised prop, so
 * the layer stands on his floor and takes the height of the cell it paints. A
 * weather or fireworks scene also sets the air around him (mascot-fx.tsx). His
 * senses (engine/senses.ts) start once he's on screen.
 *
 * On a phone that lets him feel it (engine/interactions/sensors.ts) the tilt is
 * read here every tick: he leans against it from his feet, skids a little toward
 * the low side (his button moves, so a tap still finds him), looks where the
 * phone tips, and the rain falls the way gravity points.
 *
 * Reduced motion shows a still frame of the current pose: no frame steps, no
 * springs, no cursor tracking, no entrance, no sensors or stroll.
 *
 * Mount lazily (next/dynamic, ssr:false).
 */

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore, type MascotReaction } from "@/lib/agent/mascot/store";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { MASCOT_SPRITE_URL } from "./mascot-asset";
import { FRAMES, PACK_CELL, PACK_COLUMNS, type FrameId, type PackId } from "./mascot-packs";
import { createMascotDrone } from "./engine/audio/mascot-drone";
import { playMascotSound } from "./engine/audio/mascot-audio";
import {
  STROLL_FROM_LEFT,
  STROLL_FROM_RIGHT,
  clipFrameAt,
  type Clip,
  type FrameRef,
} from "./engine/clips";
import { createAttention, scrollLook } from "./engine/attention";
import { createGestureTracker } from "./engine/interactions/gestures";
import { leanFor, restingFrame, skidFor } from "./engine/interactions/sensors";
import { MOOD_DRONE, MOOD_SPEED, moodFor, type MoodName } from "./engine/mood";
import { createPackLoader, wantsSharp } from "./engine/packs";
import { createProceduralAnim } from "./engine/procedural-anim";
import { createReactionFx, type MicroName } from "./engine/reactions";
import { installSenses } from "./engine/senses";
import {
  FIGURE_BOTTOM,
  FIGURE_TOP,
  SHEET,
  chooseShot,
  lookIndex,
  reactionSeconds,
  tiltLook,
  type Shot,
  type SpritePose,
} from "./engine/sprite-poses";
import { createTalker } from "./engine/talk";
import { sceneFx, type SceneFx } from "./engine/scene-fx";
import { FX_FADE_MS, MascotFx } from "./mascot-fx";
import styles from "./mascot-assistant.module.css";

interface MascotSpriteProps {
  width?: number;
  height?: number;
  className?: string;
  /** Sheet url — defaults to the committed, content-hashed sheet. */
  src?: string;
  /** The sheet failed to load. */
  onLoadError?: () => void;
  /** What the stroll slides along the bottom of the screen (his button). */
  moveRef?: RefObject<HTMLElement | null>;
}

/** Seconds between spring updates (about 30 fps). */
const TICK_S = 1 / 32;
/** How long Amr keeps looking after the cursor stops moving. */
const LOOK_HOLD_MS = 1800;
/** How long he keeps looking where a tilt, a finger or a field drew his eye, once it's gone. */
const LOOK_LINGER_MS = 400;
/** Where his face sits in the box, for aiming the look poses. */
const FACE_ROW = 0.25;
/** The springs work in model units; the old model was this many units tall. */
const SPRING_UNITS_TALL = 1.4;
/** Loaded as soon as the page is idle: touch, faces and being picked up. */
const CORE_PACKS: PackId[] = ["faces", "touch", "lifted"];
/** Loaded a little later, unless the connection is slow. */
const LATER_PACKS: PackId[] = ["page", "social", "balance", "point"];
const LATER_MS = 20_000;
/** A pointer passing him faster than this (px/s), this close (px), startles him. */
const FAST_PASS = { speed: 2400, near: 160, cooldownMs: 15_000 };
/** Carried: frames by sideways speed (px/s). */
const SWING_V = 140;
const FLAIL_V = 1400;
/** A drag report older than this means the pointer has stopped. */
const DRAG_STALE_MS = 150;
/** A tilt reading older than this means the phone has stopped sending them. */
const MOTION_STALE_MS = 700;
/** The clear space each side of him in his box, as a share of its width: a skid may use it. */
const SKID_SPARE = 0.28;
/** The rain slants with the tilt up to this many degrees. */
const SLANT_MAX_DEG = 35;

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

function whenIdle(fn: () => void): void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 4000 });
  else setTimeout(fn, 300);
}

function slowConnection(): boolean {
  const c = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return c?.effectiveType === "slow-2g" || c?.effectiveType === "2g";
}

export default function MascotSprite({
  width = 132,
  height = 143,
  className,
  src = MASCOT_SPRITE_URL,
  onLoadError,
  moveRef,
}: MascotSpriteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leanRef = useRef<HTMLDivElement>(null);
  const swingRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  // The effect runs once, so it reads the latest props via a ref.
  const latestRef = useRef({ onLoadError, width, height, src, moveRef });
  latestRef.current = { onLoadError, width, height, src, moveRef };

  const [{ shot, take }, setPlaying] = useState({ shot: IDLE_SHOT, take: 0 });
  const [loaded, setLoaded] = useState(false);
  const auraColor = useMascotStore((s) => s.auraColor);
  // The air around him for a weather or fireworks scene; it clears after the scene.
  const [fx, setFx] = useState<{ kind: SceneFx; leaving: boolean } | null>(null);

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
    let shown: Shot = IDLE_SHOT;
    let shownTransform = "";
    let pumping = false;
    let lastInterrupt = useMascotStore.getState().interrupt;
    let disposeSenses: (() => void) | null = null;
    let laterTimer: ReturnType<typeof setTimeout> | undefined;

    // The clip layer: when the clip started, what's painted, how far it walked him.
    let clipStart = 0;
    let painted = "";
    let movedX = 0;
    let swingVx = 0;
    const swing = { angle: 0, vel: 0 };
    let shownSwing = "";
    let lastPointer: { x: number; y: number; t: number } | null = null;
    let lastStartle = -Infinity;
    let lastMouseAt = -Infinity;

    // What has his eye when no cursor does: a finger, a field, the scroll.
    const attention = createAttention();
    let lastScrollY = window.scrollY;
    let lastScrollLook = -Infinity;

    // The phone's pose, written by his senses and read in the tick below.
    const motion = restingFrame();
    const lean = { angle: 0, vel: 0 };
    let shownLean = "";
    const skid = { x: 0, vel: 0 };
    let skidPx = 0;
    let skidRoom: { left: number; right: number; at: number } | null = null;
    let shownSlant = 0;

    const nowS = () => performance.now() / 1000;

    const loader = createPackLoader(
      wantsSharp(latestRef.current.width, window.devicePixelRatio),
      () => refresh()
    );
    const talker = createTalker();
    const procedural = createProceduralAnim();
    const reactionFx = createReactionFx({
      queueReaction: (r) => useMascotStore.getState().queueReaction(r),
      setBreathTarget: (v) => procedural.setBreathTarget(v),
    });
    // Ambient mood drone (piggybacks the sonification engine; silent unless sound
    // is enabled + the context already exists from another mascot sound).
    const drone = createMascotDrone();
    // Circle gesture → spin, back-and-forth over him → tickle.
    const gestureTracker = createGestureTracker((g) =>
      useMascotStore.getState().queueReaction(g === "circle" ? "spin" : "tickle")
    );

    /** He's parked on the left half of the screen: a stroll heads right first. */
    const strollClip = (): Clip => {
      const r = container.getBoundingClientRect();
      return r.left + r.width / 2 < window.innerWidth / 2 ? STROLL_FROM_LEFT : STROLL_FROM_RIGHT;
    };

    /** Put a frame on the clip layer (no-op when it's already there). */
    const paintFrame = (ref: FrameRef) => {
      const el = clipRef.current;
      if (!el) return;
      const { width: w, height: h, src: baseSrc } = latestRef.current;
      let url: string;
      let rows: number;
      let index: number;
      let cellH = h;
      if (ref.startsWith("base:")) {
        const [, row, col] = ref.split(":").map(Number);
        url = baseSrc;
        rows = SHEET.rows;
        index = row * SHEET.columns + col;
      } else {
        const [pack, i] = FRAMES[ref as FrameId];
        url = loader.url(pack);
        rows = loader.rows(pack);
        index = i;
        cellH = (h * PACK_CELL.h) / SHEET.cellH;
      }
      const key = `${url}#${index}@${w}`;
      if (key === painted) return;
      painted = key;
      el.style.height = `${cellH}px`;
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = `${w * PACK_COLUMNS}px ${cellH * rows}px`;
      el.style.backgroundPosition = `${-(index % PACK_COLUMNS) * w}px ${-Math.floor(index / PACK_COLUMNS) * cellH}px`;
    };

    /** Put his button where the stroll and the skid have taken him. */
    const place = () => {
      const el = latestRef.current.moveRef?.current;
      if (!el) return;
      const px = (movedX * latestRef.current.width) / SHEET.cellW + skidPx;
      el.style.translate = Math.abs(px) < 0.05 ? "" : `${px.toFixed(1)}px 0`;
    };

    /** Slide him (the stroll) by `x` sheet px; 0 puts him back. */
    const moveBy = (x: number) => {
      if (x === movedX) return;
      movedX = x;
      place();
    };

    /** Slide him (the tilt's skid) by `px` css px; 0 puts him back. */
    const skidBy = (px: number) => {
      if (px === skidPx) return;
      skidPx = px;
      place();
    };

    /** How far he can skid each way before his figure would leave the screen (css px). */
    const roomToSkid = (now: number) => {
      if (skidRoom && now - skidRoom.at < 1000) return skidRoom;
      const el = latestRef.current.moveRef?.current;
      const w = latestRef.current.width;
      if (!el) return (skidRoom = { left: 0, right: 0, at: now });
      const r = el.getBoundingClientRect();
      const moved = (movedX * w) / SHEET.cellW + skidPx;
      skidRoom = {
        left: Math.max(0, r.left - moved + w * SKID_SPARE),
        right: Math.max(0, window.innerWidth - (r.right - moved) + w * SKID_SPARE),
        at: now,
      };
      return skidRoom;
    };

    /** The carried frame for the drag's current speed. */
    const liftedFrame = (): FrameId => {
      const v = Math.abs(swingVx);
      if (v > FLAIL_V) return "lifted.flail";
      if (v < SWING_V) return "lifted.hang";
      // Moving right, his legs trail to the left.
      return swingVx > 0 ? "lifted.swing-l" : "lifted.swing-r";
    };

    /** Paint the clip layer for `now` (ms, performance clock). */
    const paintClip = (now: number) => {
      const c = shown.anim === "clip" ? shown.clip : undefined;
      if (!c) {
        moveBy(0);
        return;
      }
      if (shown.still) {
        moveBy(0);
        paintFrame(c.driven === "lifted" ? "lifted.hang" : c.still);
        return;
      }
      if (c.driven === "lifted") {
        paintFrame(liftedFrame());
      } else if (c.driven === "talk") {
        paintFrame(talker.frame(now, useMascotStore.getState().speechPulse));
      } else {
        const { f, x } = clipFrameAt(c, now - clipStart);
        paintFrame(f);
        moveBy(x);
      }
    };

    /** Show the shot the current inputs call for, if it isn't showing already. */
    const refresh = () => {
      if (disposed) return;
      const s = useMascotStore.getState();
      const next = chooseShot({
        drag: s.drag,
        holds: s.holds,
        reaction,
        micro,
        talking: s.talking,
        look,
        reducedMotion,
        speed,
        ready: loader.isReady,
        stroll: reaction === "stroll" ? strollClip() : undefined,
      });
      if (next.needs) loader.ensure(next.needs);
      if (next.key === shown.key) return;
      const wasTalk = shown.clip?.driven === "talk";
      shown = next;
      clipStart = performance.now();
      if (next.clip?.driven === "talk" && !wasTalk) talker.reset();
      paintClip(clipStart);
      setPlaying((p) => ({ shot: next, take: p.take + 1 }));
    };

    const endReaction = () => {
      clearTimeout(reactionTimer);
      reactionTimer = undefined;
      reaction = null;
    };

    const startReaction = (r: MascotReaction) => {
      reaction = r;
      if (r !== "wiggle" && !reducedMotion) {
        procedural.triggerSquashStretch(r === "land" ? "land" : "react");
      }
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
      // playNow: cut the current reaction short for the one it queued.
      if (s.interrupt !== lastInterrupt) {
        lastInterrupt = s.interrupt;
        endReaction();
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
      const t = performance.now();
      lastMoveAt = t;
      lastMouseAt = t;
      // A pointer whizzing past close by startles him.
      if (lastPointer && t > lastPointer.t) {
        const v =
          (Math.hypot(e.clientX - lastPointer.x, e.clientY - lastPointer.y) / (t - lastPointer.t)) *
          1000;
        const near = Math.hypot(e.clientX - cx, e.clientY - cy) < FAST_PASS.near;
        if (v > FAST_PASS.speed && near && t - lastStartle > FAST_PASS.cooldownMs && !reaction) {
          lastStartle = t;
          useMascotStore.getState().queueReaction("startle");
        }
      }
      lastPointer = { x: e.clientX, y: e.clientY, t };
      refresh();
    };

    /** Where his face is on screen: what a look is aimed from. */
    const faceAt = () => {
      const rect = container.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height * FACE_ROW };
    };
    const onTouch = (e: TouchEvent) => {
      const finger = e.touches[0];
      if (finger) attention.see("touch", finger.clientX, finger.clientY, performance.now());
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      // A field in his own panel is him being talked to, not something to glance at.
      if (!el?.getBoundingClientRect || el.closest?.("[data-agent-sheet-root]")) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      attention.see("focus", r.left + r.width / 2, r.top + r.height / 2, performance.now());
    };
    const onScrollLook = () => {
      const t = performance.now();
      const y = window.scrollY;
      const dy = y - lastScrollY;
      lastScrollY = y;
      if (t - lastScrollLook < 120) return;
      const toward = scrollLook(faceAt(), dy);
      if (!toward) return;
      lastScrollLook = t;
      attention.see("scroll", toward.x, toward.y, t);
    };

    // Hovering or pressing him: get the packs his touch reactions need.
    const onPointerOver = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-mascot-hit]")) loader.ensure([...CORE_PACKS, "social", "balance"]);
    };

    // Springs, quirks, the look timeout and the clip layer's frames.
    let lastTick = 0;
    const tick = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const elapsed = (now - lastTick) / 1000;
      if (elapsed < TICK_S) return;
      lastTick = now;

      const store = useMascotStore.getState();
      const talking = store.talking;
      const isOpen = useAgentStore.getState().open;
      const t = now / 1000;
      reactionFx.updateQuirks(t, {
        isOpen,
        isTalking: talking,
        activeReaction: !!reaction || store.holds.length > 0,
      });
      micro = reactionFx.activeMicroExpression(t)?.pose ?? null;
      if (look !== null && now - lastMoveAt > LOOK_HOLD_MS) look = null;
      refresh();

      // Carried: ease toward the drag's speed (zero once the pointer rests).
      const drag = store.drag;
      const vx = drag && Date.now() - drag.at < DRAG_STALE_MS ? drag.vx : 0;
      swingVx += (vx - swingVx) * 0.3;
      paintClip(now);

      // The pendulum: he swings from the collar while carried, and settles after.
      const dt = Math.min(elapsed, 0.1);
      const target = drag ? Math.max(-9, Math.min(9, swingVx * 0.008)) : 0;
      swing.vel += ((target - swing.angle) * 90 - swing.vel * 7) * dt;
      swing.angle += swing.vel * dt;
      const rot = Math.abs(swing.angle) < 0.05 ? "" : `rotate(${swing.angle.toFixed(2)}deg)`;
      if (rot !== shownSwing && swingRef.current) {
        shownSwing = rot;
        swingRef.current.style.transform = rot;
      }

      // The phone's tilt. He leans against it from his feet to stay upright...
      const tilted = motion.live && Date.now() - motion.at < MOTION_STALE_MS;
      const roll = tilted ? motion.roll : 0;
      const leanTo = drag ? 0 : leanFor(roll);
      lean.vel += ((leanTo - lean.angle) * 60 - lean.vel * 9) * dt;
      lean.angle += lean.vel * dt;
      const leaning = Math.abs(lean.angle) < 0.05 ? "" : `rotate(${lean.angle.toFixed(2)}deg)`;
      if (leaning !== shownLean && leanRef.current) {
        shownLean = leaning;
        leanRef.current.style.transform = leaning;
      }
      // ...skids a little toward the low side, as far as the screen lets him...
      let skidTo = 0;
      const share = skidFor(roll);
      if (
        share !== 0 &&
        !drag &&
        !isOpen &&
        reaction !== "stroll" &&
        !store.holds.includes("flying") &&
        !store.holds.includes("falling")
      ) {
        const room = roomToSkid(now);
        skidTo = Math.max(-room.left, Math.min(room.right, share * latestRef.current.width));
      }
      skid.vel += ((skidTo - skid.x) * 40 - skid.vel * 10) * dt;
      skid.x += skid.vel * dt;
      skidBy(Math.abs(skid.x) < 0.3 ? 0 : Math.round(skid.x * 2) / 2);
      // ...and looks where it tips. A cursor has his eye first, then a finger on
      // the screen, then the tilt, then a field just entered or the page scrolling by.
      if (now - lastMouseAt > LOOK_HOLD_MS) {
        const seen = attention.target(now);
        let toward =
          tilted && seen?.source !== "touch" ? tiltLook(motion.roll, motion.pitch) : null;
        if (toward === null && seen) {
          const face = faceAt();
          toward = lookIndex(seen.x - face.x, seen.y - face.y);
        }
        if (toward !== null) {
          look = toward;
          // Not a cursor that may come back: once it's gone he faces the visitor again.
          lastMoveAt = now - (LOOK_HOLD_MS - LOOK_LINGER_MS);
        }
      }
      // The rain falls the way gravity points (mascot-fx.module.css reads these).
      const slant = Math.round(Math.max(-SLANT_MAX_DEG, Math.min(SLANT_MAX_DEG, roll)));
      if (slant !== shownSlant) {
        shownSlant = slant;
        container.style.setProperty("--amr-roll", `${slant}deg`);
        container.style.setProperty("--amr-slant", Math.tan((slant * Math.PI) / 180).toFixed(3));
      }

      const pa = procedural.update({
        dt,
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
        window.addEventListener("touchstart", onTouch, { passive: true });
        window.addEventListener("touchmove", onTouch, { passive: true });
        window.addEventListener("scroll", onScrollLook, { passive: true });
        document.addEventListener("focusin", onFocusIn);
        raf = requestAnimationFrame(tick);
      }
      window.addEventListener("pointerover", onPointerOver, { passive: true });
      disposeSenses = installSenses({
        reducedMotion,
        figure: () => containerRef.current,
        want: (packs) => loader.ensure(packs),
        motion,
      });
      whenIdle(() => loader.ensure(CORE_PACKS));
      laterTimer = setTimeout(() => {
        if (!slowConnection()) whenIdle(() => loader.ensure(LATER_PACKS));
      }, LATER_MS);
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
      clearTimeout(laterTimer);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("scroll", onScrollLook);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("pointerover", onPointerOver);
      disposeSenses?.();
      gestureTracker.dispose();
      unsub();
      drone.dispose();
      loader.dispose();
      skidPx = 0;
      movedX = 0;
      place();
      sheet.onload = null;
      sheet.onerror = null;
      useMascotStore.getState().setReady(false);
    };
    // Mount-once: the state machine is imperative and self-contained.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isClip = shot.anim === "clip";
  const dozing = shot.clip?.name === "hold.dozing";
  // A still frame (reduced motion) gets no air.
  const fxNow = isClip && !shot.still && shot.clip ? sceneFx(shot.clip.name) : null;
  useEffect(() => {
    if (fxNow) {
      setFx({ kind: fxNow, leaving: false });
      return;
    }
    setFx((cur) => (cur && !cur.leaving ? { ...cur, leaving: true } : cur));
    const t = setTimeout(() => setFx(null), FX_FADE_MS);
    return () => clearTimeout(t);
  }, [fxNow]);
  const sheetStyle = {
    width,
    height,
    backgroundImage: `url(${src})`,
    backgroundSize: `${width * SHEET.columns}px ${height * SHEET.rows}px`,
    backgroundPosition: `${-shot.col * width}px ${-shot.row * height}px`,
    visibility: isClip ? "hidden" : undefined,
    "--cell-w": `${width}px`,
    "--cell-h": `${height}px`,
    "--frames": shot.frames,
    "--loop": `${shot.seconds}s`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className={cn(loaded && styles.enter, className)}
      style={{ width, height, position: "relative" }}
      aria-hidden="true"
      data-amr-shot={shot.key}
    >
      {fx && <MascotFx kind={fx.kind} leaving={fx.leaving} width={width} height={height} />}
      <div
        ref={leanRef}
        className={styles.lean}
        data-amr-lean
        style={{ transformOrigin: `50% ${((FIGURE_BOTTOM / SHEET.cellH) * 100).toFixed(1)}%` }}
      >
        <div
          ref={swingRef}
          className={styles.swing}
          style={{
            transformOrigin: `50% ${((FIGURE_TOP / SHEET.cellH) * 100).toFixed(1)}%`,
            ...(auraColor ? { filter: `drop-shadow(0 0 10px ${auraColor})` } : {}),
          }}
        >
          <div ref={bodyRef} className={styles.body}>
            <div className={cn(styles.sheet, animClass(shot, take))} style={sheetStyle} />
            <div
              ref={clipRef}
              className={styles.clip}
              data-amr-clip
              style={{ width, visibility: isClip ? undefined : "hidden" }}
            />
          </div>
        </div>
      </div>
      {dozing && (
        <span className={styles.zzz} style={{ top: (FIGURE_TOP / SHEET.cellH) * height }}>
          <span>z</span>
          <span>z</span>
          <span>Z</span>
        </span>
      )}
    </div>
  );
}
