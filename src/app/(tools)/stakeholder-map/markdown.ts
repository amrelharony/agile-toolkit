import {
  QUADRANTS,
  QUADRANT_LABEL,
  SENTIMENT_LABEL,
  daysToTouch,
  gapText,
  isPlaced,
  quadrantOf,
  sentimentGap,
  stakeholderVerdict,
  touchStatus,
  type Stakeholder,
} from "./model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** "Skeptic → Supporter (2 steps short)", "Champion", or "sentiment not set". */
export function sentimentText(s: Stakeholder): string {
  const now = s.currentSentiment ? SENTIMENT_LABEL[s.currentSentiment] : "not set";
  if (!s.desiredSentiment) return s.currentSentiment ? now : "sentiment not set";
  const gap = gapText(sentimentGap(s));
  return `${now} → ${SENTIMENT_LABEL[s.desiredSentiment]}${gap ? ` (${gap})` : ""}`;
}

function line(s: Stakeholder): string {
  const head = `- **${oneLine(s.name)}**${s.role ? ` (${oneLine(s.role)})` : ""}`;
  const parts = [
    isPlaced(s) ? `interest ${s.interest}, authority ${s.authority}` : null,
    sentimentText(s),
    s.lastContactAt ? `last contact ${s.lastContactAt}` : null,
    s.nextTouchAt ? `next touch ${s.nextTouchAt}` : null,
  ].filter(Boolean);
  const strategy = s.strategy?.trim() ? ` — ${oneLine(s.strategy)}` : "";
  return `${head} · ${parts.join(" · ")}${strategy}`;
}

/**
 * The map as Markdown: the verdict, stakeholders by quadrant (sentiment now
 * → needed, last contact, next touch, strategy), the ones not placed yet,
 * and the touches due, soonest first.
 */
export function stakeholdersToMarkdown(list: readonly Stakeholder[], today: string): string {
  const lines = ["# Stakeholder map", "", `> ${oneLine(stakeholderVerdict(list, today))}`, ""];
  if (list.length === 0) return `${lines.join("\n")}\n`;
  for (const q of QUADRANTS) {
    const inQ = list.filter((s) => quadrantOf(s) === q);
    if (inQ.length === 0) continue;
    lines.push(`## ${QUADRANT_LABEL[q]}`, "", ...inQ.map(line), "");
  }
  const unplaced = list.filter((s) => !isPlaced(s));
  if (unplaced.length > 0) lines.push("## Not placed yet", "", ...unplaced.map(line), "");
  const due = list
    .filter((s) => s.nextTouchAt)
    .sort((a, b) => (a.nextTouchAt as string).localeCompare(b.nextTouchAt as string));
  if (due.length > 0) {
    lines.push(
      "## Touches due",
      "",
      ...due.map((s) => {
        const d = daysToTouch(s, today) ?? 0;
        const when =
          touchStatus(s, today) === "overdue"
            ? `overdue by ${-d === 1 ? "1 day" : `${-d} days`}`
            : d === 0
              ? "today"
              : `in ${d === 1 ? "1 day" : `${d} days`}`;
        return `- ${s.nextTouchAt} · ${oneLine(s.name)} (${when})`;
      }),
      ""
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
