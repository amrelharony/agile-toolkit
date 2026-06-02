/**
 * Procedural animation — springs, idle fidgets, and squash-stretch, ported 1:1
 * from the vanilla mascot (Personal Website mascot-assistant.js 3208-3356).
 *
 * The springs rest at 0 (the skeletal Idle clip provides the base motion); every
 * 8-20s an idle fidget nudges a spring (weight shift, head cock, deep breath,
 * small bob, double blink) — but only when idle (no reaction, not talking, panel
 * closed). `update()` returns the per-frame offsets; the caller applies them to
 * the model's position + scale (keeping this module free of THREE/React).
 *
 * Pure `springStep` is unit-tested.
 */

export interface Spring {
  value: number;
  velocity: number;
  target: number;
  stiffness: number;
  damping: number;
}

/** Semi-implicit spring integration (source springStep 3271-3276). */
export function springStep(s: Spring, dt: number): number {
  const force = (s.target - s.value) * s.stiffness - s.velocity * s.damping;
  s.velocity += force * dt;
  s.value += s.velocity * dt;
  return s.value;
}

export type SquashType = "land" | "jump" | "bounce" | "react";

/** Hooks the fidgets call back into (blink + sparkle bursts). */
export interface ProceduralHooks {
  requestBlink(): void;
  emitSparkles(n: number): void;
}

export interface ProceduralCtx {
  dt: number;
  /** A skeletal reaction is currently playing. */
  activeReaction: boolean;
  isTalking: boolean;
  /** Chat panel open. */
  isOpen: boolean;
  reducedMotion: boolean;
  hooks: ProceduralHooks;
}

export interface ProceduralOutput {
  /** Add to model.position.x. */
  bodyLean: number;
  /** Part of model.position.y (with breathScale). */
  bobY: number;
  breathScale: number;
  /** Squash-stretch multipliers on baseScale. */
  scaleY: number;
  scaleXZ: number;
}

interface Fidget {
  name: string;
  duration: number;
  _puffed?: boolean;
  /** weightShift's chosen lean direction, picked once per activation. */
  _dir?: number;
  apply(pa: ProceduralState, t01: number, hooks: ProceduralHooks): void;
  reset(pa: ProceduralState): void;
}

interface ProceduralState {
  springs: {
    headTilt: Spring;
    bodyLean: Spring;
    breathScale: Spring;
    bobY: Spring;
  };
}

export interface ProceduralAnim {
  update(ctx: ProceduralCtx): ProceduralOutput;
  triggerSquashStretch(type: SquashType): void;
  triggerAnticipation(cb?: () => void): void;
  triggerRandomFidget(): void;
  /** Set the breath spring target directly (used by the deepBreath quirk). */
  setBreathTarget(v: number): void;
}

function mkSpring(stiffness: number, damping: number): Spring {
  return { value: 0, velocity: 0, target: 0, stiffness, damping };
}

