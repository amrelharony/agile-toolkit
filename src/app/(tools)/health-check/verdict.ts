import type { HealthCheck } from "@/lib/stores/workspace-types";
import { listAnd } from "@/lib/charts/chart-text";
import {
  activeDimensions,
  allDimensions,
  checkLabel,
  draftLight,
  draftShare,
  entryShare,
  latestSavedCheck,
  previousSavedCheck,
  sharePct,
  storedLight,
  trendFor,
  type CheckOptions,
} from "@/lib/health-check/score";

const are = (names: string[]) => `${listAnd(names)} ${names.length === 1 ? "is" : "are"}`;

/**
 * The health check in one sentence: the check in progress once something
 * is rated, else the latest saved one. Health (yellow counts half), what is
 * red, and what moved since the check before, slips first.
 *
 *   "Health 69% (yellow counts half): Health of Codebase is red; Fun
 *    slipped, Easy to Release improved since Sprint 14."
 */
export function healthVerdict(
  doc: HealthCheck,
  { today, ...opts }: CheckOptions & { today: string }
): string {
  const dims = activeDimensions(doc);
  const draftRated = dims.filter((d) => draftLight(doc.current, d.key) !== null);
  const latest = latestSavedCheck(doc, opts);

  if (draftRated.length === 0 && !latest) {
    return "No health check yet: rate each dimension below, or run an anonymous round.";
  }

  const fromDraft = draftRated.length > 0;
  const lightOf = (key: string) =>
    fromDraft ? draftLight(doc.current, key) : storedLight(latest ?? undefined, key);
  const keys = fromDraft ? draftRated : allDimensions(doc).filter((d) => lightOf(d.key) !== null);
  const pct = fromDraft ? sharePct(draftShare(doc)) : sharePct(entryShare(latest ?? undefined));
  const prev = fromDraft
    ? previousSavedCheck(doc, { date: doc.current.date ?? today }, opts)
    : latest
      ? previousSavedCheck(doc, { date: latest.date, id: latest.id }, opts)
      : null;

  const reds = keys.filter((d) => lightOf(d.key) === "red").map((d) => d.name);
  const moved = (dir: "up" | "down") =>
    prev
      ? keys
          .filter((d) => {
            const before = storedLight(prev, d.key);
            return before !== null && trendFor(before, lightOf(d.key)) === dir;
          })
          .map((d) => d.name)
      : [];
  const up = moved("up");
  const down = moved("down");

  const lead = fromDraft
    ? draftRated.length < dims.length
      ? `So far (${draftRated.length} of ${dims.length} rated), health ${pct}%`
      : `Health ${pct}%`
    : `The last saved check, ${checkLabel(latest!)}, read health ${pct}%`;
  const red = reds.length > 0 ? `${are(reds)} red` : "nothing is red";
  const since = prev ? ` since ${checkLabel(prev)}` : "";
  // Slips first: a gain elsewhere never hides one.
  const moves = [
    ...(down.length > 0 ? [`${listAnd(down)} slipped`] : []),
    ...(up.length > 0 ? [`${listAnd(up)} improved`] : []),
  ];
  const trend = moves.length > 0 ? `; ${moves.join(", ")}${since}` : "";
  return `${lead} (yellow counts half): ${red}${trend}.`;
}
