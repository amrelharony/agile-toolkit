/**
 * tool.planning_poker.* server-side ROUND coverage.
 *
 * The live realtime session stays browser-only, but an agent can now drive a
 * COMPLETE estimation round against a synced PokerRound singleton:
 *   start_round → cast_vote* → reveal → commit_round (→ appends to the log).
 * Votes are hidden until reveal (blind estimation), mirroring the human UI.
 *
 *   1. registration — get_round read; start/cast/reveal/commit/cancel write+hardened.
 *   2. happy path — start → 3 votes (hidden) → reveal (shown + consensus) →
 *      commit (appends a PokerEstimate, clears the round).
 *   3. cast_vote refuses with no active round, and after reveal.
 *   4. start_round refuses clobbering an active round without force.
 *   5. cancel_round clears an active round.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/planning-poker";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const call = <T>(id: string, params: unknown): Promise<T> =>
  registry.get(`tool.planning_poker.${id}`)!.handler(params, ctx()) as Promise<T>;

beforeEach(() => useWorkspaceStore.setState({ pokerRounds: [], pokerEstimationLogs: [] }));

describe("tool.planning_poker round — registration", () => {
  it("get_round is read; start/cast/reveal/commit/cancel are hardened writes", () => {
    expect(registry.get("tool.planning_poker.get_round")?.category).toBe("read");
    for (const verb of ["start_round", "cast_vote", "reveal", "commit_round", "cancel_round"]) {
      const a = registry.get(`tool.planning_poker.${verb}`);
      expect(a?.category).toBe("write");
      expect(a?.mcpHandler).toBeTypeOf("function");
      expect(a?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.planning_poker round — happy path", () => {
  it("runs start → vote → reveal → commit end to end", async () => {
    const started = await call<{ started: boolean; storyTitle: string }>("start_round", {
      storyTitle: "Login flow",
      scaleType: "fibonacci",
    });
    expect(started.started).toBe(true);

    await call("cast_vote", { participant: "Ana", card: "3" });
    await call("cast_vote", { participant: "Ben", card: "5" });
    await call("cast_vote", { participant: "Cy", card: "5" });

    // Pre-reveal: cards hidden, only participants + count exposed.
    const hidden = await call<{
      active: boolean;
      revealed: boolean;
      voteCount: number;
      participants: string[];
      votes: unknown;
      consensus: unknown;
    }>("get_round", {});
    expect(hidden.active).toBe(true);
    expect(hidden.revealed).toBe(false);
    expect(hidden.voteCount).toBe(3);
    expect(hidden.participants.sort()).toEqual(["Ana", "Ben", "Cy"]);
    expect(hidden.votes).toBeNull();
    expect(hidden.consensus).toBeNull();

    // Reveal exposes votes + consensus.
    const revealed = await call<{
      revealed: boolean;
      votes: { participant: string; card: string }[];
      consensus: { mode: string; suggestion: string };
    }>("reveal", {});
    expect(revealed.revealed).toBe(true);
    expect(revealed.votes).toHaveLength(3);
    expect(revealed.consensus.suggestion).toBe("5"); // mode of 3,5,5

    // Commit defaults the final estimate to the consensus suggestion, appends
    // to the log, and clears the active round.
    const committed = await call<{ committed: boolean; finalEstimate: string; estimateId: string }>(
      "commit_round",
      {}
    );
    expect(committed.committed).toBe(true);
    expect(committed.finalEstimate).toBe("5");

    const log = await call<{ totalEstimates: number; estimates: { storyTitle: string }[] }>(
      "list_state",
      {}
    );
    expect(log.totalEstimates).toBe(1);
    expect(log.estimates[0].storyTitle).toBe("Login flow");

    const after = await call<{ active: boolean }>("get_round", {});
    expect(after.active).toBe(false);
  });

  it("commit honours an explicit finalEstimate over consensus", async () => {
    await call("start_round", { storyTitle: "Cache layer", scaleType: "fibonacci" });
    await call("cast_vote", { participant: "Ana", card: "8" });
    await call("reveal", {});
    const c = await call<{ committed: boolean; finalEstimate: string }>("commit_round", {
      finalEstimate: "13",
    });
    expect(c.finalEstimate).toBe("13");
  });
});

describe("tool.planning_poker round — guards", () => {
  it("cast_vote refuses when no round is active", async () => {
    const r = await call<{ voted: boolean; reason?: string }>("cast_vote", {
      participant: "Ana",
      card: "5",
    });
    expect(r.voted).toBe(false);
    expect(r.reason).toBe("no_active_round");
  });

  it("cast_vote refuses after reveal", async () => {
    await call("start_round", { storyTitle: "X", scaleType: "fibonacci" });
    await call("cast_vote", { participant: "Ana", card: "5" });
    await call("reveal", {});
    const r = await call<{ voted: boolean; reason?: string }>("cast_vote", {
      participant: "Ben",
      card: "3",
    });
    expect(r.voted).toBe(false);
    expect(r.reason).toBe("revealed");
  });

  it("re-voting before reveal replaces the participant's card (no dup)", async () => {
    await call("start_round", { storyTitle: "X", scaleType: "fibonacci" });
    await call("cast_vote", { participant: "Ana", card: "3" });
    await call("cast_vote", { participant: "Ana", card: "8" });
    const revealed = await call<{ votes: { participant: string; card: string }[] }>("reveal", {});
    expect(revealed.votes).toEqual([{ participant: "Ana", card: "8" }]);
  });

  it("start_round refuses clobbering an active round without force", async () => {
    await call("start_round", { storyTitle: "First", scaleType: "fibonacci" });
    const blocked = await call<{ started: boolean; reason?: string }>("start_round", {
      storyTitle: "Second",
    });
    expect(blocked.started).toBe(false);
    expect(blocked.reason).toBe("active_round_exists");

    const forced = await call<{ started: boolean }>("start_round", {
      storyTitle: "Second",
      force: true,
    });
    expect(forced.started).toBe(true);
    const cur = await call<{ storyTitle: string }>("get_round", {});
    expect(cur.storyTitle).toBe("Second");
  });

  it("cancel_round clears an active round; false when none active", async () => {
    expect((await call<{ cancelled: boolean }>("cancel_round", {})).cancelled).toBe(false);
    await call("start_round", { storyTitle: "X", scaleType: "fibonacci" });
    expect((await call<{ cancelled: boolean }>("cancel_round", {})).cancelled).toBe(true);
    expect((await call<{ active: boolean }>("get_round", {})).active).toBe(false);
  });
});
