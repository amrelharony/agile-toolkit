/**
 * Standup entries, live and async, shared by the Standup page (both of its
 * modes: /standup and /async-standup) and the tool.standup.* and
 * tool.async_standup.* agent actions.
 *
 * Both modes write `StandupEntry` rows, with `mode` set ("live" when
 * absent). The async tool's older rows are `AsyncUpdate`s: they are read
 * alongside, as async entries, until one is edited, which writes a
 * `StandupEntry` under the same id (that one wins from then on). Nothing
 * has to be moved.
 */

import type {
  AsyncUpdate,
  StandupEntry,
  StandupFormat,
  StandupMode,
} from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { sunOrder, type StandupPlace } from "@/lib/team-time/sun";

/** A blocker's DRI, as the page and the agent take it. */
export const BLOCKER_DRI_MAX = 120;
/** A hand-over, as the page and the agent take it (the entry fields' cap). */
export const HANDOFF_MAX = 4000;

export function standupMode(e: Pick<StandupEntry, "mode">): StandupMode {
  return e.mode === "async" ? "async" : "live";
}

/** Noon UTC on `date`, so the day reads the same in every time zone. */
function dayTimestamp(date: string): number {
  const t = Date.parse(`${date}T12:00:00Z`);
  return Number.isFinite(t) ? t : 0;
}

/** An old async update as an async standup entry, under its own id. */
export function fromAsyncUpdate(u: AsyncUpdate): StandupEntry {
  const description = (u.description ?? "").trim();
  return {
    id: u.id,
    member: u.member,
    date: u.date,
    yesterday: u.yesterday ?? "",
    today: u.today ?? "",
    blockers: u.blockers ?? "",
    timestamp: dayTimestamp(u.date),
    mode: "async",
    ...(description ? { description } : {}),
  };
}

/**
 * Every standup entry: the stored ones, then the old async updates that no
 * entry has replaced (an entry with the same id wins).
 */
export function allStandupEntries(
  entries: readonly StandupEntry[] | undefined,
  asyncUpdates: readonly AsyncUpdate[] | undefined
): StandupEntry[] {
  const list = [...(entries ?? [])];
  const ids = new Set(list.map((e) => e.id));
  for (const u of asyncUpdates ?? []) if (!ids.has(u.id)) list.push(fromAsyncUpdate(u));
  return list;
}

/** Whether `id` is an old async update that no entry has replaced yet. */
export function isLegacyAsyncUpdate(
  id: string,
  entries: readonly StandupEntry[] | undefined,
  asyncUpdates: readonly AsyncUpdate[] | undefined
): boolean {
  return !(entries ?? []).some((e) => e.id === id) && (asyncUpdates ?? []).some((u) => u.id === id);
}

const memberKey = (name: string) => name.trim().toLowerCase();

/** `member`'s entry for `date`, either mode (one per person per day). */
export function entryFor(
  entries: readonly StandupEntry[],
  member: string,
  date: string
): StandupEntry | undefined {
  const key = memberKey(member);
  return entries.find((e) => e.date === date && memberKey(e.member) === key);
}

/**
 * `member`'s latest entry before `date`, for prefilling "yesterday" from
 * what they said they'd do then.
 */
export function previousEntry(
  entries: readonly StandupEntry[],
  member: string,
  date: string
): StandupEntry | undefined {
  const key = memberKey(member);
  let best: StandupEntry | undefined;
  for (const e of entries) {
    if (memberKey(e.member) !== key || e.date >= date) continue;
    if (!best || e.date > best.date || (e.date === best.date && e.timestamp > best.timestamp))
      best = e;
  }
  return best;
}

/** Roster names with no entry for `date`, in roster order. */
export function notPostedYet(
  entries: readonly StandupEntry[],
  roster: readonly string[],
  date: string
): string[] {
  const posted = new Set(entries.filter((e) => e.date === date).map((e) => memberKey(e.member)));
  return roster.filter((name) => name.trim() && !posted.has(memberKey(name)));
}

