import { exampleId } from "@/components/tool-frame/example-data";
import type { MeetingNote, MeetingNoteItem } from "@/lib/stores/workspace-types";
import { shiftDay } from "@/lib/notes-to-actions/due";

/**
 * Our own Sprint Review notes, from yesterday: an action with an owner and
 * a day, a decision, a blocker, a bug, an open question, and two plain
 * lines that need no follow-up. Two items are already kept; the rest wait
 * for "Find the actions". Dates count from `today`, and the ids mark it as
 * the example, so nothing in it is ever sent to another tool.
 */
export function buildExample(today: string, now: Date = new Date()): MeetingNote {
  const date = shiftDay(today, -1);
  const at = new Date(now.getTime() - 3600_000).toISOString();
  const text = [
    "Sprint Review",
    "- The new search went down well with the three customers who came.",
    "- Ana to update the onboarding copy by Friday",
    "- Decided: we stop supporting the old export",
    "- Waiting on legal sign-off for the cookie banner",
    "- CSV export cuts off long names",
    "- Do we demo on staging or live next time?",
    "- Thanks to Sam for running the demo.",
  ].join("\n");
  const item = (key: string, over: Omit<MeetingNoteItem, "id" | "status" | "keptAt">) => ({
    id: exampleId(`note-item-${key}`),
    status: "open" as const,
    keptAt: at,
    ...over,
  });
  return {
    id: exampleId("notes-review"),
    meeting: "Sprint Review",
    date,
    text,
    items: [
      item("copy", {
        kind: "action",
        text: "Update the onboarding copy",
        owner: "Ana",
        quote: "Ana to update the onboarding copy by Friday",
      }),
      item("export", {
        kind: "decision",
        text: "Stop supporting the old export",
        detail: "Fewer than 2% of exports still use it.",
        quote: "Decided: we stop supporting the old export",
      }),
    ],
    createdAt: at,
    updatedAt: at,
  };
}
