import { exampleId, hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { SCALES, type Participant, type Session, type Story } from "./types";

/** The lobby's defaults, reused by the example's facilitator row. */
export const DEFAULT_SESSION_NAME = "Sprint Planning";
export const DEFAULT_DISPLAY_NAME = "Scrum Master";

// Votes on the round that's on the table (story 4, revealed).
const PEOPLE: [key: string, name: string, vote: string][] = [
  ["priya", "Priya (PM)", "5"],
  ["lee", "Lee (iOS)", "5"],
  ["ana", "Ana (Android)", "3"],
  ["jo", "Jo (Backend)", "5"],
  ["sam", "Sam (QA)", "?"],
];

const STORIES: Omit<Story, "id">[] = [
  {
    title: "Show saved cards at checkout",
    description: "Returning shoppers pick a saved card instead of typing the number again.",
    finalEstimate: "3",
    rounds: [["3", "3", "3", "3", "5"]],
  },
  {
    title: "Retry failed card payments",
    description:
      "When the bank declines for a temporary reason, offer one retry before asking for another card.",
    finalEstimate: "8",
    // Split until the team agreed it covers the bank's retry rules, not
    // just a "Try again" button.
    rounds: [
      ["2", "3", "3", "8", "13"],
      ["5", "8", "8", "8", "8"],
    ],
  },
  {
    title: "Fix totals rounding on discounted orders",
    description: "The order total is a cent off when two discounts stack.",
    finalEstimate: "2",
    rounds: [["1", "2", "2", "2", "2"]],
  },
  {
    title: "Add a digital wallet button",
    description: "One-tap pay with the phone's wallet on the payment step.",
    finalEstimate: null,
  },
  {
    title: "Address lookup by ZIP code",
    description: "Fill in city and state from the ZIP code on the shipping form.",
    finalEstimate: null,
  },
];

/**
 * A mobile checkout team's refinement, three stories in: one re-voted
 * after a 2-to-13 split, and the current round revealed with a "?" from
 * QA. Every id is an example id except the facilitator's: that row is the
 * person at the keyboard (SessionScreen finds their deck and host role by
 * it), so it's theirs, not example data.
 */
export function buildExample(hostId: string, hostName = DEFAULT_DISPLAY_NAME): Session {
  const host: Participant = { id: hostId, name: hostName, vote: null };
  return {
    roomCode: exampleId("poker"),
    sessionName: "Checkout app: Sprint 14 refinement",
    scale: [...SCALES.fibonacci],
    scaleType: "fibonacci",
    host: hostName,
    hostId,
    participants: [
      host,
      ...PEOPLE.map(([key, name, vote]) => ({ id: exampleId(`poker-${key}`), name, vote })),
    ],
    stories: STORIES.map((s, i) => ({ ...s, id: exampleId(`poker-story-${i + 1}`) })),
    currentStoryIdx: 3,
    revealed: true,
  };
}

/** Whether `session` is (or still holds part of) the example. */
export function isExampleSession(session: Session | null): boolean {
  return Boolean(session && (isExampleId(session.roomCode) || hasExampleItems(session.stories)));
}
