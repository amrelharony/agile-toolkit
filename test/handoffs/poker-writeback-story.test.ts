import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { takeQueuedStories, writeBackPokerEstimate } from "@/lib/handoffs/poker-writeback";
import { POKER_LOG_ID, pokerQueueRoute } from "@/lib/handoffs/targets/poker-queue";

/**
 * Sprint Planning queues workspace stories for Planning Poker; an accepted
 * numeric estimate becomes the story's points. A T-shirt size is logged but
 * can't become points.
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
