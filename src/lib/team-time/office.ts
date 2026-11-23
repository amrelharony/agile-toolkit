/**
 * Office days for a hybrid team: people grouped by their office (their
 * zone when they name none), who is in on each weekday, the anchor day the
 * most people share, and the pairs who are never in on the same day. Pure
 * and server-safe; Working Agreement's core-hours template reads the anchor
 * days from here.
 */

import type { TeamTimePerson } from "@/lib/stores/workspace-types";
import { zoneLabel } from "./zones";

type Person = Pick<TeamTimePerson, "id" | "timeZone" | "workingDays" | "officeDays" | "site">;

/** The most never-meet pairs a group lists. */
export const NEVER_MEET_MAX = 10;

/** One office (or zone) with two people or more, at least one of them in on some day. */
export interface OfficeGroup {
  /** `site:<name>` or `zone:<zone>`. */
  key: string;
  /** The office's name, or the zone's city. */
  label: string;
  /** The office's name as typed; null for a zone group. */
  site: string | null;
  /** Person ids, in the order given. */
  people: string[];
  /** Who is in on each weekday (0 Sunday to 6 Saturday), by id. */
  inOn: string[][];
  /** The day(s) the most people are in, the week's first working day first. Empty when nobody is. */
  anchorDays: number[];
  /** People in on some day who never share one, at most NEVER_MEET_MAX pairs. */
  neverMeet: [string, string][];
  /** People in the group who are never in. */
  remote: string[];
}

const siteKey = (site: string) => site.trim().toLowerCase();

/**
 * The day a group's week starts: a working day whose day before isn't one,
 * the one beginning the longest run (Monday for Mon–Fri, Sunday for
 * Sun–Thu); Monday when every day or none is a working day.
 */
export function weekStart(workingDays: readonly number[]): number {
  const set = new Set(workingDays);
  if (set.size === 0 || set.size === 7) return 1;
  let best = 1;
  let bestLength = -1;
  for (let d = 0; d < 7; d++) {
    if (!set.has(d) || set.has((d + 6) % 7)) continue;
    let length = 1;
    while (length < 7 && set.has((d + length) % 7)) length++;
    if (length > bestLength) {
      best = d;
      bestLength = length;
    }
  }
  return best;
}

/** Each office (or zone) of two people or more, with somebody in on some day, by label. */
export function officeGroups(people: readonly Person[]): OfficeGroup[] {
  const groups = new Map<string, { label: string; site: string | null; members: Person[] }>();
  for (const p of people) {
    const site = p.site?.trim();
    const key = site ? `site:${siteKey(site)}` : `zone:${p.timeZone}`;
    const g = groups.get(key) ?? {
      label: site || zoneLabel(p.timeZone),
      site: site || null,
      members: [],
    };
    g.members.push(p);
    groups.set(key, g);
  }
  const out: OfficeGroup[] = [];
  for (const [key, g] of Array.from(groups.entries())) {
    if (g.members.length < 2) continue;
    const office = (p: Person) => (p.officeDays ?? []).filter((d) => p.workingDays.includes(d));
    if (!g.members.some((p) => office(p).length > 0)) continue;
    const inOn = Array.from({ length: 7 }, (_, d) =>
      g.members.filter((p) => office(p).includes(d)).map((p) => p.id)
    );
    const start = weekStart(g.members.flatMap((p) => p.workingDays));
    const most = Math.max(...inOn.map((ids) => ids.length));
    const anchorDays =
      most > 0
        ? Array.from({ length: 7 }, (_, i) => (start + i) % 7).filter(
            (d) => inOn[d].length === most
          )
        : [];
    const inPeople = g.members.filter((p) => office(p).length > 0);
    const neverMeet: [string, string][] = [];
    for (let i = 0; i < inPeople.length && neverMeet.length < NEVER_MEET_MAX; i++) {
      for (let j = i + 1; j < inPeople.length && neverMeet.length < NEVER_MEET_MAX; j++) {
        const a = office(inPeople[i]);
        const b = new Set(office(inPeople[j]));
        if (!a.some((d) => b.has(d))) neverMeet.push([inPeople[i].id, inPeople[j].id]);
      }
    }
    out.push({
      key,
      label: g.label,
      site: g.site,
      people: g.members.map((p) => p.id),
      inOn,
      anchorDays,
      neverMeet,
      remote: g.members.filter((p) => office(p).length === 0).map((p) => p.id),
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The anchor days per office, for the core-hours template and the AI: `{site, days}` with an anchor. */
export function anchorDaysBySite(people: readonly Person[]): { site: string; days: number[] }[] {
  return officeGroups(people)
    .filter((g) => g.anchorDays.length > 0)
    .map((g) => ({ site: g.label, days: g.anchorDays }));
}
