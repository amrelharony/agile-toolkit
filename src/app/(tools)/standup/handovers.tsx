"use client";

import { Sun } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { nextPlace, shiftChain, type StandupPlaces } from "@/lib/standup/entries";
import type { StandupEntry } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import { localTimeText } from "@/lib/team-time/format";
import type { StandupPlace } from "@/lib/team-time/sun";
import { addDays } from "@/lib/impediments/model";

export interface HandoverRow {
  place: StandupPlace;
  /** Their clock now: "Tue 07:30". */
  localTime: string;
  /** The people Team Time puts there, as they post. */
  people: string[];
  /** Hand-overs left there today or yesterday, newest first. */
  notes: { member: string; date: string; text: string }[];
  next: StandupPlace;
  /** Someone at the next place has posted today. */
  nextPosted: boolean;
}

/**
 * The follow-the-sun chain for the Hand-overs panel: each place east to
 * west, its clock now, the hand-over notes from updates dated today or
 * yesterday, and whether the next place has posted today. Null unless Team
 * Time knows two places or more among the people posting (the roster and
 * today's and yesterday's posters).
 */
export function handoverRows({
  entries,
  places,
  roster,
  today,
  now,
}: {
  entries: readonly StandupEntry[];
  places: StandupPlaces | undefined;
  roster: readonly string[];
  today: string;
  now: Date;
}): HandoverRow[] | null {
  if (!places) return null;
  const yesterday = addDays(today, -1);
  const recent = entries.filter((e) => e.date === today || e.date === yesterday);
  const names = new Map<string, string>();
  for (const n of [...roster, ...recent.map((e) => e.member)]) {
    const key = nameKey(n);
    if (key && !names.has(key)) names.set(key, n.trim());
  }
  const placeKey = (p: StandupPlace) => `${p.label}|${p.zone}`;
  const posting = new Set<string>();
  for (const key of Array.from(names.keys())) {
    const p = places.get(key);
    if (p) posting.add(placeKey(p));
  }
  if (posting.size < 2) return null;
  const chain = shiftChain(places, today).filter((p) => posting.has(placeKey(p)));
  const at = (member: string) => {
    const p = places.get(nameKey(member));
    return p ? placeKey(p) : null;
  };
  return chain.map((place) => {
    const here = placeKey(place);
    const next = nextPlace(chain, place) as StandupPlace;
    const people = Array.from(names.entries())
      .filter(([key]) => {
        const p = places.get(key);
        return p !== undefined && placeKey(p) === here;
      })
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
      nextPosted: entries.some((e) => e.date === today && at(e.member) === placeKey(next)),
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
