import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface PlanningPokerData {
  stories: { title: string; votes: (string | number)[]; finalEstimate: string | null; description?: string }[];
  scaleName: string;
}

export function generatePlanningPokerPrompts(data: PlanningPokerData): PromptDefinition[] {
  const storiesWithVotes = data.stories.filter((s) => s.votes.length > 0);
  if (storiesWithVotes.length === 0) return [];

  const table = formatTable(
    ["Story", "Description", "Votes", "Final Estimate", "Spread"],
    storiesWithVotes.map((s) => {
      const nums = s.votes.map((v) => typeof v === "number" ? v : parseFloat(String(v))).filter((n) => !isNaN(n));
      const spread = nums.length > 1 ? Math.max(...nums) - Math.min(...nums) : 0;
      return [s.title, (s.description ?? "—").slice(0, 80), s.votes.join(", "), s.finalEstimate ?? "TBD", spread];
    })
  );

  return [
    {
      id: "poker-quality",
      title: "Estimation Quality Review",
      description: "Identify high-variance stories and improve estimation accuracy.",
      prompt: buildPreamble("Planning Poker", `The team used the "${data.scaleName}" scale to estimate stories.`) +
        `## Stories & Votes\n\n${table}\n\n## Questions\n\n1. Which stories had the highest vote spread? These need more discussion — what questions should the team ask?\n2. Are there patterns in who votes high vs. low? What might explain systematic bias?\n3. For high-spread stories, suggest how to decompose them into smaller, more estimable pieces.\n4. What does the overall estimation distribution tell you about the team's upcoming sprint complexity?\n5. Create a brief "estimation disagreement protocol" — what should the team do when votes differ by more than 2 scale points?`,
    },
    {
      id: "poker-splitting",
      title: "Story Splitting Suggestions",
      description: "Get help splitting large or complex stories into smaller deliverables.",
      prompt: buildPreamble("Planning Poker", "Help the team split large stories into smaller pieces.") +
        `## Stories & Estimates\n\n${table}\n\n## Questions\n\n1. Which stories are likely too large for a single sprint? (Typically anything above 8 points.)\n2. For each large story, suggest 2-3 ways to split it while maintaining independent deliverability.\n3. What splitting patterns work best — by workflow step, by user type, by happy/sad path, by data scope?\n4. After splitting, would the sum of split estimates likely be larger than the original? Why, and is that okay?\n5. How should the team handle stories that seem impossible to split below 8 points?`,
    },
  ];
}
