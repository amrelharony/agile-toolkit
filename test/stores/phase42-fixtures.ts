/**
 * One full record of each Phase 42 workspace collection (the tools plan's
 * phase 1), every optional field set, for the store and CRUD tests.
 */
import type {
  InterruptItem,
  MeetingAudit,
  NotebookEntry,
  ParkingLotItem,
  ProductGoal,
  RootCauseAnalysis,
  Sprint,
  Story,
} from "@/lib/stores/workspace-types";

const AT = "2026-11-12T09:00:00.000Z";
const LATER = "2026-11-12T10:30:00.000Z";

export const PARKED: ParkingLotItem = {
  id: "parking_1",
  text: "Should we move the demo to Thursday?",
  meeting: "Daily Scrum",
  raisedBy: "Ana",
  status: "sent",
  sentTo: [{ route: "backlog-story", targetId: "story_9", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

export const ANALYSIS: RootCauseAnalysis = {
  id: "rca_1",
  title: "Releases slip on Fridays",
  problem: "Three of the last four Friday releases went out after 6 pm.",
  method: "fishbone",
  whys: [
    { id: "w1", text: "The release branch is cut on Friday morning." },
    { id: "w2", text: "Testing waits for the cut." },
  ],
  causes: [
    { id: "c1", category: "Process", text: "Branch cut too late", count: 3 },
    { id: "c2", category: "Tools", text: "Slow end-to-end suite", count: 1 },
  ],
  rootCause: "The release branch is cut too late in the week.",
  countermeasure: "Cut the release branch on Wednesday.",
  retroBoardId: "retro:current",
  postMortemId: "pm_4",
  sourceRef: { tool: "retro", id: "card_7", doc: "retro:current" },
  sentTo: [{ route: "retro-action", targetId: "action_2", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

export const GOAL: ProductGoal = {
  id: "goal_1",
  statement: "Small shops can take card payments on their phone in under a minute.",
  why: "Card readers cost too much for the shops we serve.",
  measures: ["Median setup time", "Weekly active shops"],
  targetDate: "2027-03-31",
  status: "achieved",
  closedAt: LATER,
  note: "Reached in February.",
  createdAt: AT,
  updatedAt: LATER,
};

export const INTERRUPT: InterruptItem = {
  id: "interrupt_1",
  sprintId: "sprint_12",
  title: "Checkout fails for one bank",
  kind: "incident",
  size: 3,
  emergency: true,
  loggedAt: AT,
  resolvedAt: LATER,
  sentTo: [{ route: "impediment", targetId: "imp_3", at: LATER }],
};

export const NOTE: NotebookEntry = {
  id: "note_1",
  date: "2026-11-12",
  title: "Quiet standup",
  body: "Two people didn't speak. Ask in their 1:1s.",
  tags: ["participation", "standup"],
  event: "daily-scrum",
  linkedTool: "standup",
  sentTo: [{ route: "retro-topic", targetId: "card_8", at: LATER }],
  createdAt: AT,
  updatedAt: LATER,
};

export const MEETING: MeetingAudit = {
  id: "meeting_1",
  meeting: "Weekly status",
  cadence: "weekly",
  minutes: 60,
  attendees: 9,
  purpose: "Share progress with the managers.",
  ratings: { purpose: 2, people: 3, length: 1 },
  verdict: "change",
  notes: "Go async, keep a monthly call.",
  createdAt: AT,
  updatedAt: LATER,
};

export const SPRINT_WITH_BUFFER: Sprint = {
  id: "sprint_12",
  name: "Sprint 12",
  startDate: "2026-11-10",
  endDate: "2026-11-21",
  pointsPlanned: 30,
  status: "active",
  interruptBuffer: { pct: 20, points: 6 },
};

export const STORY_WITH_GWT: Story = {
  id: "story_gwt",
  title: "Pay by phone",
  status: "todo",
  acceptanceCriteria: "Works on Android and iOS.",
  gwt: [
    {
      id: "g1",
      given: "a shop with a card",
      when: "the owner taps Pay",
      then: "the payment goes through",
    },
    { id: "g2", given: "no signal", when: "the owner taps Pay", then: "they see a retry button" },
  ],
};
