/**
 * tool.post_mortem.* coverage (singleton doc, S8).
 *
 *   1. registration — list_state read; add/status/factor/action/timeline/remove.
 *   2. add_postmortem — draft; factor/timeline/action tallies.
 *   3. add_action + update_action — open→done flips openActions; overdue count.
 *   4. set_status — publish stamps publishedAt; remove_postmortem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("tool.post_mortem — dates and blanks", () => {
  beforeEach(() => useWorkspaceStore.setState({ postMortemLogs: [] }));
  afterEach(() => vi.useRealTimers());

  /** A moment whose UTC calendar day differs from the local one (when the zone allows). */
  function nearLocalMidnight() {
    const east = new Date(2026, 9, 19, 0, 30).getTimezoneOffset() < 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(east ? new Date(2026, 9, 19, 0, 30) : new Date(2026, 9, 19, 23, 30));
  }

  // Bug: "today" was the UTC day (toISOString), while the post-mortem UI
  // uses the local calendar day for the default incident date and overdue.
  it("defaults the incident date to the local calendar day", async () => {
    nearLocalMidnight();
    await call("add_postmortem", { title: "Cache stampede" });
    expect(useWorkspaceStore.getState().postMortemLogs?.[0].postmortems[0].incidentDate).toBe(
      "2026-10-19"
    );
  });

  it("counts an action due yesterday (local) as overdue, and one due today as not", async () => {
    nearLocalMidnight();
    const { id } = (await call("add_postmortem", { title: "Cache stampede" })) as { id: string };
    await call("add_action", { postmortemId: id, text: "Yesterday", dueDate: "2026-10-18" });
    await call("add_action", { postmortemId: id, text: "Today", dueDate: "2026-10-19" });
    expect((await list()).overdueActions).toBe(1);
  });

  it("keeps the first publishedAt when a post-mortem is re-published", async () => {
    const { id } = (await call("add_postmortem", { title: "Cache stampede" })) as { id: string };
    await call("set_status", { postmortemId: id, status: "published" });
    const first = (await list()).postmortems[0].publishedAt;
    await call("set_status", { postmortemId: id, status: "review" });
    await call("set_status", { postmortemId: id, status: "published" });
    expect((await list()).postmortems[0].publishedAt).toBe(first);
  });

  // Bug: whitespace-only text passed `min(1)` and was stored as an empty
  // factor / action / timeline entry; the UI refuses blank ones.
  it("refuses whitespace-only factors, actions and timeline entries", async () => {
    const { id } = (await call("add_postmortem", { title: "Cache stampede" })) as { id: string };
    const f = (await call("add_factor", { postmortemId: id, text: "  " })) as { added: boolean };
    const a = (await call("add_action", { postmortemId: id, text: "  " })) as { added: boolean };
    const t = (await call("add_timeline_entry", { postmortemId: id, text: "  " })) as {
      added: boolean;
    };
    expect([f.added, a.added, t.added]).toEqual([false, false, false]);
    const r = await list();
    expect(r.postmortems[0]).toMatchObject({ factorCount: 0, actionCount: 0, timelineCount: 0 });
  });
});

describe("tool.post_mortem.add_postmortem — blank title", () => {
  beforeEach(() => useWorkspaceStore.setState({ postMortemLogs: [] }));

  // Bug: a whitespace-only title passed `min(1)` and created a blank
  // post-mortem; the UI trims and refuses a blank title.
  it("refuses a whitespace-only title and trims a real one", async () => {
    const blank = (await call("add_postmortem", { title: "   " })) as { added: boolean };
    expect(blank.added).toBe(false);
    await call("add_postmortem", { title: "  Cache stampede  " });
    expect(useWorkspaceStore.getState().postMortemLogs![0].postmortems.map((p) => p.title)).toEqual(
      ["Cache stampede"]
    );
  });
});
