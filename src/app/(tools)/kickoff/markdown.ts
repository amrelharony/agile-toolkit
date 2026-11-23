/**
 * A kickoff as Markdown: its name, format, date and status, who was there,
 * then each section (lib/sectioned's `sectionsMarkdown`), with a line's
 * owner in brackets, a worry's ratings and what a line covers; the
 * trade-offs as a table from holds firm to gives first; and the format's
 * credit line. Lines are collapsed and table cells escaped.
 */

import { coveredWorry, formatOf, oneLine, orderedSliders, shortText } from "@/lib/kickoff/model";
import { PEOPLE_SECTION, type KickoffSectionDef } from "@/lib/kickoff/formats";
import { creditLine, creditUrl, sectionsMarkdown } from "@/lib/sectioned/model";
import type { Kickoff, KickoffItem } from "@/lib/stores/workspace-types";

/** A table cell: one line, its pipes escaped. */
const cell = (s: string) => oneLine(s).replace(/\|/g, "\\|");

const STATUS_LABEL = { draft: "Draft", agreed: "Agreed" } as const;

/** A day as "16 Nov 2026"; anything else as it is. */
function dayText(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function itemLine(k: Kickoff, item: KickoffItem, def: KickoffSectionDef): string {
  const text = oneLine(item.text);
  const owner = item.owner ? oneLine(item.owner) : "";
  if (def.id === PEOPLE_SECTION) return text ? `${owner}: ${text}` : owner;
  if (def.id === "statement") return text ? `> ${text}` : "";
  let line = owner ? (text ? `${text} (${owner})` : owner) : text;
  if (def.ratings) {
    const parts = [
      item.likelihood ? `likely ${item.likelihood}/5` : "",
      item.impact ? `impact ${item.impact}/5` : "",
    ].filter(Boolean);
    if (parts.length > 0) line += ` · ${parts.join(" · ")}`;
  }
  if (def.covers) {
    const worry = coveredWorry(k, item);
    if (worry) line += ` (covers: ${shortText(worry.item.text, 80)})`;
  }
  return line;
}

export function kickoffToMarkdown(k: Kickoff | null, { today }: { today: string }): string {
  if (!k) return "# Kickoff\n\nNo kickoff yet.\n";
  const format = formatOf(k);
  const meta = [
    format.name,
    k.date ? dayText(k.date) : "",
    k.status === "agreed" && k.agreedAt ? `Agreed ${dayText(k.agreedAt)}` : STATUS_LABEL[k.status],
  ].filter(Boolean);
  const blocks: string[] = [`# ${oneLine(k.title) || format.name}`, meta.join(" · ")];
  if (k.participants && k.participants.length > 0) {
    blocks.push(`Participants: ${k.participants.map(oneLine).join(", ")}`);
  }
  if (k.brief?.trim()) blocks.push(k.brief.replace(/\r\n?/g, "\n").trim());
  const body = sectionsMarkdown({ ...format, credit: undefined }, k.sections, {
    itemLine: (item, def) => itemLine(k, item, def as KickoffSectionDef),
  });
  if (body) blocks.push(body);
  const sliders = orderedSliders(k);
  if (format.hasSliders && sliders.length > 0) {
    const last = sliders.length;
    blocks.push(
      "## Trade-offs",
      [
        "| Order | Trade-off | Note |",
        "| --- | --- | --- |",
        ...sliders.map((s) => {
          const order =
            s.position === 1
              ? "1 (holds firm)"
              : s.position === last
                ? `${last} (gives first)`
                : String(s.position);
          return `| ${order} | ${cell(s.label)} | ${cell(s.note ?? "")} |`;
        }),
      ].join("\n")
    );
  }
  if (format.credit) {
    const url = creditUrl(format.credit);
    blocks.push(url ? `${creditLine(format.credit)} · ${url}` : creditLine(format.credit));
  }
  blocks.push(`Exported ${dayText(today)}.`);
  return `${blocks.join("\n\n")}\n`;
}
