/**
 * The decision record's agent surface over MCP (Phase 7): tool.decision_log,
 * tool.daci and tool.rapid_decision read the same merged records on the
 * server as the page does in the browser (stored records, old DACI / RAPID
 * rows read through, the old Decision Log blob's rows not moved yet), and
 * write a Decision under the record's id, leaving the old rows alone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DACIDecision, Decision, RAPIDDecision } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
const blobs = vi.hoisted(() => new Map<string, unknown>());
const deleted = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
    serverDeleteEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      deleted.push(`${kind}/${id}`);
      rows.delete(`${kind}/${id}`);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import {
  DECISION_LOG_KEY,
  DECISION_LOG_MOVED_KEY,
  withPendingDecisionLog,
} from "@/lib/decisions/legacy-log";
import { allDecisions, decisionVerdict } from "@/lib/decisions/model";
import { todayLocalISO } from "@/lib/utils/formatters";
import { planDecisionMove } from "@/app/(tools)/decision-log/use-legacy-decisions";
import "@/lib/actions/tools/decision-log";
import "@/lib/actions/tools/daci";
import "@/lib/actions/tools/rapid-decision";

const ctx = { userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] };
const mcp = <T>(id: string, params: Record<string, unknown> = {}, extra = {}) => {
  const action = registry.get(id)!;
  return action.mcpHandler!(action.paramsSchema.parse(params), { ...ctx, ...extra }) as Promise<T>;
};
const put = (kind: string, row: { id: string }) => rows.set(`workspace:${kind}/${row.id}`, row);
const get = <T>(kind: string, id: string) => rows.get(`workspace:${kind}/${id}`) as T | undefined;

const adr: Decision = {
  id: "a",
  title: "Use Postgres",
  decision: "",
  status: "proposed",
  date: "2026-09-01",
  number: 3,
};
const daci: DACIDecision = {
  id: "daci-1",
  title: "Pick a vendor",
  approver: "Ben",
  driver: "Ana",
  contributors: [],
  informed: [],
  status: "open",
  date: "2026-09-20T09:00:00.000Z",
};
const rapid: RAPIDDecision = {
  id: "rapid-1",
  title: "Weekly releases",
  decide: "Morgan",
  status: "decided",
  date: "2026-09-25T09:00:00.000Z",
};

beforeEach(() => {
  rows.clear();
  blobs.clear();
  deleted.length = 0;
  put("decision", adr);
  put("daciDecision", daci);
  put("rapidDecision", rapid);
  put("teamMember", { id: "m1", name: "Ana" } as { id: string });
  blobs.set(DECISION_LOG_KEY, [
    {
      id: "blob-1",
      title: "From the old page",
      status: "accepted",
      decision: "Go",
      date: "2026-08-01",
    },
    { id: "moved-1", title: "Already moved", date: "2026-08-02" },
  ]);
  blobs.set(DECISION_LOG_MOVED_KEY, ["moved-1"]);
});

describe("tool.decision_log over MCP", () => {
  it("lists what the page lists, the old blob's pending rows included", async () => {
    const state = await mcp<{
      total: number;
      pending: number;
      verdict: string;
      items: { id: string; template: string; pending: boolean }[];
    }>("tool.decision_log.list_state");
    expect(state.items.map((i) => [i.id, i.template, i.pending])).toEqual([
      ["a", "adr", false],
      ["daci-1", "daci", false],
      ["rapid-1", "rapid", false],
      ["blob-1", "adr", true],
    ]);
    expect(state.pending).toBe(1);
    const expected = withPendingDecisionLog(
      allDecisions([adr], [daci], [rapid]),
      blobs.get(DECISION_LOG_KEY),
      ["moved-1"]
    );
    expect(state.verdict).toBe(decisionVerdict(expected, todayLocalISO()));
    const daciOnly = await mcp<{ total: number }>("tool.decision_log.list_state", {
      template: "daci",
    });
    expect(daciOnly.total).toBe(1);
  });

  it("numbers a new record after every form's highest number", async () => {
    put("decision", { ...adr, id: "b", number: 8, template: "rapid" } as Decision);
    const out = await mcp<{ created: boolean; number: number; label: string; id: string }>(
      "tool.decision_log.add_decision",
      { title: "New", template: "adr", decider: "ana" }
    );
    expect(out).toMatchObject({ created: true, number: 9, label: "ADR-0009" });
    expect(get<Decision>("decision", out.id)).toMatchObject({ decider: "Ana", status: "proposed" });
    const future = await mcp<{ created: boolean; reason: string }>(
      "tool.decision_log.add_decision",
      {
        title: "Later",
        date: "2999-01-01",
      }
    );
    expect(future).toEqual({ created: false, reason: "future_day" });
  });

  it("set_status on an old Decision Log row not moved in yet keeps the agent's status", async () => {
    // Deprecated on the old page; deprecated ↔ superseded is a tie the blob would win.
    blobs.set(DECISION_LOG_KEY, [
      { id: "blob-1", title: "From the old page", status: "deprecated", date: "2026-08-01" },
      { id: "blob-2", title: "Also old", status: "deprecated", date: "2026-08-02" },
    ]);
    blobs.set(DECISION_LOG_MOVED_KEY, []);
    const set = (id: string, status: string) =>
      mcp<{ updated: boolean }>("tool.decision_log.set_status", { id, status });
    expect(await set("blob-1", "accepted")).toEqual({ updated: true });
    expect(await set("blob-2", "superseded")).toEqual({ updated: true });
    const state = await mcp<{ items: { id: string; status: string; pending: boolean }[] }>(
      "tool.decision_log.list_state"
    );
    const statusOf = (id: string) => state.items.find((i) => i.id === id)?.status;
    expect(statusOf("blob-1")).toBe("accepted");
    expect(statusOf("blob-2")).toBe("superseded");
    // The page's one-time move keeps them too.
    const stored = Array.from(rows.entries())
      .filter(([k]) => k.startsWith("workspace:decision/"))
      .map(([, v]) => v as Decision);
    const plan = planDecisionMove(stored, [daci], [rapid], blobs.get(DECISION_LOG_KEY), []);
    const written = (id: string) =>
      plan.writes.find((d) => d.id === id) ?? stored.find((d) => d.id === id);
    expect(written("blob-1")?.status).toBe("accepted");
    expect(written("blob-2")?.status).toBe("superseded");
  });

  it("set_status confirms a terminal status on the server path too", async () => {
    const confirm = vi.fn(async () => false);
    const out = await mcp<{ updated: boolean; confirmed?: boolean }>(
      "tool.decision_log.set_status",
      { id: "a", status: "deprecated" },
      { confirm }
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ updated: false, confirmed: false });
    expect(get<Decision>("decision", "a")?.status).toBe("proposed");
  });
});

describe("the DACI and RAPID aliases over MCP", () => {
  it("DACI's set_status writes a Decision under the same id and leaves the old row", async () => {
    const out = await mcp<{ updated: boolean }>("tool.daci.set_status", {
      id: "daci-1",
      status: "decided",
    });
    expect(out.updated).toBe(true);
    expect(get<Decision>("decision", "daci-1")).toMatchObject({
      template: "daci",
      status: "accepted",
      decider: "Ben",
      roles: { driver: ["Ana"] },
      date: "2026-09-20",
    });
    expect(get<DACIDecision>("daciDecision", "daci-1")).toEqual(daci);
    const list = await mcp<{ items: { id: string; status: string; approver?: string }[] }>(
      "tool.daci.list_state"
    );
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: "daci-1", status: "decided", approver: "Ben" });
  });

  it("RAPID's implemented confirms on both paths, and refuses another form's record", async () => {
    const confirm = vi.fn(async () => false);
    const declined = await mcp<{ updated: boolean; reason: string }>(
      "tool.rapid_decision.set_status",
      { id: "rapid-1", status: "implemented" },
      { confirm }
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(declined).toEqual({ updated: false, reason: "declined" });
    const ok = await mcp<{ updated: boolean }>("tool.rapid_decision.set_status", {
      id: "rapid-1",
      status: "implemented",
    });
    expect(ok.updated).toBe(true);
    expect(get<Decision>("decision", "rapid-1")?.implementedAt).toBe(todayLocalISO());
    const other = await mcp<{ updated: boolean; reason: string }>(
      "tool.rapid_decision.set_status",
      {
        id: "a",
        status: "decided",
      }
    );
    expect(other).toEqual({ updated: false, reason: "not-rapid" });
  });

  it("RAPID's set_recommend names the R in the roster's spelling", async () => {
    await mcp("tool.rapid_decision.set_recommend", { id: "rapid-1", recommendation: "ana" });
    expect(get<Decision>("decision", "rapid-1")?.roles?.recommend).toEqual(["Ana"]);
  });
});

describe("the user's day over MCP (the server's day can be a day behind it)", () => {
  // The server's day; a user ahead of UTC is already on the next one.
  const SERVER_DAY = "2026-10-27";
  const USER_DAY = "2026-10-28";
  const run = <T>(id: string, params: Record<string, unknown> = {}) => {
    const action = registry.get(id)!;
    return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0));
    // Raised on the page on the user's today.
    const fresh: Decision = { ...adr, id: "fresh", number: 9, date: USER_DAY };
    const freshDaci: Decision = {
      ...adr,
      id: "fresh-daci",
      number: 10,
      template: "daci",
      decider: "Ben",
      date: USER_DAY,
    };
    put("decision", fresh);
    put("decision", freshDaci);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("decide takes the user's today, and defaults to it when the record was raised on it", async () => {
    const out = await mcp<{ decided: boolean; decidedAt: string }>("tool.decision_log.decide", {
      id: "fresh",
      outcome: "Go",
    });
    expect(out).toMatchObject({ decided: true, decidedAt: USER_DAY });
    await mcp("tool.decision_log.reopen", { id: "fresh", date: USER_DAY });
    expect(get<Decision>("decision", "fresh")).toMatchObject({
      status: "proposed",
      reopenedAt: USER_DAY,
    });
    expect(
      await mcp("tool.decision_log.decide", { id: "fresh", outcome: "Go", date: USER_DAY })
    ).toMatchObject({ decided: true, decidedAt: USER_DAY });
    // Two days ahead is no one's today.
    expect(
      await mcp("tool.decision_log.decide", { id: "a", outcome: "Go", date: "2026-10-29" })
    ).toEqual({ decided: false, reason: "future_day" });
  });

  it("the status verbs never stamp a day before the record was raised", async () => {
    await mcp("tool.decision_log.set_status", { id: "fresh-daci", status: "accepted" });
    expect(get<Decision>("decision", "fresh-daci")?.decidedAt).toBe(USER_DAY);
    await mcp("tool.daci.set_status", { id: "fresh-daci", status: "revisit" });
    expect(get<Decision>("decision", "fresh-daci")?.reopenedAt).toBe(USER_DAY);
    await mcp("tool.daci.set_status", { id: "fresh-daci", status: "decided" });
    expect(get<Decision>("decision", "fresh-daci")?.decidedAt).toBe(USER_DAY);
    // A record raised before the server's day is stamped with it, as before.
    const older: Decision = {
      ...adr,
      id: "older",
      template: "rapid",
      decider: "Morgan",
      number: 11,
    };
    put("decision", older);
    await mcp("tool.rapid_decision.set_status", { id: "older", status: "decided" });
    expect(get<Decision>("decision", "older")?.decidedAt).toBe(SERVER_DAY);
  });

  it("add_decision takes the user's today over MCP, and only today in the browser", async () => {
    expect(
      await mcp("tool.decision_log.add_decision", { title: "Ahead", date: USER_DAY })
    ).toMatchObject({ created: true });
    expect(
      await mcp("tool.decision_log.add_decision", { title: "Later", date: "2026-10-29" })
    ).toEqual({ created: false, reason: "future_day" });
    // The browser's day is the user's own: tomorrow is in the future there.
    expect(await run("tool.decision_log.add_decision", { title: "Ahead", date: USER_DAY })).toEqual(
      { created: false, reason: "future_day" }
    );
  });
});

describe("tool.decision_log.delete over MCP", () => {
  it("tombstones the id in every collection that holds it, so no old row reads back in", async () => {
    // A record saved under an old DACI row's id: both go.
    const shadow: Decision = { ...adr, id: "daci-1", template: "daci", number: 4 };
    put("decision", shadow);
    const out = await mcp<{ deleted: boolean; label: string }>("tool.decision_log.delete", {
      id: "daci-1",
    });
    expect(out).toEqual({ deleted: true, id: "daci-1", label: "DACI-0004" });
    expect(deleted.sort()).toEqual(["workspace:daciDecision/daci-1", "workspace:decision/daci-1"]);
    const state = await mcp<{ items: { id: string }[] }>("tool.decision_log.list_state");
    expect(state.items.map((i) => i.id)).not.toContain("daci-1");
    // A read-through RAPID row has no workspace row: only its own collection.
    deleted.length = 0;
    await mcp("tool.decision_log.delete", { id: "rapid-1" });
    expect(deleted).toEqual(["workspace:rapidDecision/rapid-1"]);
  });

  it("refuses an old Decision Log row not moved in yet, and an unknown id", async () => {
    expect(await mcp("tool.decision_log.delete", { id: "blob-1" })).toMatchObject({
      deleted: false,
      reason: "pending_move",
    });
    expect(await mcp("tool.decision_log.delete", { id: "ghost" })).toEqual({
      deleted: false,
      reason: "not_found",
    });
    expect(deleted).toEqual([]);
  });

  it("refuses to accept a DACI proposal with no Approver, as the page does", async () => {
    const proposal: Decision = { ...adr, id: "daci-2", template: "daci", number: 5 };
    put("decision", proposal);
    expect(
      await mcp("tool.decision_log.set_status", { id: "daci-2", status: "accepted" })
    ).toMatchObject({ updated: false, reason: "no_decider" });
    expect(get<Decision>("decision", "daci-2")?.status).toBe("proposed");
  });
});
