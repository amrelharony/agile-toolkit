/**
 * Team Mixer's show-room renderers: frame kind → component, one per kind
 * in `../frames/team-mixer.ts`. Kept small and free of tool page code: the
 * `/join` page loads it for every show room.
 *
 * On a phone each frame has a "Find your name" box, so in a room of forty
 * everyone finds their own group in a second; the match is said politely
 * (and shown in bold, with its group outlined). Nothing typed is sent.
 */

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TEAM_MIXER_FRAME_KINDS, type CafeFrame, type GroupsFrame } from "../frames/team-mixer";
import { defineShowRenderer, type ShowRendererProps, type ShowRenderers } from "./types";

/** At least two letters, so one keystroke doesn't light up half the room. */
function useFind() {
  const [text, setText] = useState("");
  const key = text.trim().toLowerCase();
  const hit = (name: string) => key.length >= 2 && name.toLowerCase().includes(key);
  return { text, setText, key, hit };
}

/** "Ana is in Group 2." / "2 names match: …" / "Nobody by that name …". */
function findStatus(key: string, matches: readonly string[], none: string): string {
  if (key.length < 2) return "";
  if (matches.length === 0) return none;
  if (matches.length === 1) return matches[0];
  const shown = matches.slice(0, 4);
  return `${matches.length} names match: ${shown.join("; ")}${matches.length > shown.length ? "; …" : ""}`;
}

function FindBox({ find, status }: { find: ReturnType<typeof useFind>; status: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        Find your name
      </label>
      <Input
        id={id}
        type="search"
        autoComplete="off"
        value={find.text}
        onChange={(e) => find.setText(e.target.value)}
      />
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-text">
        {status}
      </p>
    </div>
  );
}

export function GroupsFrameView({ payload, surface }: ShowRendererProps<GroupsFrame>) {
  const find = useFind();
  const phone = surface === "phone";
  const word = payload.unit === "pair" ? "Pair" : "Group";
  const label = (i: number) => payload.groups[i].name || `${word} ${i + 1}`;
  const matches: string[] = [];
  payload.groups.forEach((g, i) =>
    g.people.filter(find.hit).forEach((p) => matches.push(`${p} is in ${label(i)}.`))
  );
  payload.sitOut.filter(find.hit).forEach((p) => matches.push(`${p} sits out this round.`));

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        {payload.title && <p className="break-words text-sm text-sub">{payload.title}</p>}
        <p
          className={
            phone ? "text-2xl font-bold text-text sm:text-3xl" : "text-lg font-semibold text-text"
          }
        >
          Round {payload.round}: {payload.groups.length}{" "}
          {payload.unit === "pair" ? "pairs" : "groups"}
        </p>
      </div>
      {phone && (
        <FindBox
          find={find}
          status={findStatus(find.key, matches, "Nobody by that name in this round.")}
        />
      )}
      <ul className={cn("grid gap-3", phone ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {payload.groups.map((g, i) => {
          const mine = g.people.some(find.hit);
          return (
            <li
              key={i}
              className={cn(
                "min-w-0 rounded-lg border p-3",
                mine ? "border-accent bg-accent/10" : "border-border bg-card"
              )}
            >
              <p className="break-words font-semibold text-text">{label(i)}</p>
              <ul className="mt-1 space-y-0.5" aria-label={label(i)}>
                {g.people.map((p, k) => (
                  <li
                    key={`${k}-${p}`}
                    className={cn(
                      "break-words text-text",
                      phone ? "text-base" : "text-sm",
                      find.hit(p) && "font-bold"
                    )}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {payload.sitOut.length > 0 && (
        <p className="break-words text-sm text-sub">
          Sitting out this round: {payload.sitOut.join(", ")}.
        </p>
      )}
    </div>
  );
}

export function CafeFrameView({ payload, surface }: ShowRendererProps<CafeFrame>) {
  const find = useFind();
  const phone = surface === "phone";
  const label = (i: number) => payload.tables[i].name || `Table ${i + 1}`;
  const matches: string[] = [];
  payload.tables.forEach((t, i) => {
    if (find.hit(t.host)) matches.push(`${t.host} hosts ${label(i)} and stays there.`);
    t.guests.filter(find.hit).forEach((p) => matches.push(`${p} goes to ${label(i)}.`));
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        {payload.title && <p className="break-words text-sm text-sub">{payload.title}</p>}
        <p
          className={
            phone ? "text-2xl font-bold text-text sm:text-3xl" : "text-lg font-semibold text-text"
          }
        >
          World Café, round {payload.round} of {payload.rounds}
        </p>
        <p className="text-sm text-sub">Hosts stay at their table; everyone else moves.</p>
      </div>
      {phone && (
        <FindBox
          find={find}
          status={findStatus(find.key, matches, "Nobody by that name at a table this round.")}
        />
      )}
      <ul className={cn("grid gap-3", phone ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
        {payload.tables.map((t, i) => {
          const mine = find.hit(t.host) || t.guests.some(find.hit);
          return (
            <li
              key={i}
              className={cn(
                "min-w-0 rounded-lg border p-3",
                mine ? "border-accent bg-accent/10" : "border-border bg-card"
              )}
            >
              <p className="break-words font-semibold text-text">{label(i)}</p>
              <p
                className={cn(
                  "break-words text-sm text-sub",
                  find.hit(t.host) && "font-bold text-text"
                )}
              >
                Host: {t.host}
              </p>
              <ul className="mt-1 space-y-0.5" aria-label={`${label(i)} guests`}>
                {t.guests.map((p, k) => (
                  <li
                    key={`${k}-${p}`}
                    className={cn(
                      "break-words text-text",
                      phone ? "text-base" : "text-sm",
                      find.hit(p) && "font-bold"
                    )}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const TEAM_MIXER_RENDERERS: ShowRenderers = {
  [TEAM_MIXER_FRAME_KINDS.groups]: defineShowRenderer<GroupsFrame>(GroupsFrameView),
  [TEAM_MIXER_FRAME_KINDS.cafe]: defineShowRenderer<CafeFrame>(CafeFrameView),
};
