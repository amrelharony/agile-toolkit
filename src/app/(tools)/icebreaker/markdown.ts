import { icebreakers, type IceBreaker } from "@/lib/constants/icebreakers";
import { plural } from "@/lib/charts/chart-text";
import { daysAgoText } from "./filter";
import { peopleLabel } from "./sizes";
import type { IcebreakerUse } from "./store";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const byId = new Map(icebreakers.map((ib) => [ib.id, ib]));

export interface IcebreakerMarkdownInput {
  /** The activity on screen, if any. */
  selected: IceBreaker | null;
  /** The headcount filtered on; null for any size. */
  people: number | null;
  /** Favourite catalog ids. */
  favorites: readonly string[];
  /** Recorded uses, any order. */
  used: readonly IcebreakerUse[];
}

/**
 * A facilitation card for the chosen warm-up (time, people, energy, how to
 * run it), then the team's favourites and what it used lately: something
 * to paste into the meeting invite or the team's wiki.
 */
export function toMarkdown(
  { selected, people, favorites, used }: IcebreakerMarkdownInput,
  now: Date = new Date()
): string {
  const lines = [`# Icebreaker — ${mdDate(now)}`, ""];

  if (selected) {
    lines.push(
      `## ${md(selected.name)}`,
      "",
      `${capital(selected.category)} · ${selected.timeMinutes} min · ${peopleLabel(
        selected
      )} · ${selected.energyLevel} energy`,
      "",
      md(selected.description),
      "",
      `**How to run it:** ${md(selected.instructions)}`,
      ""
    );
    if (people !== null) lines.push(`Planned for ${plural(people, "person", "people")}.`, "");
  } else {
    lines.push("No activity picked yet.", "");
  }

  const favs = favorites.map((id) => byId.get(id)).filter((ib): ib is IceBreaker => Boolean(ib));
  lines.push("## Favorites", "");
  if (favs.length === 0) lines.push("No favorites yet.", "");
  else {
    lines.push(
      ...favs.map((ib) => `- ${md(ib.name)} (${ib.timeMinutes} min, ${peopleLabel(ib)})`),
      ""
    );
  }

  const rows = [...used]
    .filter((u) => byId.has(u.icebreakerId))
    .sort((a, b) => Date.parse(b.usedAt) - Date.parse(a.usedAt));
  lines.push("## Used recently", "");
  if (rows.length === 0) lines.push("Nothing recorded yet.");
  else {
    lines.push(
      "| Date | Activity | Minutes | When |",
      "|---|---|---:|---|",
      ...rows.map(
        (u) =>
          `| ${mdDate(new Date(u.usedAt))} | ${md(byId.get(u.icebreakerId)?.name)} | ${
            u.minutes
          } | ${daysAgoText(u.usedAt, now)} |`
      )
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
