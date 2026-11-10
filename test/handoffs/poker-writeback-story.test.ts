import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { takeQueuedStories, writeBackPokerEstimate } from "@/lib/handoffs/poker-writeback";
import {
  POKER_LOG_ID,
  STORY_QUEUE_TOOL,
  pokerQueueRoute,
  storyQueueSource,
} from "@/lib/handoffs/targets/poker-queue";
import { isValidSession } from "@/app/(tools)/planning-poker/types";

/**
 * Sprint Planning queues workspace stories for Planning Poker; an accepted
 * numeric estimate becomes the story's points. A T-shirt size is logged but
 * can't become points. A story's notes and acceptance criteria go with it,
 * folded into the description the session already carries.
 */

const ws = () => useWorkspaceStore.getState();
const log = () => ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID);

beforeEach(() => {
  useWorkspaceStore.setState({
    stories: [{ id: "st1", title: "Fraud checks", status: "todo", sprintId: "s2" }],
    pokerEstimationLogs: [],
  });
});

function queueAndTake(): string {
  pokerQueueRoute.send({ title: "Fraud checks", sourceRef: { tool: "story", id: "st1" } });
  const [session] = takeQueuedStories();
  return session.id;
}

describe("poker write-back to stories", () => {
  it("writes a numeric estimate to the story's points and clears the queue", () => {
    const sessionStoryId = queueAndTake();
    const result = writeBackPokerEstimate({ sessionStoryId, value: "5", scaleType: "fibonacci" });
    expect(result.written).toBe(true);
    expect(ws().stories[0].points).toBe(5);
    expect(log()?.queue ?? []).toHaveLength(0);
    expect(log()?.estimates[0]).toMatchObject({
      storyTitle: "Fraud checks",
      finalEstimate: "5",
      sourceRef: { tool: "story", id: "st1" },
      // Which session story it was: the queue entry that knew is gone now.
      sessionStoryId,
    });
  });

  it("logs a non-numeric estimate without inventing points", () => {
    const sessionStoryId = queueAndTake();
    const result = writeBackPokerEstimate({ sessionStoryId, value: "M", scaleType: "tshirt" });
    expect(result.written).toBe(false);
    expect(ws().stories[0].points).toBeUndefined();
    expect(log()?.estimates[0]?.finalEstimate).toBe("M");
  });

  it("does nothing when the story is gone", () => {
    const sessionStoryId = queueAndTake();
    useWorkspaceStore.setState({ stories: [] });
    expect(
      writeBackPokerEstimate({ sessionStoryId, value: "3", scaleType: "fibonacci" }).written
    ).toBe(false);
  });
});

describe("a queued story's notes and acceptance criteria", () => {
  const detailed: Story = {
    id: "st1",
    title: "Fraud checks",
    status: "todo",
    sprintId: "s2",
    notes: "Card payments only.",
    acceptanceCriteria: "- A flagged payment is held\n- The customer is told why",
    link: "https://tracker.example.com/PAY-12",
    ticketKey: "PAY-12",
  };
  const folded =
    "Card payments only.\n\nAcceptance criteria:\n- A flagged payment is held\n- The customer is told why";

  it("go to the queue as the one description Poker shows", () => {
    expect(storyQueueSource(detailed)).toEqual({
      title: "Fraud checks",
      description: folded,
      sourceRef: { tool: STORY_QUEUE_TOOL, id: "st1" },
    });
    // A story with neither sends no description, as before.
    expect(storyQueueSource({ id: "st2", title: "Receipts" })).toEqual({
      title: "Receipts",
      sourceRef: { tool: "story", id: "st2" },
    });
  });

  it("reach the session story unchanged, in the shape the live room already carries", () => {
    pokerQueueRoute.send(storyQueueSource(detailed));
    expect(log()?.queue?.[0]).toMatchObject({ title: "Fraud checks", description: folded });
    const [session] = takeQueuedStories();
    expect(session).toEqual({
      id: expect.any(String),
      title: "Fraud checks",
      description: folded,
      finalEstimate: null,
    });
    // The room's validator takes it: title, description, estimate, nothing new.
    expect(
      isValidSession({
        roomCode: "ABCD",
        sessionName: "Refinement",
        scale: ["1", "2", "3"],
        scaleType: "fibonacci",
        host: "Ann",
        hostId: "p1",
        participants: [{ id: "p1", name: "Ann", vote: null }],
        stories: [session],
        currentStoryIdx: 0,
        revealed: false,
      })
    ).toBe(true);
  });

  it("still write the estimate back to the story", () => {
    pokerQueueRoute.send(storyQueueSource(detailed));
    const [session] = takeQueuedStories();
    useWorkspaceStore.setState({ stories: [detailed] });
    expect(
      writeBackPokerEstimate({ sessionStoryId: session.id, value: "8", scaleType: "fibonacci" })
        .written
    ).toBe(true);
    expect(ws().stories[0]).toMatchObject({ points: 8, notes: "Card payments only." });
  });
});
