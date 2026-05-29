/**
 * tool.post_mortem.* coverage (singleton doc, S8).
 *
 *   1. registration — list_state read; add/status/factor/action/timeline/remove.
 *   2. add_postmortem — draft; factor/timeline/action tallies.
 *   3. add_action + update_action — open→done flips openActions; overdue count.
 *   4. set_status — publish stamps publishedAt; remove_postmortem.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/post-mortem";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const call = (verb: string, params: Record<string, unknown>) =>
  registry.get(`tool.post_mortem.${verb}`)!.handler(params, ctx());
const list = () =>
  call("list_state", {}) as Promise<{
    exists: boolean;
    total: number;
    byStatus: Record<string, number>;
    openActions: number;
    overdueActions: number;
    postmortems: {
      id: string;
      status: string;
      factorCount: number;
      timelineCount: number;
      actionCount: number;
      openActionCount: number;
      publishedAt?: string;
    }[];
  }>;

describe("tool.post_mortem — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.post_mortem.list_state")?.category).toBe("read");
    for (const verb of [
      "add_postmortem",
      "set_status",
      "add_factor",
      "add_action",
      "update_action",
      "add_timeline_entry",
      "remove_postmortem",
    ]) {
      expect(registry.get(`tool.post_mortem.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.post_mortem.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.post_mortem.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.post_mortem — lifecycle", () => {
  beforeEach(() => useWorkspaceStore.setState({ postMortemLogs: [] }));

  it("adds, tallies factors/actions/timeline, flips action status, publishes", async () => {
    const a = (await call("add_postmortem", {
      title: "Cache stampede",
      incidentDate: "2026-05-20",
    })) as { added: boolean; id: string };
    expect(a.added).toBe(true);

    let r = await list();
    expect(r.exists).toBe(true);
    expect(r.total).toBe(1);
    expect(r.byStatus.draft).toBe(1);

    // contributing factor
    const f = (await call("add_factor", { postmortemId: a.id, text: "No backpressure" })) as {
      added: boolean;
    };
    expect(f.added).toBe(true);
    const fBad = (await call("add_factor", { postmortemId: "nope", text: "x" })) as {
      added: boolean;
    };
    expect(fBad.added).toBe(false);

    // timeline
    await call("add_timeline_entry", { postmortemId: a.id, text: "Detected at 02:00" });

    // actions: one normal (open) and one overdue
    const act = (await call("add_action", {
      postmortemId: a.id,
      text: "Add rate limit",
      owner: "Ada",
    })) as { added: boolean; id: string };
    expect(act.added).toBe(true);
    await call("add_action", {
      postmortemId: a.id,
      text: "Backfill alerts",
      dueDate: "2000-01-01",
    });

    r = await list();
    expect(r.postmortems[0].factorCount).toBe(1);
    expect(r.postmortems[0].timelineCount).toBe(1);
    expect(r.postmortems[0].actionCount).toBe(2);
    expect(r.openActions).toBe(2);
    expect(r.overdueActions).toBe(1); // the 2000-01-01 one, still open

    // close the first action
    const up = (await call("update_action", {
      postmortemId: a.id,
      actionId: act.id,
      status: "done",
    })) as { updated: boolean };
    expect(up.updated).toBe(true);
    const upBad = (await call("update_action", {
      postmortemId: a.id,
      actionId: "nope",
      status: "done",
    })) as { updated: boolean };
    expect(upBad.updated).toBe(false);
    r = await list();
    expect(r.openActions).toBe(1);

    // publish stamps publishedAt
    const pub = (await call("set_status", { postmortemId: a.id, status: "published" })) as {
      updated: boolean;
    };
    expect(pub.updated).toBe(true);
    r = await list();
    expect(r.byStatus.published).toBe(1);
    expect(r.postmortems[0].publishedAt).toBeTruthy();

    const stBad = (await call("set_status", { postmortemId: "nope", status: "review" })) as {
      updated: boolean;
    };
    expect(stBad.updated).toBe(false);

    // remove
    const rm = (await call("remove_postmortem", { postmortemId: a.id })) as { removed: boolean };
    expect(rm.removed).toBe(true);
    r = await list();
    expect(r.total).toBe(0);
  });
});
