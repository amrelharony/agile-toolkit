import { durationText } from "@/app/(tools)/ceremony-timer/agenda";
import type { TimedStep } from "@/lib/timer/step-timer";
import type { SquadAction } from "./store";

export interface SessionEpisode {
  ep: number;
  title: string;
  lesson: string;
  question: string;
}

/** A line of a list: one line, whatever was typed. */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * The session as Markdown, for the team channel afterwards: the episode, how the
 * time was planned, and what was agreed, marked where it's already gone to Retro
 * Actions.
 */
export function toMarkdown({
  episode,
  steps,
  actions,
  sent = () => false,
}: {
  /** The episode picked, or null before one is. */
  episode: SessionEpisode | null;
  steps: readonly TimedStep[];
  actions: readonly SquadAction[];
  /** Whether an action's retro card still exists. */
  sent?: (action: SquadAction) => boolean;
}): string {
  const title = "# Squad Session";
  if (!episode) return `${title}\n\nNo episode picked yet.\n`;

  const lines = [
    title,
    "",
    `**Episode ${episode.ep}:** ${oneLine(episode.title)}`,
    "",
    `**The lesson:** ${oneLine(episode.lesson)}`,
    "",
    `**Ask your team:** ${oneLine(episode.question)}`,
    "",
    "## Steps",
    "",
    ...steps.map((s, i) => `${i + 1}. ${s.label} (${durationText(s.seconds)})`),
    "",
    "## Actions",
    "",
  ];
  if (actions.length === 0) lines.push("None agreed yet.");
  for (const action of actions) {
    const owner = action.owner ? ` (${oneLine(action.owner)})` : "";
    const where = sent(action) ? " — in Retro Actions" : "";
    lines.push(`- ${oneLine(action.title)}${owner}${where}`);
  }
  return `${lines.join("\n")}\n`;
}
