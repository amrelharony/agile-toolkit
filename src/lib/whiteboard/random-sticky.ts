/**
 * "Pick a random sticky": the stickies a random pick can land on, from the
 * selection. Two or more selected stickies are the pool; a selected frame
 * (or several) puts the stickies inside it in the pool. The board selects
 * the one picked, so it is highlighted and read out like any selection.
 * Right after a pick the button stays for another one from the same pool
 * (`pickPoolFor`), so focus stays on it rather than dropping to the page.
 *
 * Pure: the pick takes an optional seeded `rng` (lib/utils/random).
 */

import type {
  WhiteboardFrame,
  WhiteboardObject,
  WhiteboardSticky,
} from "@/lib/stores/workspace-types";
import { pick, type Rng } from "@/lib/utils/random";

const isSticky = (o: WhiteboardObject): o is WhiteboardSticky => o.type === "sticky";
const isFrame = (o: WhiteboardObject): o is WhiteboardFrame => o.type === "frame";

/** A sticky belongs to a frame when it says so, or when its centre is inside the frame. */
function inFrame(sticky: WhiteboardSticky, frame: WhiteboardFrame): boolean {
  if (sticky.frameId === frame.id) return true;
  const cx = sticky.x + sticky.w / 2;
  const cy = sticky.y + sticky.h / 2;
  return cx >= frame.x && cx <= frame.x + frame.w && cy >= frame.y && cy <= frame.y + frame.h;
}

/**
 * The stickies to pick from: the selected stickies when there are two or
 * more, else every sticky inside the selected frames. Fewer than two means
 * there is nothing to pick between, so the pool is empty.
 */
export function randomStickyPool(
  selected: readonly WhiteboardObject[],
  objects: readonly WhiteboardObject[]
): WhiteboardSticky[] {
  const stickies = selected.filter(isSticky);
  if (stickies.length >= 2) return stickies;
  const frames = selected.filter(isFrame);
  if (frames.length === 0) return [];
  const inside = objects.filter(
    (o): o is WhiteboardSticky => isSticky(o) && frames.some((f) => inFrame(o, f))
  );
  return inside.length >= 2 ? inside : [];
}

/**
 * One sticky's id from the pool, each equally likely; null for an empty
 * pool. `not` (the sticky picked last) is left out when there are others,
 * so picking again always moves on.
 */
export function pickRandomSticky(
  pool: readonly WhiteboardSticky[],
  rng?: Rng,
  not?: string | null
): string | null {
  const others = not ? pool.filter((s) => s.id !== not) : pool;
  return pick(others.length > 0 ? others : pool, { rng })?.id ?? null;
}

/** The last pick: the pool's ids, and the sticky it landed on. */
export interface StickyPick {
  pool: readonly string[];
  picked: string;
}

/**
 * The pool behind the bar's button: the selection's own, or, while the
 * sticky just picked is the whole selection, the pool it came from.
 */
export function pickPoolFor(
  selected: readonly WhiteboardObject[],
  objects: readonly WhiteboardObject[],
  last: StickyPick | null
): WhiteboardSticky[] {
  const fresh = randomStickyPool(selected, objects);
  if (fresh.length >= 2 || !last || selected.length !== 1 || selected[0].id !== last.picked) {
    return fresh;
  }
  const byId = new Map(objects.map((o) => [o.id, o]));
  const again = last.pool
    .map((id) => byId.get(id))
    .filter((o): o is WhiteboardSticky => !!o && isSticky(o));
  return again.length >= 2 ? again : [];
}
