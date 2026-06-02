/**
 * Mascot click interactions — flourish + multi-click escalations, ported from
 * the vanilla mascot (onMascotClick flourish 1673+ and handleMascotInteraction
 * 3564-3581). Every click does a small flourish (random reaction + squash +
 * sound + 1 XP); rapid sequences escalate at 3 / 5 / 7 clicks (reset after
 * 1.5s). The chat-toggle itself is handled by the caller (debounced).
 */

export interface ClickHooks {
  queueReaction(r: "spin" | "wiggle" | "excited" | "nod"): void;
  queueMicro(name: "smirk" | "wideEyes"): void;
  sound(): void;
  addXp(n: number): void;
}

const FLOURISHES = ["spin", "wiggle", "excited"] as const;

export interface ClickInteraction {
  onClick(): void;
  dispose(): void;
}

export function createClickInteraction(hooks: ClickHooks): ClickInteraction {
  let patCount = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onClick(): void {
    patCount++;
    clearTimeout(timer);
    timer = setTimeout(() => {
      patCount = 0;
    }, 1500);

    hooks.sound();

    if (patCount === 3) {
      hooks.queueMicro("smirk");
      hooks.queueReaction("nod");
    } else if (patCount === 5) {
      hooks.queueMicro("wideEyes");
      hooks.queueReaction("excited");
    } else if (patCount >= 7) {
      hooks.queueReaction("spin");
      hooks.addXp(5);
      patCount = 0;
    } else {
      // Ordinary click: a small random flourish + 1 XP.
      hooks.queueReaction(FLOURISHES[Math.floor(Math.random() * FLOURISHES.length)]);
      hooks.addXp(1);
    }
  }

  return { onClick, dispose: () => clearTimeout(timer) };
}
