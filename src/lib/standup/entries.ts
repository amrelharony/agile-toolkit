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

import type { AsyncUpdate, StandupEntry, StandupMode } from "@/lib/stores/workspace-types";

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

export const hasBlocker = (e: Pick<StandupEntry, "blockers">) =>
  (e.blockers ?? "").trim().length > 0;

/** Flatten newlines so a typed paragraph stays on one Markdown bullet. */
function singleLine(s: string | undefined): string {
  return (s ?? "").replace(/\r?\n/g, " ").trim();
}

/**
 * One day's updates as Markdown, grouped by person, blockers first: the
 * async digest, ready to paste into chat or email. The page and the agent
 * action produce the same text.
 */
export function standupDigest(entries: readonly StandupEntry[], date: string): string {
  const day = entries.filter((e) => e.date === date);
  if (day.length === 0) return `# Standup — ${date}\n\nNo updates posted.`;
  const lines: string[] = [`# Standup — ${date}`, ""];
  const blocked = day.filter(hasBlocker);
  if (blocked.length > 0) {
    lines.push("## Blockers");
    for (const e of blocked) lines.push(`- **${e.member}**: ${singleLine(e.blockers)}`);
    lines.push("");
  }
  const byMember = new Map<string, StandupEntry[]>();
  for (const e of day) byMember.set(e.member, [...(byMember.get(e.member) ?? []), e]);
  for (const [member, list] of Array.from(byMember.entries())) {
    lines.push(`## ${member}`);
    for (const e of list) {
      if (singleLine(e.yesterday)) lines.push(`- **Yesterday**: ${singleLine(e.yesterday)}`);
      if (singleLine(e.today)) lines.push(`- **Today**: ${singleLine(e.today)}`);
      if (singleLine(e.blockers)) lines.push(`- **Blockers**: ${singleLine(e.blockers)}`);
      if (singleLine(e.description)) lines.push(`- ${singleLine(e.description)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
