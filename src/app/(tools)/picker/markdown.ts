import {
  TEAM_SOURCE,
  awayToday,
  nextForRole,
  roleStandings,
  sourceLabel,
  timeAgo,
  wheelView,
  type PickerEntry,
  type PickerState,
} from "@/lib/picker/model";
import { nameKey } from "@/lib/team/names";

/** "12 Nov 2026" */
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

export interface PickerMarkdownInput {
  state: PickerState;
  /** The wheel's source names, removed ones included (sourceEntries). */
  entries: readonly PickerEntry[];
  /** Local day, YYYY-MM-DD, for who is away today. */
  today: string;
}

/**
 * The wheel and its rules, each role's rotation with who is due and the
 * fairness table, the recent picks and the name shortlist: something to
 * paste into the team's wiki or the retro notes.
 */
export function toMarkdown(
  { state, entries, today }: PickerMarkdownInput,
  now: Date = new Date()
): string {
  const lines = [`# Picker — ${mdDate(now)}`, ""];
  const view = wheelView(entries, state.progress, state.everyoneOnce);
  const eligible = new Set(view.eligible);

  lines.push(`## Wheel: ${md(sourceLabel(state))}`, "");
  if (view.shown.length === 0 && view.removed.length === 0) {
    lines.push(
      state.source === TEAM_SOURCE
        ? "No names yet. Add the team on the Team page or make a list."
        : "No names on this list yet.",
      ""
    );
  } else {
    const rules = [
      state.everyoneOnce
        ? `Everyone once: round ${view.round}, ${view.left} still to come up.`
        : "Anyone can come up on any spin.",
      state.removePicked ? "A name leaves the wheel once it is picked." : "",
    ].filter(Boolean);
    lines.push(...rules, "");
    lines.push("| Name | Weight | Can come up next |", "|---|---:|---|");
    view.shown.forEach((e, i) =>
      lines.push(`| ${md(e.name)} | ${e.weight} | ${eligible.has(i) ? "Yes" : "Had a turn"} |`)
    );
    lines.push("");
    if (view.removed.length > 0)
      lines.push(`Off the wheel: ${view.removed.map(md).join(", ")}.`, "");
  }

  const people = entries.map((e) => e.name);
  const away = awayToday(state.away, today);
  lines.push("## Roles", "");
  if (people.length === 0) lines.push("Nobody to rotate yet.", "");
  for (const role of state.roles) {
    const next = nextForRole(people, state.roleTurns, role.id, away);
    lines.push(
      `### ${md(role.name)}`,
      "",
      next ? `Next up: ${md(next)}.` : "Nobody is free today.",
      ""
    );
    const rows = roleStandings(people, state.roleTurns, role.id, away);
    if (rows.length > 0) {
      lines.push("| Person | Turns | Last turn |", "|---|---:|---|");
      for (const r of rows) {
        const last = r.lastAt ? timeAgo(r.lastAt, now) : "never";
        lines.push(`| ${md(r.name)}${r.away ? " (away today)" : ""} | ${r.turns} | ${last} |`);
      }
      lines.push("");
    }
  }
  if (away.length > 0) {
    const names = entries.filter((e) => away.includes(nameKey(e.name))).map((e) => md(e.name));
    if (names.length > 0) lines.push(`Away today: ${names.join(", ")}.`, "");
  }

  lines.push("## Recent picks", "");
  if (state.recent.length === 0) lines.push("Nothing picked yet.", "");
  else {
    lines.push("| When | Result | From |", "|---|---|---|");
    for (const r of state.recent) {
      lines.push(`| ${timeAgo(r.at, now)} | ${md(r.result)} | ${md(r.detail)} |`);
    }
    lines.push("");
  }

  lines.push("## Name shortlist", "");
  if (state.shortlist.length === 0) lines.push("No names shortlisted.");
  else lines.push(...state.shortlist.map((n) => `- ${md(n)}`));

  return `${lines.join("\n").trimEnd()}\n`;
}
