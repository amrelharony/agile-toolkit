import { exampleId } from "@/components/tool-frame/example-data";
import type { DefinitionOfDone, Sprint, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";
import { DOD_DOC_ID } from "@/lib/dod/model";

/** What the example shows: its own DoD, sprints and stories. Nothing is saved. */
export interface DodExample {
  doc: DefinitionOfDone;
  /** Newest first, as the sprint picker lists them. */
  sprints: Sprint[];
  stories: Story[];
}

const REVIEW = exampleId("dod-review");
const UNIT = exampleId("dod-unit");
const CI = exampleId("dod-ci");
const DOCS = exampleId("dod-docs");
const REQUIRED = [REVIEW, UNIT, CI];

/** Each sprint's stories: done ones with the required criteria they left open, then the rest. */
const SPRINTS: { done: { title: string; open?: string[] }[]; open?: string[] }[] = [
  {
    done: [
      { title: "Show the basket total with tax" },
      { title: "Remember the last delivery address", open: [UNIT] },
      { title: "Card number field formatting" },
      { title: "Retry a failed payment", open: [UNIT, CI] },
    ],
  },
  {
    done: [
      { title: "Apple Pay on the web" },
      { title: "Order confirmation email", open: [REVIEW] },
      { title: "Promo code field" },
      { title: "Guest checkout", open: [UNIT] },
      { title: "Save cards for later" },
    ],
  },
  {
    done: [
      { title: "Split the basket by seller" },
      { title: "Show delivery slots" },
      { title: "Cancel an order within an hour", open: [CI] },
      { title: "Gift messages" },
    ],
  },
  {
    done: [
      { title: "Refund to the original card" },
      { title: "Show stock on the product page" },
      { title: "Reorder from history", open: [UNIT] },
      { title: "Address lookup by postcode" },
      { title: "Clearer card errors" },
    ],
  },
  {
    done: [
      { title: "Pay by bank transfer" },
      { title: "Track a parcel" },
      { title: "Accessible date picker" },
      { title: "Receipts as PDF" },
    ],
  },
  {
    done: [
      { title: "One-tap reorder" },
      { title: "Pay by card in one step", open: [UNIT, CI] },
      { title: "Loyalty points at checkout" },
    ],
    open: ["Split payments", "Checkout in Welsh"],
  },
];

/**
 * A checkout team's last six sprints with a four-criterion DoD (three
 * required, docs optional): five finished sprints whose done stories meet
 * it more often each sprint (2 of 4, then 3 of 5, 3 of 4, 4 of 5 and all
 * 4), and the sprint in progress, where one of the three done stories
 * still needs its unit tests and CI. Six sprints are enough for the trend
 * test, not for control limits, so Advanced analysis shows both states.
 *
 * Every id is an `example-` id, and it all stays in the page's memory.
 */
export function buildExample(today: string = todayIso()): DodExample {
  const day = (n: number) => addDays(today, n) as string;
  const at = (n: number) => new Date(`${day(n)}T15:00:00`).toISOString();
  const last = SPRINTS.length - 1;
  const sprints: Sprint[] = SPRINTS.map((_, i) => {
    // The sprint in progress started 7 days ago; each before it is two weeks earlier.
    const start = -7 - 14 * (last - i);
    return {
      id: exampleId(`dod-sprint-${i + 1}`),
      name: `Sprint ${20 + i}`,
      startDate: day(start),
      endDate: day(start + 13),
      pointsPlanned: 0,
      status: i === last ? "active" : "completed",
    };
  });
  const stories: Story[] = SPRINTS.flatMap((s, i) => {
    const sprint = sprints[i];
    const story = (n: number, title: string, status: StoryStatus): Story => ({
      id: exampleId(`dod-story-${i + 1}-${n}`),
      title,
      status,
      sprintId: sprint.id,
      points: 3,
    });
    const done = s.done.map((d, n) => {
      const ticked = [...REQUIRED.filter((id) => !d.open?.includes(id)), ...(n % 2 ? [DOCS] : [])];
      const doneAt = at(Math.min(-1, -7 - 14 * (last - i) + 10));
      return {
        ...story(n + 1, d.title, "done"),
        doneAt,
        ...(ticked.length > 0 ? { dodChecks: { checked: ticked, updatedAt: doneAt } } : {}),
      };
    });
    const open = (s.open ?? []).map((title, n) =>
      story(s.done.length + n + 1, title, "in_progress")
    );
    return [...done, ...open];
  });
  return {
    doc: {
      id: DOD_DOC_ID,
      items: [
        { id: REVIEW, label: "Code reviewed by a peer", category: "code", required: true },
        { id: UNIT, label: "Unit tests added or updated", category: "testing", required: true },
        { id: CI, label: "Integration tests pass in CI", category: "testing", required: true },
        { id: DOCS, label: "README or inline docs updated", category: "docs", required: false },
      ],
      history: [],
    },
    sprints: [...sprints].reverse(),
    stories,
  };
}
