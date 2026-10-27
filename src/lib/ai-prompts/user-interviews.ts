import type { PromptDefinition } from "./types";
import { buildPreamble, truncateData, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { Interview, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { participantCount, themeCounts } from "../interviews/model";
import { interviewsVerdict } from "@/app/(tools)/user-interviews/view";

/**
 * The log as the User Interviews page exports it: the interviews as
 * forExport gives them (anonymised when the page's toggle is on, so the
 * prompt follows it), and whether they are.
 */
interface InterviewsData {
  interviews: readonly Interview[];
  anonymised: boolean;
}

/** The most quotes and interviews listed. */
const MAX_QUOTES = 40;
const MAX_INTERVIEWS = 30;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2026-10-01" for a stored day, "no date" for a missing one. */
const dayOf = (i: Pick<Interview, "date">) => String(i.date ?? "").slice(0, 10) || "no date";

/**
 * The interview prompts with the page's numbers (lib/interviews): each
 * theme counted per participant ("3 of 5 participants"), not per quote,
 * the strongest theme in the page's verdict, each interview's context,
 * and the quotes with their tags. With the toggle on, everything is the
 * anonymised copy the exports take: "Participant N" pseudonyms, and
 * context and quotes through redactPii and the participant's own name.
 */
export function generateUserInterviewsPrompts(
  data: InterviewsData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { interviews } = data;
  if (interviews.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";
  const people = participantCount(interviews);
  const themes = themeCounts(interviews);
  const who = (i: Interview) =>
    sanitizePromptCell(i.participant ?? "", 60) || "Unnamed participant";

  const interviewLines = interviews.slice(0, MAX_INTERVIEWS).map((i) => {
    const context = i.context?.trim() ? `: ${sanitizePromptCell(i.context, 300)}` : "";
    return `- ${dayOf(i)}, ${who(i)} (${plural((i.quotes ?? []).length, "quote")})${context}`;
  });
  const quoteLines: string[] = [];
  for (const i of interviews) {
    for (const q of i.quotes ?? []) {
      if (!q.text?.trim()) continue;
      // Interview quotes are a high injection-risk surface: a participant
      // could say an attacker prompt that the team transcribes verbatim.
      // Each is sanitised (newlines collapsed, backticks and delimiter
      // literals stripped) and clamped at 400 characters so one tirade
      // can't take the prompt's budget.
      const safe = sanitizePromptCell(q.text, 400).replace(/"/g, '\\"');
      const tags = (q.tags ?? []).map((t) => sanitizePromptCell(t, 30)).join(", ");
      quoteLines.push(`- (${who(i)}, ${dayOf(i)}) [${tags}] "${safe}"`);
    }
  }
  const { data: sample, truncated, totalCount } = truncateData(quoteLines, MAX_QUOTES);
  const quotes =
    sample.length === 0
      ? "No quotes yet."
      : `${sample.join("\n")}${truncated ? `\n(Showing ${MAX_QUOTES} of ${totalCount} quotes)` : ""}`;
  const themeLines =
    themes.length === 0
      ? "No quote is tagged yet."
      : themes
          .slice(0, 50)
          .map(
            (t) =>
              `- ${sanitizePromptCell(t.tag, 30)}: ${t.participants} of ${plural(people, "participant")} (${plural(t.quotes, "quote")})`
          )
          .join("\n");
  const verdict = `Verdict: ${sanitizePromptCell(interviewsVerdict(interviews), 400)}`;
  const privacy = data.anonymised
    ? " Participants are anonymised as “Participant N”, with contact details and their own names redacted from the text."
    : "";
  const context = `${plural(interviews.length, "interview")} with ${plural(people, "participant")}. Themes are counted per participant: one person who tags a theme on five quotes is one voice.${privacy}`;
  // Names, context, quotes and tags are user-typed.
  const themesBlock = `## Themes (participants who raised each)\n\n${themeLines}`;

  return [
    {
      id: "ui-synthesis",
      title: "Interview Synthesis",
      description: "Cluster quotes into themes and surface insight patterns.",
      prompt:
        buildPreamble("User Interview Log", context) +
        `${wrapUserContent(`${verdict}\n\n${themesBlock}\n\n## Quotes\n\n${quotes}`)}${wsContext}\n\n## Questions\n\n1. What 3-5 insight themes emerge? Which rest on one or two voices only?\n2. Which quotes are the strongest evidence for each theme?\n3. What product implications follow?`,
    },
    {
      id: "ui-gaps",
      title: "Research Gaps",
      description: "Identify what the team hasn't learned yet.",
      prompt:
        buildPreamble(
          "User Interview Log",
          `${context} Good research surfaces what you don't know, not just what you do.`
        ) +
        `${wrapUserContent(`${verdict}\n\n${themesBlock}\n\n## Interviews\n\n${interviewLines.join("\n")}`)}${wsContext}\n\n## Questions\n\n1. Which user segments, use cases, or jobs are under-represented?\n2. What contradictory quotes deserve follow-up?\n3. Recommend 3 next interview topics.`,
    },
  ];
}
