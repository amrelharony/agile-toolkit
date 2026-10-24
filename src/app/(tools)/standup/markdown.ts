import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { hasBlocker } from "@/lib/standup/entries";
import { addDays } from "@/lib/impediments/model";
import { ageLabel, blockerAgeDays, openBlockers } from "./model";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A "YYYY-MM-DD" day as a local date, for `mdDate`. */
const localDay = (day: string) => new Date(`${day}T12:00:00`);

/** A list item's text: one line. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** "Bo", "Bo and Cy", "Bo, Cy and Di". */
function listAnd(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const heading = (e: StandupEntry) =>
  `### ${oneLine(e.member)}${e.mode === "async" ? " (async)" : ""}`;

/**
 * Today's standup (the entries dated `now`'s local day), blockers first so
 * they're the first thing read when pasted into a team channel. Live and
 * async updates together; an async one is marked. `notPosted` names the
 * people still to post.
 */
export function toMarkdown(
  entries: readonly StandupEntry[],
  now: Date = new Date(),
  { notPosted = [] }: { notPosted?: readonly string[] } = {}
): string {
  const title = `# Standup — ${mdDate(now)}`;
  const day = todayLocalISO(now);
  const todays = entries.filter((e) => e.date === day).sort((a, b) => a.timestamp - b.timestamp);
  const waiting = notPosted.length > 0 ? `Not posted yet: ${listAnd(notPosted.map(oneLine))}.` : "";
  if (todays.length === 0) {
    return `${title}\n\nNo standup updates for today yet.\n${waiting ? `\n${waiting}\n` : ""}`;
  }

  const withBlocker = todays.filter(hasBlocker);
  const open = withBlocker.filter((e) => !e.blockerResolved);
  const resolved = withBlocker.filter((e) => e.blockerResolved);

  const lines = [
    title,
    "",
    `${todays.length} ${todays.length === 1 ? "update" : "updates"}, ${open.length} open ${
      open.length === 1 ? "blocker" : "blockers"
    }.`,
  ];
  if (waiting) lines.push("", waiting);
  lines.push("", "## Blockers", "");
  if (withBlocker.length === 0) lines.push("No blockers.");
  for (const e of open) lines.push(`- **${oneLine(e.member)}:** ${oneLine(e.blockers)}`);
  for (const e of resolved) {
    lines.push(`- **${oneLine(e.member)}:** ~~${oneLine(e.blockers)}~~ (resolved)`);
  }

  lines.push("", "## Updates");
  for (const e of todays) {
    lines.push(
      "",
      heading(e),
      "",
      `- **Yesterday:** ${oneLine(e.yesterday) || "—"}`,
      `- **Today:** ${oneLine(e.today) || "—"}`
    );
    if (oneLine(e.description)) lines.push(`- **Notes:** ${oneLine(e.description)}`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * The last `days` days (ending `now`'s local day) per person, for a weekly
 * note to stakeholders or a retro: how many updates, the blockers raised
 * and the ones still open with their age, then each person's days.
 */
export function weeklyMarkdown(
  entries: readonly StandupEntry[],
  now: Date = new Date(),
  days = 7
): string {
  const end = todayLocalISO(now);
  const start = addDays(end, -(days - 1));
  const title = `# Standup week — ${mdDate(localDay(start))} to ${mdDate(localDay(end))}`;
  const inRange = entries
    .filter((e) => e.date >= start && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.timestamp - b.timestamp);
  if (inRange.length === 0) return `${title}\n\nNo standup updates in these ${days} days.\n`;

  const people = Array.from(new Set(inRange.map((e) => oneLine(e.member)))).sort((a, b) =>
    a.localeCompare(b)
  );
  const dayCount = new Set(inRange.map((e) => e.date)).size;
  const raised = inRange.filter(hasBlocker);
  const open = openBlockers(inRange);
  const lines = [
    title,
    "",
    `${inRange.length} ${inRange.length === 1 ? "update" : "updates"} from ${people.length} ${
      people.length === 1 ? "person" : "people"
    } over ${dayCount} ${dayCount === 1 ? "day" : "days"}; ${raised.length} ${
      raised.length === 1 ? "blocker" : "blockers"
    } raised, ${open.length} still open.`,
  ];
  if (open.length > 0) {
    lines.push("", "## Open blockers", "");
    for (const e of open) {
      const age = blockerAgeDays(e, end);
      lines.push(
        `- **${oneLine(e.member)}** (${age === 0 ? "raised today" : `${ageLabel(age)} old`}): ${oneLine(e.blockers)}`
      );
    }
  }
  for (const person of people) {
    lines.push("", `## ${person}`);
    for (const e of inRange.filter((x) => oneLine(x.member) === person)) {
      lines.push("", `**${mdDate(localDay(e.date))}**${e.mode === "async" ? " (async)" : ""}`);
      lines.push(`- Yesterday: ${oneLine(e.yesterday) || "—"}`);
      lines.push(`- Today: ${oneLine(e.today) || "—"}`);
      if (hasBlocker(e)) {
        lines.push(`- Blockers: ${oneLine(e.blockers)}${e.blockerResolved ? " (resolved)" : ""}`);
      }
      if (oneLine(e.description)) lines.push(`- Notes: ${oneLine(e.description)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
