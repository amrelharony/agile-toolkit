import type { Interview } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { exampleId } from "@/lib/utils/example-id";

/**
 * Three interviews a product team might log about weekly reporting. Every
 * participant raises "reporting" (a theme heard by 3 of 3), while one of
 * them tags "pricing" on two quotes (one voice, two quotes), so the theme
 * counts show why they go by participant. Days count back from `today`.
 * Ids start with `example-`; "Clear example" removes exactly them, and
 * example quotes never go to the Opportunity Tree.
 */
export function buildExample(today: string): Interview[] {
  const ago = (n: number) => addDays(today, -n) ?? today;
  return [
    {
      id: exampleId("ui-sam"),
      date: ago(3),
      participant: "Sam, engineering manager",
      context: "Team of 9 on the Team plan; runs two-week sprints.",
      quotes: [
        {
          id: exampleId("ui-sam-1"),
          text: "Every Friday I copy the board into a spreadsheet so my director can see who's blocked.",
          tags: ["reporting", "blockers"],
        },
        {
          id: exampleId("ui-sam-2"),
          text: "The per-seat price adds up once contractors join for a quarter.",
          tags: ["pricing"],
        },
        {
          id: exampleId("ui-sam-3"),
          text: "I'd pay for a team plan if contractors didn't count as seats.",
          tags: ["pricing"],
        },
      ],
    },
    {
      id: exampleId("ui-priya"),
      date: ago(8),
      participant: "Priya, product owner",
      context: "Agency team; reports to three clients.",
      quotes: [
        {
          id: exampleId("ui-priya-1"),
          text: "Clients ask what we finished this week, and I build that report by hand.",
          tags: ["reporting"],
        },
        {
          id: exampleId("ui-priya-2"),
          text: "Onboarding a new client board takes most of a morning.",
          tags: ["onboarding"],
        },
      ],
    },
    {
      id: exampleId("ui-lee"),
      date: ago(15),
      participant: "Lee, Scrum Master",
      quotes: [
        {
          id: exampleId("ui-lee-1"),
          text: "Before the review I screenshot the burndown and paste it into slides.",
          tags: ["reporting"],
        },
        {
          id: exampleId("ui-lee-2"),
          text: "Blocked cards sit for days because nobody sees them.",
          tags: ["blockers"],
        },
      ],
    },
  ];
}