export interface StandupPost {
  member: string;
  date: string;
  yesterday: string;
  today: string;
  blockers?: string;
  description?: string;
  /** "ppp" for Progress/Plans/Problems; anything else is classic. */
  format?: StandupFormat;
  /** Who can clear the blocker (kept only with one). */
  dri?: string;
  /** A hand-over to the next time zone. */
  handoff?: string;
}

/**
 * The new fields an entry takes from a post or an edit, each only when it
 * is set: the format only when it is Progress/Plans/Problems, the DRI only
 * with a blocker, the hand-over when there is one. A classic post gives
 * none of them, so its entry is exactly what it was before formats.
 */
export function formatFields(
  values: { format?: StandupFormat; dri?: string; handoff?: string },
  blockers: string
): Pick<StandupEntry, "format" | "blockerDri" | "handoff"> {
  const dri = (values.dri ?? "").trim();
  const handoff = (values.handoff ?? "").trim();
  return {
    ...(values.format === "ppp" ? { format: "ppp" as const } : {}),
    ...(dri && blockers.trim() ? { blockerDri: dri } : {}),
    ...(handoff ? { handoff } : {}),
  };
}

/**
 * The entry a post writes, one per person per day: the day's entry for
 * that person (either mode, an old async update included) is replaced
 * under its id, keeping when it was first posted, and keeping its
 * blocker's resolution and hand-offs while the blocker text is unchanged.
 */
export function postedEntry(
  existing: StandupEntry | undefined,
  post: StandupPost,
  mode: StandupMode,
  id: string,
  now: number
): StandupEntry {
  const blockers = (post.blockers ?? "").trim();
  const sameBlocker = Boolean(existing) && existing!.blockers.trim() === blockers;
  const description = (post.description ?? "").trim();
  return {
    id: existing?.id ?? id,
    member: post.member.trim(),
    date: post.date,
    yesterday: post.yesterday.trim(),
    today: post.today.trim(),
    blockers,
    timestamp: existing?.timestamp ?? now,
    mode,
    ...(description ? { description } : {}),
    ...(sameBlocker && existing!.blockerResolved ? { blockerResolved: true } : {}),
    ...(sameBlocker && existing!.sentTo ? { sentTo: existing!.sentTo } : {}),
    ...formatFields(post, blockers),
  };
}

export const hasBlocker = (e: Pick<StandupEntry, "blockers">) =>
  (e.blockers ?? "").trim().length > 0;

/** The words each format gives an update's three parts. */
export const FORMAT_LABELS: Record<
  StandupFormat,
  { done: string; next: string; problem: string; problems: string }
> = {
  classic: { done: "Yesterday", next: "Today", problem: "Blockers", problems: "Blockers" },
  ppp: { done: "Progress", next: "Plans", problem: "Problems", problems: "Problems" },
};

/** An entry's format: Progress/Plans/Problems when it says so, else classic. */
export const formatOf = (e: Pick<StandupEntry, "format">): StandupFormat =>
  e.format === "ppp" ? "ppp" : "classic";

/** Places keyed by `nameKey(member)`: where each Standup poster works (Team Time's `standupPlaces`). */
export type StandupPlaces = ReadonlyMap<string, StandupPlace>;

