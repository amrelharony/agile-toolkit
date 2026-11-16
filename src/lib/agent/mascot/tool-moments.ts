/**
 * Moments in a tool that the history log doesn't carry: a vote round revealed,
 * an OKR achieved, a hypothesis settled. Tools announce them here and Amr
 * listens (use-tool-reactions.ts), answering only the ones his tool table
 * names (context/tool-scenes.ts). A plain listener set, with no React and no
 * store, so announcing costs nothing when he isn't on the page.
 */

export type ToolMomentListener = (toolId: string, moment: string) => void;

/**
 * The moments a tool announces to ask Amr to celebrate (lib/celebrate/cheer.ts):
 * a cheer for a result, a dance for a milestone. Named apart from his own
 * reactions ("cheer", "dance"), which reach this channel as the mascot's own
 * sounds, so one can never set off the other.
 */
export const CHEER_MOMENTS = { cheer: "amr_cheer", dance: "amr_dance" } as const;

/** The pose a cheer moment asks for, or null for any other moment. */
export function cheerPose(moment: string): "cheer" | "dance" | null {
  if (moment === CHEER_MOMENTS.cheer) return "cheer";
  if (moment === CHEER_MOMENTS.dance) return "dance";
  return null;
}

const listeners = new Set<ToolMomentListener>();

/** Hear every announced moment. Returns the unsubscribe. */
export function onToolMoment(fn: ToolMomentListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Something happened in `toolId` that nothing logs. A listener's error never reaches the tool. */
export function announceToolMoment(toolId: string, moment: string): void {
  listeners.forEach((fn) => {
    try {
      fn(toolId, moment);
    } catch {
      /* the mascot's problem, not the tool's */
    }
  });
}
