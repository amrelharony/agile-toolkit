/**
 * Phase 5 link fields survive agent updates.
 *
 * `workspace.<entity>.update` validates the merged record and writes the
 * parsed object, and z.object drops keys it doesn't know. A link field
 * that isn't in the entity's Zod schema is therefore erased by the next
 * unrelated agent update. Each case creates a record with the new field,
 * patches something else, and checks the field is still there.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  CapacityPlan,
  Impediment,
  PokerEstimationLog,
  PrioritizationItem,
  RetroBoard,
  Risk,
  StandupEntry,
  StoryMap,
} from "@/lib/stores/workspace-types";

import "@/lib/actions/workspace";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const ref = { tool: "retro", id: "card-1", doc: "retro:current" };
const link = { route: "impediment" as const, targetId: "imp-1", at: "2026-10-18T10:00:00.000Z" };

async function update(entity: string, id: string, patch: Record<string, unknown>) {
  const action = registry.get(`workspace.${entity}.update`);
  expect(action, `workspace.${entity}.update`).toBeDefined();
  return action!.handler({ id, patch }, ctx());
}

beforeEach(() => {
  useWorkspaceStore.setState({
    impediments: [],
    risks: [],
    prioritizations: [],
    backlogItems: [],
    standupEntries: [],
    retroBoards: [],
    storyMaps: [],
    capacityPlans: [],
    pokerEstimationLogs: [],
  });
});

describe("hand-off and backlog link fields survive agent updates", () => {
  it("impediment.sourceRef", async () => {
    const imp: Impediment = {
      id: "imp-1",
      title: "Sandbox keys",
      severity: "high",
      raisedAt: "2026-10-18",
      source: "retro",
      sourceRef: ref,
    };
    useWorkspaceStore.setState({ impediments: [imp] });
    await update("impediment", "imp-1", { owner: "Sam" });
    expect(useWorkspaceStore.getState().impediments[0].sourceRef).toEqual(ref);
  });

  it("risk.sourceRef", async () => {
    const risk: Risk = {
      id: "risk-1",
      title: "Payments sandbox outage",
      probability: 4,
      impact: 4,
      status: "open",
      raisedAt: "2026-10-18",
      sourceRef: { tool: "premortem", id: "cause-1" },
    };
    useWorkspaceStore.setState({ risks: [risk] });
    await update("risk", "risk-1", { status: "mitigating" });
    expect(useWorkspaceStore.getState().risks[0].sourceRef?.tool).toBe("premortem");
  });

  it("prioritization.backlogItemId", async () => {
    const row: PrioritizationItem = {
      id: "p-1",
      framework: "rice",
      title: "Apple Pay",
      updatedAt: "2026-10-18",
      backlogItemId: "b-1",
    };
    useWorkspaceStore.setState({ prioritizations: [row] });
    await update("prioritization", "p-1", { score: 42 });
    expect(useWorkspaceStore.getState().prioritizations![0].backlogItemId).toBe("b-1");
  });

  it("standup_entry.sentTo", async () => {
    const entry: StandupEntry = {
      id: "s-1",
      member: "Lee",
      date: "2026-10-18",
      yesterday: "",
      today: "",
      blockers: "Waiting on DBA review",
      timestamp: 1,
      sentTo: [link],
    };
    useWorkspaceStore.setState({ standupEntries: [entry] });
    await update("standup_entry", "s-1", { blockerResolved: true });
    expect(useWorkspaceStore.getState().standupEntries![0].sentTo).toEqual([link]);
  });

  it("retro_board.previousRetroId and card links", async () => {
    const board = {
      id: "retro:current",
      format: { id: "ssc", name: "Start / Stop / Continue", columns: [] },
      phase: "actions",
      cards: [
        {
          id: "c-1",
          columnKey: "start",
          text: "Pair on CI",
          votes: 0,
          groupedWith: null,
          isActionItem: true,
          assignee: "Sam",
          discussing: false,
          sentTo: [link],
          carriedFrom: "old-1",
        },
      ],
      userVotes: 0,
      timerSeconds: 300,
      timerRunning: false,
      discussingIndex: 0,
      previousRetroId: "retro:2026-10-04T10:00:00.000Z",
    } as unknown as RetroBoard;
    useWorkspaceStore.setState({ retroBoards: [board] });
    await update("retro_board", "retro:current", { phase: "discuss" });
    const after = useWorkspaceStore.getState().retroBoards![0];
    expect(after.previousRetroId).toBe("retro:2026-10-04T10:00:00.000Z");
    expect(after.cards[0].sentTo).toEqual([link]);
    expect(after.cards[0].carriedFrom).toBe("old-1");
  });

  it("story_map card estimate and sentTo", async () => {
    const map: StoryMap = {
      id: "story-mapper:current",
      steps: [{ id: "st-1", name: "Browse" }],
      slices: [
        {
          id: "sl-1",
          name: "MVP",
          cards: {
            "st-1": [
              {
                id: "card-1",
                title: "Search",
                description: "",
                color: "blue",
                estimate: "5",
                sentTo: [{ ...link, route: "poker-queue" }],
              },
            ],
          },
        },
      ],
    } as StoryMap;
    useWorkspaceStore.setState({ storyMaps: [map] });
    await update("story_map", "story-mapper:current", { steps: map.steps });
    const card = useWorkspaceStore.getState().storyMaps![0].slices[0].cards["st-1"][0];
    expect(card.estimate).toBe("5");
    expect(card.sentTo?.[0].route).toBe("poker-queue");
  });

  it("capacity_plan member teamMemberId", async () => {
    const plan: CapacityPlan = {
      id: "capacity-planner:current",
      members: [
        {
          id: "m-1",
          name: "Mei",
          role: "Dev",
          availability: 100,
          daysOff: 0,
          teamMemberId: "tm-1",
        },
      ],
      config: {
        sprintDays: 10,
        ceremonyOverhead: 10,
        focusFactor: 80,
        hoursPerDay: 8,
        pointsCommitted: "",
      },
    };
    useWorkspaceStore.setState({ capacityPlans: [plan] });
    await update("capacity_plan", "capacity-planner:current", {
      config: { ...plan.config, sprintDays: 9 },
    });
    expect(useWorkspaceStore.getState().capacityPlans![0].members[0].teamMemberId).toBe("tm-1");
  });

  it("poker_estimation_log queue and estimate sourceRef", async () => {
    const log: PokerEstimationLog = {
      id: "pokerEstimationLog:current",
      estimates: [
        {
          id: "e-1",
          storyTitle: "Search",
          finalEstimate: "5",
          scaleType: "fibonacci",
          decidedAt: "2026-10-18",
          sourceRef: { tool: "story-mapper", id: "card-1" },
        },
      ],
      queue: [
        {
          id: "q-1",
          title: "Checkout",
          sourceRef: { tool: "story-mapper", id: "card-2" },
          queuedAt: "2026-10-18",
        },
      ],
    };
    useWorkspaceStore.setState({ pokerEstimationLogs: [log] });
    await update("poker_estimation_log", "pokerEstimationLog:current", {
      estimates: log.estimates,
    });
    const after = useWorkspaceStore.getState().pokerEstimationLogs![0];
    expect(after.queue?.[0].sourceRef.id).toBe("card-2");
    expect(after.estimates[0].sourceRef?.tool).toBe("story-mapper");
  });
});

describe("removing a backlog item", () => {
  it("unlinks framework rows that scored it but keeps them", () => {
    useWorkspaceStore.setState({
      backlogItems: [{ id: "b-1" } as never, { id: "b-2" } as never],
      prioritizations: [
        { id: "p-1", framework: "rice", title: "A", updatedAt: "x", backlogItemId: "b-1" },
        { id: "p-2", framework: "wsjf", title: "B", updatedAt: "x", backlogItemId: "b-2" },
      ],
    });
    useWorkspaceStore.getState().removeBacklogItem("b-1");
    const s = useWorkspaceStore.getState();
    expect(s.backlogItems!.map((b) => b.id)).toEqual(["b-2"]);
    expect(s.prioritizations!.map((p) => [p.id, p.backlogItemId])).toEqual([
      ["p-1", undefined],
      ["p-2", "b-2"],
    ]);
  });
});
