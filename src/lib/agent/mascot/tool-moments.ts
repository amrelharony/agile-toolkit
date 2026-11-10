/**
 * Moments in a tool that the history log doesn't carry: a vote round revealed,
 * an OKR achieved, a hypothesis settled. Tools announce them here and Amr
 * listens (use-tool-reactions.ts), answering only the ones his tool table
 * names (context/tool-scenes.ts). A plain listener set, with no React and no
 * store, so announcing costs nothing when he isn't on the page.
 */

export type ToolMomentListener = (toolId: string, moment: string) => void;

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
