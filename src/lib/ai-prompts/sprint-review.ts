import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData } from "./prompt-utils";

interface SprintReviewData {
  sprintName: string;
  sprintNumber: number;
  features: { name: string; description: string; timeMinutes: number }[];
  feedbackItems: { stakeholder: string; feedback: string; category: string }[];
  checklistItems: { label: string; checked: boolean }[];
  committed: number;
  completed: number;
}

export function generateSprintReviewPrompts(data: SprintReviewData): PromptDefinition[] {
  if (data.features.length === 0 && data.feedbackItems.length === 0) return [];

  const featureTable = formatTable(
    ["Feature", "Description", "Demo Time (min)"],
    data.features.map((f) => [f.name, f.description.slice(0, 60) + (f.description.length > 60 ? "..." : ""), f.timeMinutes])
  );

  const { data: shownFeedback } = truncateData(data.feedbackItems, 15);
  const feedbackText = shownFeedback.length > 0
    ? shownFeedback.map((f) => `- [${f.category}] ${f.stakeholder}: ${f.feedback}`).join("\n")
    : "(no feedback recorded)";

  const completionRate = data.committed > 0 ? Math.round((data.completed / data.committed) * 100) : 0;
  const checklistDone = data.checklistItems.filter((c) => c.checked).length;

  return [
    {
      id: "review-summary",
      title: "Sprint Review Summary",
      description: "Generate a stakeholder-ready summary with highlights and next steps.",
      prompt: buildPreamble("Sprint Review", `Preparing review for "${data.sprintName}" (Sprint #${data.sprintNumber}).`) +
        `## Demo Features\n\n${featureTable}\n\n## Stakeholder Feedback\n\n${feedbackText}\n\n## Velocity\n\nCommitted: ${data.committed} pts | Completed: ${data.completed} pts | Completion: ${completionRate}%\n\n## Checklist\n\n${checklistDone}/${data.checklistItems.length} items complete\n\n## Questions\n\n1. Write a 3-paragraph sprint review summary suitable for sending to stakeholders.\n2. What are the key highlights and achievements from this sprint?\n3. What concerns or risks should be communicated to stakeholders?\n4. Based on the feedback, what should be prioritized in the next sprint?\n5. Draft a brief "What's Next" section that sets expectations for the upcoming sprint.`,
    },
    {
      id: "review-feedback",
      title: "Feedback Action Plan",
      description: "Categorize stakeholder feedback and create an actionable response plan.",
      prompt: buildPreamble("Sprint Review", "Turn stakeholder feedback into actionable items.") +
        `## Stakeholder Feedback\n\n${feedbackText}\n\n## Demo Features Shown\n\n${featureTable}\n\n## Questions\n\n1. Group the feedback by theme — what patterns emerge?\n2. For each concern or suggestion, propose a concrete next step with an owner.\n3. Which feedback items should become backlog items? Draft brief user stories for them.\n4. How should the team follow up with stakeholders who raised concerns?\n5. What feedback signals that the team should change direction or reprioritize?`,
    },
  ];
}
