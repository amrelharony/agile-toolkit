import type { RefinementSession } from "./session";

/**
 * The one-sentence answer at the top: how much of the backlog is ready,
 * and how many stories still need points before they can be planned.
 *
 *   "7 of 12 backlog stories are ready. 3 still need points."
 */
export function refinementVerdict(
  session: Pick<RefinementSession, "ready" | "total" | "unsized">
): string {
  const { total, unsized } = session;
  const ready = session.ready.length;
  if (total === 0) return "No backlog stories to refine yet.";

  let lead: string;
  if (ready === total) {
    lead = total === 1 ? "The backlog story is ready." : `All ${total} backlog stories are ready.`;
  } else if (ready === 0) {
    lead =
      total === 1
        ? "The backlog story isn't ready yet."
        : `None of the ${total} backlog stories are ready yet.`;
  } else {
    lead = `${ready} of ${total} backlog stories ${ready === 1 ? "is" : "are"} ready.`;
  }
  if (unsized === 0) return lead;
  if (total === 1) return `${lead} It still needs points.`;
  return `${lead} ${unsized} still ${unsized === 1 ? "needs" : "need"} points.`;
}
