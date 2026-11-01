/**
 * Micro-expressions + personality quirks — ported from the vanilla mascot
 * (Personal Website mascot-assistant.js 3047-3186). A brief pose (a raised look,
 * a thumbs-up, …) and a rare idle "quirk" (≤ once / 30s, 2%/frame when idle) that
 * fires a micro-expression / wiggle / deep-breath. Keeps Amr subtly alive between
 * reactions.
 *
 * `activeMicroExpression(t)` returns the pose to show while one is playing; the
 * caller renders it (engine/sprite-poses.ts picks the shot).
 */

import type { SpritePose } from "./sprite-poses";

export type MicroName = "eyebrowFlash" | "smirk" | "squintThink" | "wideEyes" | "pout";

interface MicroDef {
  pose: SpritePose;
  duration: number;
}

const MICRO_EXPRESSIONS: Record<MicroName, MicroDef> = {
  eyebrowFlash: { pose: "waiting", duration: 0.6 },
  smirk: { pose: "review", duration: 1.2 },
  squintThink: { pose: "running", duration: 1.5 },
  wideEyes: { pose: "jumping", duration: 0.8 },
  pout: { pose: "failed", duration: 1.0 },
};

const QUIRK_COOLDOWN = 30; // seconds (source emotionState.quirkCooldown)

export interface QuirkCtx {
  isOpen: boolean;
  isTalking: boolean;
  activeReaction: boolean;
}

export interface ReactionFxHooks {
  queueReaction(r: "wiggle"): void;
  setBreathTarget(v: number): void;
}

export interface ActiveMicro {
  pose: SpritePose;
}

export interface ReactionFx {
  triggerMicroExpression(name: MicroName, t: number): void;
  activeMicroExpression(t: number): ActiveMicro | null;
  updateQuirks(t: number, ctx: QuirkCtx): void;
}

interface Quirk {
  id: string;
  weight: number;
  action(): void;
}

export function createReactionFx(hooks: ReactionFxHooks): ReactionFx {
  let active: { name: MicroName; start: number; def: MicroDef } | null = null;
  let lastQuirkTime = 0;

  function triggerMicroExpression(name: MicroName, t: number): void {
    if (active) return; // one at a time
    const def = MICRO_EXPRESSIONS[name];
    if (!def) return;
    active = { name, start: t, def };
  }

  const QUIRKS: Quirk[] = [
    { id: "curioLook", weight: 3, action: () => triggerMicroExpression("eyebrowFlash", lastTick) },
    { id: "slySmile", weight: 2, action: () => triggerMicroExpression("smirk", lastTick) },
    {
      id: "ponderSquint",
      weight: 2,
      action: () => triggerMicroExpression("squintThink", lastTick),
    },
    { id: "quickWiggle", weight: 1, action: () => hooks.queueReaction("wiggle") },
    {
      id: "deepBreath",
      weight: 2,
      action: () => {
        hooks.setBreathTarget(0.03);
        setTimeout(() => hooks.setBreathTarget(0), 2000);
      },
    },
  ];
  const totalWeight = QUIRKS.reduce((s, q) => s + q.weight, 0);
  let lastTick = 0;

  function activeMicroExpression(t: number): ActiveMicro | null {
    if (!active) return null;
    if (t - active.start >= active.def.duration) {
      active = null;
      return null;
    }
    return { pose: active.def.pose };
  }

  function updateQuirks(t: number, ctx: QuirkCtx): void {
    lastTick = t;
    if (t - lastQuirkTime < QUIRK_COOLDOWN) return;
    if (ctx.isOpen || ctx.isTalking || ctx.activeReaction) return;
    if (Math.random() > 0.02) return;

    let r = Math.random() * totalWeight;
    for (const q of QUIRKS) {
      r -= q.weight;
      if (r <= 0) {
        q.action();
        lastQuirkTime = t;
        break;
      }
    }
  }

  return { triggerMicroExpression, activeMicroExpression, updateQuirks };
}
