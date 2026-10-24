import { exampleId } from "@/components/tool-frame/example-data";
import type { StandupEntry, StandupMode, Story, StoryStatus } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

type Row = Pick<StandupEntry, "member" | "yesterday" | "today" | "blockers"> & {
  /** Added in async mode, where people write a line of context. */
  note?: string;
};

/**
 * Today's standup for a mobile checkout team: four updates, two blockers
 * (one waiting on another team, one waiting on a review).
 */
const ROWS: Row[] = [
  {
    member: "Priya (PM)",
    yesterday: "Wrote the acceptance criteria for saved cards and walked Ana through them.",
    today: "Confirm the holiday sale dates with marketing and update the release plan.",
    blockers: "",
  },
  {
    member: "Sam (QA)",
    yesterday: "Regression pass on the cart. Found a double charge when a payment retries.",
    today: "Retest the retry fix on staging, then pair with Lee on the flaky login test.",
    blockers: "",
    note: "Out from 3 pm for a dentist appointment.",
  },
  {
    member: "Lee (iOS)",
    yesterday: "Added the wallet payments button to the cart, behind a feature flag.",
    today: "Connect the button to the payments sandbox.",
    blockers: "Still waiting on wallet payments sandbox keys from the payments team.",
  },
  {
    member: "Ana (Backend)",
    yesterday: "Found the double charge: retries don't reuse the idempotency key.",
    today: "Ship the fix to staging and add a test for a retry after a timeout.",
    blockers: "The migration that adds the idempotency key index needs a DBA review.",
  },
];

/** The example people, for telling their board apart from the user's. */
export const EXAMPLE_MEMBERS: readonly string[] = ROWS.map((r) => r.member);

/**
 * The example's entries, dated today in speaking order. Live mode gives
 * live entries; async mode gives async ones with a note where someone
 * would write one. Either way they show in both modes.
 */
export function buildExample(now: Date = new Date(), mode: StandupMode = "live"): StandupEntry[] {
  const date = todayLocalISO(now);
  // A few minutes apart, in speaking order.
  return ROWS.map(({ note, ...r }, i) => ({
    ...r,
    id: exampleId(`standup-${i + 1}`),
    date,
    timestamp: now.getTime() - (ROWS.length - i) * 2 * 60_000,
    mode,
    ...(mode === "async" && note ? { description: note } : {}),
  }));
}

const BOARD: {
  member: string;
  title: string;
  status: StoryStatus;
  points: number;
  blocked?: true;
}[] = [
  { member: "Priya (PM)", title: "Saved cards: acceptance criteria", status: "done", points: 2 },
  { member: "Priya (PM)", title: "Holiday sale release plan", status: "in_progress", points: 1 },
  { member: "Sam (QA)", title: "Cart regression pass", status: "done", points: 3 },
  { member: "Sam (QA)", title: "Fix the flaky login test", status: "todo", points: 2 },
  {
    member: "Lee (iOS)",
    title: "Wallet payments button",
    status: "in_progress",
    points: 5,
    blocked: true,
  },
  { member: "Lee (iOS)", title: "Saved card picker", status: "todo", points: 3 },
  {
    member: "Ana (Backend)",
    title: "Reuse the idempotency key on retry",
    status: "review",
    points: 3,
  },
  {
    member: "Ana (Backend)",
    title: "Idempotency key index migration",
    status: "todo",
    points: 2,
    blocked: true,
  },
];

/** The example sprint's name, shown over the example board. */
export const EXAMPLE_SPRINT_NAME = "Sprint 5 (example)";

/**
 * The example people's sprint stories, for walking the board. Shown as a
 * read-only preview while the example is loaded and never written to the
 * workspace: fake stories would feed the burndown, the cockpit and agents.
 */
export function buildExampleBoard(): Story[] {
  return BOARD.map((b, i) => ({
    id: exampleId(`standup-story-${i + 1}`),
    title: b.title,
    points: b.points,
    status: b.status,
    sprintId: exampleId("standup-sprint"),
    owner: b.member,
    ...(b.blocked ? { blocked: true } : {}),
  }));
}
