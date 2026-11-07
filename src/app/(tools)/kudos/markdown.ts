import type { Kudos } from "@/lib/stores/workspace-types";
import type { RosterName } from "@/lib/kudos/recognition";
import { isExampleId } from "@/lib/utils/example-id";
import { localDay } from "@/lib/sprints/series";
import { cardName, designFor } from "@/lib/kudos/card-designs";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

const byTime = (a: Kudos, b: Kudos) => Date.parse(a.sentAt) - Date.parse(b.sentAt);

function line(k: Kudos, reply: boolean): string {
  const day = localDay(k.sentAt) ?? "";
  const team = k.teamName ? ` (${oneLine(k.teamName)})` : "";
  if (reply) return `  - Reply from ${oneLine(k.fromName)} · ${day} — ${oneLine(k.message)}`;
  // The printed card it is drawn as: an original theme reads "Thank you!".
  const card = cardName(designFor(k));
  return `- **${card}** to ${oneLine(k.toName)}${team} from ${oneLine(k.fromName)} · ${day} — ${oneLine(k.message)}`;
}

export interface KudosMarkdownOptions {
  /** "in Sprint 12", "in the last 30 days", "so far": the Not thanked yet window. */
  windowLabel: string;
  /** The team's size: with nobody on it, the Not thanked yet section is left out. */
  rosterSize: number;
}

/**
 * The wall as Markdown: who hasn't been thanked in the window (names only,
 * never a count; left out without a team), then every kudos newest first
 * with its replies under it. Example kudos are left out: the export is the
 * team's own wall.
 */
export function kudosToMarkdown(
  kudos: readonly Kudos[],
  notThanked: readonly RosterName[],
  { windowLabel, rosterSize }: KudosMarkdownOptions
): string {
  const own = kudos.filter((k) => !isExampleId(k.id));
  const lines = ["# Kudos wall", ""];
  if (rosterSize > 0) {
    lines.push(`## Not thanked yet ${windowLabel}`, "");
    if (notThanked.length > 0) lines.push(...notThanked.map((m) => `- ${oneLine(m.name)}`));
    else lines.push(`Everyone on your team has been thanked ${windowLabel}.`);
    lines.push("");
  }
  lines.push("## Wall", "");
  if (own.length === 0) {
    lines.push("No kudos yet.");
    return `${lines.join("\n")}\n`;
  }
  const ids = new Set(own.map((k) => k.id));
  const replies = new Map<string, Kudos[]>();
  const tops: Kudos[] = [];
  for (const k of own) {
    // A reply whose kudos is gone stands on its own, as on the wall.
    if (k.replyTo && ids.has(k.replyTo)) {
      replies.set(k.replyTo, [...(replies.get(k.replyTo) ?? []), k]);
    } else {
      tops.push(k);
    }
  }
  for (const k of [...tops].sort(byTime).reverse()) {
    lines.push(line(k, false));
    for (const r of (replies.get(k.id) ?? []).sort(byTime)) lines.push(line(r, true));
  }
  return `${lines.join("\n")}\n`;
}

/** The wall as CSV rows, oldest first, examples left out. */
export function kudosCsv(kudos: readonly Kudos[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: ["Sent at", "To", "From", "Card", "Team", "Message", "Reply to"],
    rows: kudos
      .filter((k) => !isExampleId(k.id))
      .slice()
      .sort(byTime)
      .map((k) => [
        k.sentAt,
        k.toName,
        k.fromName,
        cardName(designFor(k)),
        k.teamName ?? "",
        k.message,
        k.replyTo ?? "",
      ]),
  };
}
