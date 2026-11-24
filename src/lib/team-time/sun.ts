/**
 * Follow the sun: places in the order the working day reaches them (east
 * to west), and where each Standup poster is, for the Async Standup's
 * hand-overs. Pure and server-safe; the Standup page and Amr's digest call
 * the same `standupPlaces`, so both say the same thing.
 */

import type { StandupEntry, TeamMember, TeamTimePerson } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";
import { examplePeople } from "./example";
import { placeLabel } from "./format";
import { readPerson } from "./rows";
import { offsetMinutes } from "./zones";

/**
 * The places sorted east to west by their offset at noon UTC on `date`
 * ("YYYY-MM-DD"): the day starts in the east. Places with the same offset
 * keep their order.
 */
export function sunOrder<P extends { zone: string }>(places: readonly P[], date: string): P[] {
  const noon = Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
  const at = Number.isNaN(noon) ? Date.now() : noon;
  return places
    .map((p, i) => ({ p, i, offset: safeOffset(p.zone, at) }))
    .sort((a, b) => b.offset - a.offset || a.i - b.i)
    .map((x) => x.p);
}

function safeOffset(zone: string, at: number): number {
  try {
    return offsetMinutes(zone, at);
  } catch {
    return 0;
  }
}

/** Where a Standup poster is: a label ("London office", "Toronto") and their zone. */
export interface StandupPlace {
  label: string;
  zone: string;
}

/**
 * Each Team Time person's place by name key (`nameKey`), under both their
 * roster name and their stored name, for the Standup. Example rows are
 * left out. A member whose Standup entries are all example rows (the
 * Standup's own example) gets the Team Time example's place, so the example
 * shows hand-overs; a real row always wins.
 */
export function standupPlaces(
  people: readonly unknown[],
  roster: readonly Pick<TeamMember, "id" | "name">[],
  entries: readonly Pick<StandupEntry, "id" | "member">[]
): Map<string, StandupPlace> {
  const out = new Map<string, StandupPlace>();
  const put = (name: string | undefined, place: StandupPlace) => {
    const key = nameKey(name);
    if (key && !out.has(key)) out.set(key, place);
  };
  const real = people
    .map(readPerson)
    .filter((p): p is TeamTimePerson => p !== null && !isExampleId(p.id));
  for (const p of real) {
    const place = { label: placeLabel(p), zone: p.timeZone };
    const member = p.teamMemberId ? roster.find((m) => m.id === p.teamMemberId) : undefined;
    put(member?.name, place);
    put(p.name, place);
  }
  // Members seen only in example entries: the Team Time example's places fill the gaps.
  const exampleOnly = new Map<string, boolean>();
  for (const e of entries) {
    const key = nameKey(e.member);
    if (!key) continue;
    exampleOnly.set(key, (exampleOnly.get(key) ?? true) && isExampleId(e.id));
  }
  const examples = new Map(examplePeople().map((p) => [nameKey(p.name), p]));
  for (const [key, onlyExamples] of Array.from(exampleOnly.entries())) {
    if (!onlyExamples || out.has(key)) continue;
    const p = examples.get(key);
    if (p) out.set(key, { label: placeLabel(p), zone: p.timeZone });
  }
  return out;
}
