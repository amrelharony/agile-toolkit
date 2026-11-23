"use client";

import { Sun } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { shiftIndex, type StandupPlaces, type StandupShift } from "@/lib/standup/entries";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { localTimeText } from "@/lib/team-time/format";
import { addDays } from "@/lib/impediments/model";

export interface HandoverRow {
  /** The shift: the places on one clock. */
  place: StandupShift;
  /** Their clock now: "Tue 07:30". */
  localTime: string;
  /** The people Team Time puts there, as they post. */
  people: string[];
  /** Hand-overs left there today or yesterday, newest first. */
  notes: { member: string; date: string; text: string }[];
  next: StandupShift;
  /** Someone at the next place has posted today. */
  nextPosted: boolean;
}

/**
 * The follow-the-sun chain for the Hand-overs panel: each shift east to
 * west (the places on one clock), its clock now, the people there (from the
 * roster and today's and yesterday's posters), the hand-over notes from
 * updates dated today or yesterday, and whether the next shift has posted
 * today. `chain` is the page's one chain (shiftChain over Team Time's
 * places, today), the one the form's hint, the digest and Amr read, so a
 * hand-over names the same next place everywhere. Null with fewer than two
 * shifts.
 */
export function handoverRows({
  entries,
  places,
  chain,
  roster,
  today,
  now,
}: {
  entries: readonly StandupEntry[];
  places: StandupPlaces | undefined;
  chain: readonly StandupShift[];
  roster: readonly string[];
  today: string;
  now: Date;
}): HandoverRow[] | null {
  if (!places || chain.length < 2) return null;
  const yesterday = addDays(today, -1);
  const recent = entries.filter((e) => e.date === today || e.date === yesterday);
  const names = new Map<string, string>();
  for (const n of [...roster, ...recent.map((e) => e.member)]) {
    const key = nameKey(n);
    if (key && !names.has(key)) names.set(key, n.trim());
  }
  const at = (member: string) => shiftIndex(chain, places.get(nameKey(member)));
  return chain.map((place, here) => {
    const after = (here + 1) % chain.length;
    const next = chain[after];
    const people = Array.from(names.entries())
      .filter(([key]) => shiftIndex(chain, places.get(key)) === here)
      .map(([, name]) => name);
    const notes = recent
      .filter((e) => at(e.member) === here && (e.handoff ?? "").trim())
      .sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp)
      .map((e) => ({ member: e.member, date: e.date, text: (e.handoff ?? "").trim() }));
    let localTime = "";
    try {
      localTime = localTimeText(place.zone, now);
    } catch {
      localTime = "";
    }
    return {
      place,
      localTime,
      people,
      notes,
      next,
      nextPosted: entries.some((e) => e.date === today && at(e.member) === after),
    };
  });
}

/**
 * Follow the sun, in async mode: the shift chain east to west and back,
 * each place's time now, the hand-overs left there today or yesterday, and
 * whether the next place has posted today.
 */
export function HandoversPanel({ rows, today }: { rows: HandoverRow[]; today: string }) {
  const chain = rows.map((r) => r.place.label);
  return (
    <SectionCard title="Hand-overs" icon={Sun} className="min-w-0">
      <div data-handovers>
        <p className="mb-3 break-words text-sm text-sub">
          {chain.join(" → ")} → back to {chain[0]}
        </p>
        <ol className="space-y-3" aria-label="Shifts, east to west">
          {rows.map((r) => (
            <li
              key={`${r.place.label}|${r.place.zone}`}
              className="space-y-1 rounded-md border border-border p-3"
            >
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium text-text">{r.place.label}</span>
                {r.localTime && (
                  <span className="font-data text-xs text-sub">{r.localTime} there</span>
                )}
              </p>
              {r.people.length > 0 && (
                <p className="break-words text-xs text-sub">{r.people.join(", ")}</p>
              )}
              {r.notes.length > 0 ? (
                <ul className="space-y-1">
                  {r.notes.map((n) => (
                    <li key={`${n.member}-${n.date}`} className="break-words text-sm text-text">
                      <span className="font-medium">{n.member}</span>
                      {n.date !== today ? " (yesterday)" : ""} to {r.next.label}: {n.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-sub">No hand-over left here today or yesterday.</p>
              )}
              <p className={r.nextPosted ? "text-xs text-success" : "text-xs text-warning"}>
                {r.next.label} {r.nextPosted ? "has posted today." : "hasn't posted today yet."}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </SectionCard>
  );
}
