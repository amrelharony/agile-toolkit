/**
 * An epic made from another tool's item (an impact map's deliverable, a
 * strategy tree's initiative): what the "epic" hand-off route puts on the
 * Epic Roadmap. Pure and server-safe, so an agent's verb can build the same
 * epic. It goes in next quarter, at the add_epic verb's caps, in the first
 * colour no epic uses yet, with no horizon: the roadmap reads its place on
 * Now, Next, Later from its quarters until someone moves it. P2.4 owns it
 * after the base, keeping these exports.
 */

import type { Epic } from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { currentQuarterIndex, quarterLabel } from "./quarters";
import { nextColor } from "./palette";

/** The Epic Roadmap's one document id. */
export const EPIC_ROADMAP_ID = "epicRoadmap:current";

/** The add_epic verb's caps (lib/actions/tools/epic-roadmap.ts). */
export const EPIC_TITLE_MAX = 300;
export const EPIC_DESCRIPTION_MAX = 2000;
export const EPIC_OWNER_MAX = 200;

/** `text` trimmed and cut to `max`, or undefined when blank. */
const capped = (text: string | undefined, max: number) => {
  const t = (text ?? "").trim().slice(0, max);
  return t === "" ? undefined : t;
};

/** The epic a send adds, beside the roadmap's `epics`, in the quarter after `now`'s. */
export function buildEpicFromSource(
  src: HandoffSource,
  epics: readonly Pick<Epic, "color">[],
  id: string = crypto.randomUUID(),
  now: Date = new Date()
): Epic {
  const quarter = quarterLabel(currentQuarterIndex(now) + 1);
  const description = capped(src.description, EPIC_DESCRIPTION_MAX);
  const owner = capped(src.owner, EPIC_OWNER_MAX);
  return {
    id,
    title: src.title.trim().slice(0, EPIC_TITLE_MAX),
    ...(description ? { description } : {}),
    startQuarter: quarter,
    endQuarter: quarter,
    progress: 0,
    ...(owner ? { owner } : {}),
    color: nextColor(epics),
    sourceRef: src.sourceRef,
  };
}
