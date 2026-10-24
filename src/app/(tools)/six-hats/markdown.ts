import type { HandoffLink, SixHatsSession, SixHatsThought } from "@/lib/stores/workspace-types";
import { hatInfo, hatName } from "./hats";
import { byHat, hatColumns, isAdoptedSession } from "./session";
import { balanceSentence } from "./verdict";

/** "18 Oct 2026" */
function mdDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line: pasted line breaks become spaces. */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** A thought as a list item; its own line breaks stay inside the item. */
const item = (t: SixHatsThought) => `- ${t.text.trim().replace(/\s*\r?\n\s*/g, "\n  ")}`;

const minutes = (m: number) => `${m} minute${m === 1 ? "" : "s"}`;

/**
 * A session as a Markdown record for the team's wiki or the decision's
 * context: the topic, the hats in the order worn, every thought under its
 * hat (oldest first), the Blue hat's summary and where it went (`decided`
 * once the team accepted it in the Decision Log). Without a session
 * (`null`): the earlier thoughts that belong to none. A session made from
 * earlier thoughts never had timed rounds, so it claims none.
 */
export function toMarkdown(
  session: SixHatsSession | null,
  thoughts: readonly SixHatsThought[],
  opts: { decision?: HandoffLink; decided?: boolean } = {}
): string {
  const title = session
    ? `# Six Thinking Hats — ${oneLine(session.topic)}`
    : "# Six Thinking Hats — Earlier thoughts";
  const lines: string[] = [title, ""];

  if (session && isAdoptedSession(session)) {
    const until = session.closedAt ? ` to ${mdDate(session.closedAt)}` : "";
    lines.push(
      `Thoughts logged ${mdDate(session.startedAt)}${until}, before sessions had timed rounds.`,
      ""
    );
  } else if (session) {
    const when = [`Started ${mdDate(session.startedAt)}`];
    if (session.closedAt) when.push(`closed ${mdDate(session.closedAt)}`);
    when.push(`${session.order.length} rounds of ${minutes(session.roundMinutes)}`);
    lines.push(when.join(" · "), "");
    lines.push(`**Order:** ${session.order.map((h) => hatInfo(h).name).join(" → ")}`, "");
  }
  lines.push(
    `**${balanceSentence(session ? oneLine(session.topic) : null, session?.order ?? null, thoughts)}**`,
    ""
  );

  // Each hat's thoughts in the order they were said.
  const groups = byHat([...thoughts].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)));
  for (const hat of hatColumns(session?.order ?? null, thoughts)) {
    lines.push(`## ${hatName(hat)} (${hatInfo(hat).focus})`, "");
    const list = groups[hat];
    if (list.length === 0) lines.push("_No thoughts under this hat._");
    else lines.push(...list.map(item));
    lines.push("");
  }

  if (session) {
    lines.push("## Summary (Blue hat)", "");
    lines.push(session.summary?.trim() ? session.summary.trim() : "_No summary yet._", "");
    if (opts.decision) {
      const at = mdDate(opts.decision.at);
      lines.push(
        opts.decided
          ? `Sent to the Decision Log on ${at}, and decided there.`
          : `Sent to the Decision Log as a proposed decision on ${at}.`,
        ""
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