export function createProceduralAnim(): ProceduralAnim {
  const state: ProceduralState = {
    springs: {
      headTilt: mkSpring(120, 14),
      bodyLean: mkSpring(80, 12),
      breathScale: mkSpring(40, 8),
      bobY: mkSpring(100, 13),
    },
  };

  const fidget = {
    timer: 0,
    interval: 8 + Math.random() * 12,
    active: null as Fidget | null,
    elapsed: 0,
  };

  const squash = {
    scaleY: 1.0,
    scaleXZ: 1.0,
    targetY: 1.0,
    targetXZ: 1.0,
    velY: 0,
    velXZ: 0,
    stiffness: 200,
    damping: 14,
  };

  const FIDGET_TYPES: Fidget[] = [
    {
      name: "weightShift",
      duration: 2.0,
      _dir: undefined,
      apply(pa, t01) {
        // Pick the lean direction once when the fidget begins; the source
        // re-rolled the sign every frame, so the lean jittered instead of
        // settling to one side.
        if (this._dir === undefined) this._dir = Math.random() > 0.5 ? 1 : -1;
        const curve = Math.sin(t01 * Math.PI);
        pa.springs.bodyLean.target = curve * 0.006 * this._dir;
      },
      reset(pa) {
        pa.springs.bodyLean.target = 0;
        this._dir = undefined;
      },
    },
    {
      name: "headCock",
      duration: 1.5,
      apply(pa, t01) {
        pa.springs.headTilt.target = Math.sin(t01 * Math.PI) * 0.03;
      },
      reset(pa) {
        pa.springs.headTilt.target = 0;
      },
    },
    {
      name: "breathDeep",
      duration: 3.0,
      _puffed: false,
      apply(pa, t01, hooks) {
        pa.springs.breathScale.target = Math.sin(t01 * Math.PI) * 0.025;
        if (t01 > 0.45 && t01 < 0.55 && !this._puffed) {
          this._puffed = true;
          hooks.emitSparkles(2);
        }
      },
      reset(pa) {
        pa.springs.breathScale.target = 0;
        this._puffed = false;
      },
    },
    {
      name: "smallBob",
      duration: 1.2,
      apply(pa, t01) {
        pa.springs.bobY.target = Math.sin(t01 * Math.PI * 2) * (1 - t01) * 0.012;
      },
      reset(pa) {
        pa.springs.bobY.target = 0;
      },
    },
    {
      name: "doubleBlink",
      duration: 0.8,
      apply(_pa, _t01, hooks) {
        hooks.requestBlink();
      },
      reset() {},
    },
  ];

  function update(ctx: ProceduralCtx): ProceduralOutput {
    const { dt, hooks } = ctx;
    const sp = state.springs;

    if (ctx.reducedMotion) {
      return { bodyLean: 0, bobY: 0, breathScale: 0, scaleY: 1, scaleXZ: 1 };
    }

    springStep(sp.headTilt, dt);
    springStep(sp.bodyLean, dt);
    springStep(sp.breathScale, dt);
    springStep(sp.bobY, dt);

    // Fidget state machine — only fire when truly idle.
    if (!fidget.active) {
      fidget.timer += dt;
      if (fidget.timer >= fidget.interval && !ctx.activeReaction && !ctx.isTalking && !ctx.isOpen) {
        fidget.active = FIDGET_TYPES[Math.floor(Math.random() * FIDGET_TYPES.length)];
        fidget.elapsed = 0;
        fidget.timer = 0;
        fidget.interval = 8 + Math.random() * 12;
      }
    } else {
      fidget.elapsed += dt;
      const t01 = Math.min(1, fidget.elapsed / fidget.active.duration);
      if (t01 >= 1) {
        fidget.active.reset(state);
        fidget.active = null;
      } else {
        fidget.active.apply(state, t01, hooks);
      }
    }

    // Squash/stretch spring.
    const fy = (squash.targetY - squash.scaleY) * squash.stiffness - squash.velY * squash.damping;
    squash.velY += fy * dt;
    squash.scaleY += squash.velY * dt;
    const fxz =
      (squash.targetXZ - squash.scaleXZ) * squash.stiffness - squash.velXZ * squash.damping;
    squash.velXZ += fxz * dt;
    squash.scaleXZ += squash.velXZ * dt;

    return {
      bodyLean: sp.bodyLean.value,
      bobY: sp.bobY.value,
      breathScale: sp.breathScale.value,
      scaleY: squash.scaleY,
      scaleXZ: squash.scaleXZ,
    };
  }

  function triggerSquashStretch(type: SquashType): void {
    switch (type) {
      case "land":
        squash.targetY = 0.88;
        squash.targetXZ = 1.07;
        break;
      case "jump":
        squash.targetY = 1.1;
        squash.targetXZ = 0.93;
        break;
      case "bounce":
        squash.targetY = 0.94;
        squash.targetXZ = 1.03;
        break;
      case "react":
        squash.targetY = 1.04;
        squash.targetXZ = 0.98;
        break;
    }
    setTimeout(() => {
      squash.targetY = 1.0;
      squash.targetXZ = 1.0;
    }, 150);
  }

  function triggerAnticipation(cb?: () => void): void {
    state.springs.bobY.target = -0.01;
    setTimeout(() => {
      cb?.();
      state.springs.bobY.target = 0.02;
      setTimeout(() => {
        state.springs.bobY.target = 0;
      }, 300);
    }, 150);
  }

  function triggerRandomFidget(): void {
    if (fidget.active) return;
    fidget.active = FIDGET_TYPES[Math.floor(Math.random() * FIDGET_TYPES.length)];
    fidget.elapsed = 0;
  }

  function setBreathTarget(v: number): void {
    state.springs.breathScale.target = v;
  }

  return {
    update,
    triggerSquashStretch,
    triggerAnticipation,
    triggerRandomFidget,
    setBreathTarget,
  };
}
