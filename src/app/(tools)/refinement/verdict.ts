import type { RefinementSession } from "./session";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The one-sentence answer at the top: how many of the stories not started
 * yet are ready, and how many still need points before they can be planned.
 *
 * The points count names the backlog's unsized stories apart from those
 * already planned into a sprint, so the page reads the same number as the
 * cockpit's "N backlog stories to size" card that links here. While no
 * story is planned yet, every one is a backlog story and the short form is
 * enough.
 *
 *   "7 of 12 backlog stories are ready. 3 still need points."
 *   "7 of 12 stories are ready. 3 backlog stories and 2 planned ones still need points."
 */
export function refinementVerdict(
  session: Pick<RefinementSession, "ready" | "total" | "backlog" | "unsized" | "backlogUnsized">
): string {
  const { total, unsized, backlogUnsized } = session;
  const ready = session.ready.length;
  if (total === 0) return "No backlog stories to refine yet.";

  const planned = total - session.backlog;
  const one = planned === 0 ? "backlog story" : "planned story";
  const many = planned === 0 ? "backlog stories" : "stories";
  let lead: string;
  if (ready === total) {
    lead = total === 1 ? `The ${one} is ready.` : `All ${total} ${many} are ready.`;
  } else if (ready === 0) {
    lead =
      total === 1 ? `The ${one} isn't ready yet.` : `None of the ${total} ${many} are ready yet.`;
  } else {
    lead = `${ready} of ${total} ${many} ${ready === 1 ? "is" : "are"} ready.`;
  }
  if (unsized === 0) return lead;
  if (total === 1) return `${lead} It still needs points.`;
  const needs = (n: number) => (n === 1 ? "needs" : "need");
  if (planned === 0) return `${lead} ${unsized} still ${needs(unsized)} points.`;

  const plannedUnsized = unsized - backlogUnsized;
  if (plannedUnsized === 0) {
    return `${lead} ${count(backlogUnsized, "backlog story", "backlog stories")} still ${needs(backlogUnsized)} points.`;
  }
  if (backlogUnsized === 0) {
    return `${lead} ${count(plannedUnsized, "planned story", "planned stories")} still ${needs(plannedUnsized)} points.`;
  }
  return `${lead} ${count(backlogUnsized, "backlog story", "backlog stories")} and ${plannedUnsized} planned ${
    plannedUnsized === 1 ? "one" : "ones"
  } still need points.`;
}
