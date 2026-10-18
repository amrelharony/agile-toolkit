import { castVotes, isNumeric, sortVotes } from "./rounds";
import { SCALE_LABELS, type Session, type Story } from "./types";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line of text, for headings and list items. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return oneLine(v).replace(/\|/g, "\\|");
}

const NONE = "—";

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The votes behind a story: the revealed round on the table, else its last recorded one. */
function votesFor(session: Session, story: Story, idx: number): string[] {
  if (session.revealed && idx === session.currentStoryIdx) {
    const live = castVotes(session.participants);
    if (live.length > 0) return sortVotes(live, session.scale);
  }
  const rounds = story.rounds ?? [];
  return rounds.length > 0 ? rounds[rounds.length - 1] : [];
}

/** Points add up; T-shirt sizes and other labels are counted instead. */
function summary(session: Session): string {
  const values = session.stories.map((s) => s.finalEstimate).filter((v): v is string => v !== null);
  const progress = `${values.length} of ${count(session.stories.length, "story", "stories")} estimated`;
  if (values.every(isNumeric)) {
    const total = Math.round(values.reduce((sum, v) => sum + Number(v), 0) * 100) / 100;
    return `**Total: ${count(total, "point")}** (${progress})`;
  }
  const tally = new Map<string, number>();
  for (const v of sortVotes(values, session.scale)) tally.set(v, (tally.get(v) ?? 0) + 1);
  const sizes = Array.from(tally, ([v, n]) => `${oneLine(v)} ×${n}`).join(", ");
  return `**Estimated:** ${sizes} (${progress})`;
}

/** The session's stories and agreed estimates, for a refinement page or the sprint ticket. */
export function toMarkdown(session: Session | null, now: Date = new Date()): string {
  const name = oneLine(session?.sessionName);
  const title = `# Planning Poker — ${mdDate(now)}${name ? ` (${name})` : ""}`;
  if (!session || session.stories.length === 0) return `${title}\n\nNo stories estimated yet.\n`;

  const scale = SCALE_LABELS[session.scaleType] ?? "Custom";
  const lines = [
    title,
    "",
    `${scale} scale, ${count(session.participants.length, "participant")}.`,
    "",
    "## Estimates",
    "",
    "| Story | Estimate | Votes |",
    "|---|---:|---|",
    ...session.stories.map((s, i) => {
      const votes = votesFor(session, s, i);
      const estimate = s.finalEstimate === null ? NONE : cell(s.finalEstimate);
      return `| ${cell(s.title)} | ${estimate} | ${votes.length > 0 ? cell(votes.join(", ")) : NONE} |`;
    }),
    "",
    summary(session),
  ];

  const revoted = session.stories.filter((s) => (s.rounds?.length ?? 0) > 1);
  if (revoted.length > 0) {
    lines.push(
      "",
      "## Re-voted",
      "",
      ...revoted.map((s) => {
        const path = (s.rounds ?? []).map((r) => r.join(", ")).join(" → ");
        const outcome =
          s.finalEstimate === null ? "not agreed yet" : `agreed ${oneLine(s.finalEstimate)}`;
        return `- **${oneLine(s.title)}**: ${oneLine(path)} (${outcome})`;
      })
    );
  }
  return `${lines.join("\n")}\n`;
}