/** The distinct places of `places`, east to west on `date`: the follow-the-sun shift chain. */
export function shiftChain(places: StandupPlaces | undefined, date: string): StandupPlace[] {
  if (!places) return [];
  const seen = new Set<string>();
  const list: StandupPlace[] = [];
  for (const p of Array.from(places.values())) {
    const key = `${p.label}|${p.zone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(p);
  }
  return sunOrder(list, date);
}

/** The place after `place` in the chain, round to the first; null with fewer than two places. */
export function nextPlace(
  chain: readonly StandupPlace[],
  place: StandupPlace | undefined
): StandupPlace | null {
  if (!place || chain.length < 2) return null;
  const at = chain.findIndex((p) => p.label === place.label && p.zone === place.zone);
  return at < 0 ? null : chain[(at + 1) % chain.length];
}

/** Flatten newlines so a typed paragraph stays on one Markdown bullet. */
function singleLine(s: string | undefined): string {
  return (s ?? "").replace(/\r?\n/g, " ").trim();
}

/** " (DRI: Bo)" after a blocker that names who can clear it. */
const driSuffix = (e: Pick<StandupEntry, "blockerDri">) =>
  singleLine(e.blockerDri) ? ` (DRI: ${singleLine(e.blockerDri)})` : "";

/**
 * One day's updates as Markdown, grouped by person, blockers first: the
 * async digest, ready to paste into chat or email. The page and the agent
 * action produce the same text, from the same `places` (Team Time's
 * `standupPlaces`).
 *
 *   - Progress/Plans/Problems updates print under those words; the
 *     blockers' heading is "Problems" only when every update is one.
 *   - A blocker with a DRI ends " (DRI: Bo)".
 *   - "## Hand-overs" follows the blockers when anyone left one, from their
 *     place to the next one east to west.
 *   - With two places or more known, people go in the order the day
 *     reaches them; anyone with no place keeps their order, after them.
 *
 * Without those fields or places, the text is what it always was.
 */
export function standupDigest(
  entries: readonly StandupEntry[],
  date: string,
  opts: { places?: StandupPlaces } = {}
): string {
  const day = entries.filter((e) => e.date === date);
  if (day.length === 0) return `# Standup — ${date}\n\nNo updates posted.`;
  const places = opts.places;
  const chain = shiftChain(places, date);
  const placeOf = (member: string) => places?.get(nameKey(member));
  const lines: string[] = [`# Standup — ${date}`, ""];
  const blocked = day.filter(hasBlocker);
  if (blocked.length > 0) {
    lines.push(day.every((e) => formatOf(e) === "ppp") ? "## Problems" : "## Blockers");
    for (const e of blocked) {
      lines.push(`- **${e.member}**: ${singleLine(e.blockers)}${driSuffix(e)}`);
    }
    lines.push("");
  }
  const handed = day.filter((e) => singleLine(e.handoff));
  if (handed.length > 0) {
    lines.push("## Hand-overs");
    for (const e of handed) {
      const from = placeOf(e.member);
      const to = nextPlace(chain, from);
      const route = from && to ? `, ${from.label} → ${to.label}` : "";
      lines.push(`- **${e.member}**${route}: ${singleLine(e.handoff)}`);
    }
    lines.push("");
  }
  const byMember = new Map<string, StandupEntry[]>();
  for (const e of day) byMember.set(e.member, [...(byMember.get(e.member) ?? []), e]);
  let people = Array.from(byMember.entries());
  if (chain.length >= 2) {
    const rank = (member: string) => {
      const p = placeOf(member);
      const at = p ? chain.findIndex((c) => c.label === p.label && c.zone === p.zone) : -1;
      return at < 0 ? chain.length : at;
    };
    people = people
      .map((p, i) => ({ p, i, r: rank(p[0]) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.p);
  }
  for (const [member, list] of people) {
    lines.push(`## ${member}`);
    for (const e of list) {
      const words = FORMAT_LABELS[formatOf(e)];
      if (singleLine(e.yesterday)) lines.push(`- **${words.done}**: ${singleLine(e.yesterday)}`);
      if (singleLine(e.today)) lines.push(`- **${words.next}**: ${singleLine(e.today)}`);
      if (singleLine(e.blockers)) {
        lines.push(`- **${words.problem}**: ${singleLine(e.blockers)}${driSuffix(e)}`);
      }
      if (singleLine(e.description)) lines.push(`- ${singleLine(e.description)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
