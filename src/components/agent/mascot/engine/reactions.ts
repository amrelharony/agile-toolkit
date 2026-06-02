/**
 * Micro-expressions + personality quirks — ported from the vanilla mascot
 * (Personal Website mascot-assistant.js 3047-3186). Brief facial-morph flickers
 * (smirk, wide-eyes, …) and a rare idle "quirk" (≤ once / 30s, 2%/frame when
 * idle) that fires a micro-expression / wiggle / deep-breath. Keeps the mascot
 * subtly alive between reactions.
 *
 * `activeMicroExpression(t)` returns the morph overrides + ramp intensity for
 * the RAF to blend on top of the current mood morphs (the caller owns the
 * THREE mesh). Spin/wiggle and emission-pulse reaction side-effects are handled
 * in the component's reaction loop.
 */

export type MicroName = "eyebrowFlash" | "smirk" | "squintThink" | "wideEyes" | "pout";

interface MicroDef {
  targets: Record<string, number>;
  duration: number;
  ramp: number;
}

const MICRO_EXPRESSIONS: Record<MicroName, MicroDef> = {
  eyebrowFlash: { targets: { eyebrow_raise: 0.7 }, duration: 0.6, ramp: 0.15 },
  smirk: { targets: { smile: 0.5, squint: 0.2 }, duration: 1.2, ramp: 0.3 },
  squintThink: { targets: { squint: 0.4, eyebrow_furrow: 0.3 }, duration: 1.5, ramp: 0.3 },
  wideEyes: { targets: { eyebrow_raise: 0.9, surprise: 0.6 }, duration: 0.8, ramp: 0.15 },
  pout: { targets: { sad: 0.4, eyebrow_furrow: 0.2 }, duration: 1.0, ramp: 0.25 },
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
  targets: Record<string, number>;
  intensity: number;
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

/**
 * Compute the ramp intensity (0→1→0) for a micro-expression at `elapsed`
 * seconds into a `duration`-long expression with `ramp`-second in/out tails.
 * Exported for unit testing.
 */
export function microRampIntensity(elapsed: number, duration: number, ramp: number): number {
  let intensity: number;
  if (elapsed < ramp) intensity = elapsed / ramp;
  else if (elapsed > duration - ramp) intensity = (duration - elapsed) / ramp;
  else intensity = 1;
  return Math.max(0, Math.min(1, intensity));
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
    const elapsed = t - active.start;
    if (elapsed >= active.def.duration) {
      active = null;
      return null;
    }
    return {
      targets: active.def.targets,
      intensity: microRampIntensity(elapsed, active.def.duration, active.def.ramp),
    };
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
