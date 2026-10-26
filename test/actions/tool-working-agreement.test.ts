/**
 * tool.working_agreement.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; every write verb a write + mcpHandler.
 *   2. add_rule + list_state — byCategory tally + adoption counts; version 0;
 *      agreedBy recorded as consent; duplicates refused.
 *   3. update_rule / remove_rule.
 *   4. set_consent — the roster's spelling, one answer per person.
 *   5. record_check_in — dated, never in the future, the page's draft kept.
 *   6. publish — a snapshot, refused when nothing changed.
 *   7. the MCP path gives the page's numbers (lib/working-agreement/model).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WorkingAgreement } from "@/lib/stores/workspace-types";
import { todayIso } from "@/lib/sprints/series";
import { addDays } from "@/lib/flow/days";
import {
  WA_ID,
  WA_KIND,
  agreementVerdict,
  normalizeAgreement,
} from "@/lib/working-agreement/model";

import "@/lib/actions/tools/working-agreement";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const run = <T>(
  path: "handler" | "mcpHandler",
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.working_agreement.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx()) as Promise<T>;
};
const call = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("handler", verb, params);
const callMcp = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("mcpHandler", verb, params);

const doc = () =>
  normalizeAgreement(
    (useWorkspaceStore.getState().workingAgreements ?? []).find((d) => d.id === WA_ID)
  );

const VERBS = [
  "add_rule",
  "update_rule",
  "remove_rule",
  "set_consent",
  "record_check_in",
  "remove_check_in",
  "publish",
];

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({
    workingAgreements: [],
    teamMembers: [
      { id: "m1", name: "Alice" },
      { id: "m2", name: "Sam" },
    ],
    sprints: [],
  });
});

describe("tool.working_agreement — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.working_agreement.list_state")?.category).toBe("read");
    for (const verb of VERBS) {
      const a = registry.get(`tool.working_agreement.${verb}`);
      expect(a?.category, verb).toBe("write");
      expect(a?.mcpHandler, verb).toBeTypeOf("function");
      expect(a?.requiresConfirmation, verb).toBe(false);
    }
  });
});

describe("tool.working_agreement.add_rule + list_state", () => {
  it("appends rules and tallies by category", async () => {
    await call("add_rule", {
      category: "communication",
      text: "Reply within a day",
      agreedBy: ["alice"],
    });
    await call("add_rule", { category: "meetings", text: "No-meeting Wednesdays" });

    const r = await call<{
      total: number;
      byCategory: Record<string, number>;
      meta: { version: number };
      rules: { agreedBy: string[]; consent: { name: string; vote: string }[] }[];
    }>("list_state");
    expect(r.total).toBe(2);
    expect(r.byCategory.communication).toBe(1);
    expect(r.byCategory.meetings).toBe(1);
    // An agent-made agreement is unpublished, as the page's is.
    expect(r.meta.version).toBe(0);
    // agreedBy is recorded as consent, with the roster's spelling.
    expect(r.rules[0].agreedBy).toEqual(["Alice"]);
    expect(r.rules[0].consent.map((c) => [c.name, c.vote])).toEqual([["Alice", "consent"]]);
  });

  it("refuses a rule the charter already holds, and a blank one", async () => {
    const first = await call<{ id: string }>("add_rule", {
      category: "work",
      text: "Pair on bugs",
    });
    expect(await call("add_rule", { category: "work", text: " pair on bugs. " })).toEqual({
      added: false,
      reason: "duplicate",
      id: first.id,
    });
    expect(() =>
      registry
        .get("tool.working_agreement.add_rule")!
        .paramsSchema.parse({ category: "work", text: "  " })
    ).toThrow();
  });
});

describe("rules, consent, check-ins and publish", () => {
  it("rewords, recategorises and removes a rule", async () => {
    const { id } = await call<{ id: string }>("add_rule", {
      category: "work",
      text: "One",
      description: "why",
    });
    expect(
      await call("update_rule", {
        ruleId: id,
        text: "One, reworded",
        category: "meetings",
        description: "",
      })
    ).toEqual({ updated: true });
    expect(doc().rules[0]).toMatchObject({ text: "One, reworded", category: "meetings" });
    expect(doc().rules[0].description).toBeUndefined();
    expect(await call("update_rule", { ruleId: "nope", text: "x" })).toEqual({
      updated: false,
      reason: "not_found",
    });
    expect(await call("remove_rule", { ruleId: id })).toEqual({ removed: true });
    expect(await call("remove_rule", { ruleId: id })).toEqual({
      removed: false,
      reason: "not_found",
    });
  });

  it("records one answer per person with the roster's spelling", async () => {
    const { id } = await call<{ id: string }>("add_rule", {
      category: "meetings",
      text: "Cameras on",
    });
    await call("set_consent", { ruleId: id, name: "alice", vote: "consent" });
    const r = await call<{ consent: string; agreedBy: string[]; onRoster: boolean }>(
      "set_consent",
      {
        ruleId: id,
        name: "sam",
        vote: "object",
        note: "Shared room",
      }
    );
    expect(r).toMatchObject({
      consent: "1 of 2 consented · Sam objects",
      agreedBy: ["Alice"],
      onRoster: true,
    });
    await call("set_consent", { ruleId: id, name: "SAM", vote: "consent" });
    expect(doc().rules[0].consent?.map((c) => [c.name, c.vote])).toEqual([
      ["Alice", "consent"],
      ["Sam", "consent"],
    ]);
    await call("set_consent", { ruleId: id, name: "Sam", vote: null });
    expect(doc().rules[0].agreedBy).toEqual(["Alice"]);
  });

  it("saves a dated round, refuses the future and unknown rules, and keeps the page's other marks", async () => {
    const a = await call<{ id: string }>("add_rule", { category: "work", text: "A" });
    const b = await call<{ id: string }>("add_rule", { category: "work", text: "B" });
    // The page has B marked in the round in progress.
    const d = doc();
    useWorkspaceStore.getState().upsertWorkingAgreement({
      ...d,
      rules: d.rules.map((r) => (r.id === b.id ? { ...r, stillWorking: false } : r)),
    });
    const today = todayIso();
    expect(
      await call("record_check_in", {
        results: [{ ruleId: a.id, result: "working" }],
        date: addDays(today, 1),
      })
    ).toEqual({ recorded: false, reason: "future_date" });
    expect(
      await call("record_check_in", { results: [{ ruleId: "zzz", result: "working" }] })
    ).toEqual({
      recorded: false,
      reason: "unknown_rule",
      unknown: ["zzz"],
    });
    expect(
      await call("record_check_in", {
        results: [{ ruleId: a.id, result: "working" }],
        sprintId: "s-missing",
      })
    ).toEqual({ recorded: false, reason: "unknown_sprint" });

    const backdated = addDays(today, -10) as string;
    const saved = await call<{ recorded: boolean; id: string; pct: number }>("record_check_in", {
      results: [{ ruleId: a.id, result: "working" }],
      date: backdated,
    });
    expect(saved).toMatchObject({ recorded: true, checked: 1, working: 1, pct: 100 });
    expect(doc().checkIns?.[0]).toMatchObject({
      date: backdated,
      version: 0,
      results: { [a.id]: "working" },
    });
    // B's mark from the page is still the draft.
    expect(doc().rules.find((r) => r.id === b.id)?.stillWorking).toBe(false);

    expect(await call("remove_check_in", { id: saved.id })).toEqual({ removed: true });
    expect(doc().checkIns).toEqual([]);
  });

  it("publishes a snapshot, then refuses until something changes", async () => {
    expect(await call("publish")).toEqual({ published: false, reason: "no_rules" });
    const { id } = await call<{ id: string }>("add_rule", { category: "work", text: "One" });
    expect(await call("publish")).toMatchObject({ published: true, version: 1, changes: null });
    expect(await call("publish")).toEqual({
      published: false,
      reason: "nothing_changed",
      version: 1,
    });
    await call("update_rule", { ruleId: id, text: "One, again" });
    const second = await call<{ changes: { reworded: unknown[] } }>("publish");
    expect(second).toMatchObject({ published: true, version: 2 });
    expect(second.changes.reworded).toHaveLength(1);
    const listed = await call<{ versions: { version: number }[]; unpublishedChanges: boolean }>(
      "list_state"
    );
    expect(listed.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(listed.unpublishedChanges).toBe(false);
  });
});

describe("the MCP path", () => {
  it("writes the same document and reads the page's numbers", async () => {
    rows.set("workspace:teamMember/m1", { id: "m1", name: "Alice" });
    rows.set("workspace:teamMember/m2", { id: "m2", name: "Sam" });
    const { id } = await callMcp<{ id: string }>("add_rule", {
      category: "work",
      text: "Pair on bugs",
      agreedBy: ["ALICE"],
    });
    await callMcp("set_consent", { ruleId: id, name: "sam", vote: "concern", note: "Fridays" });
    await callMcp("record_check_in", { results: [{ ruleId: id, result: "not_working" }] });
    await callMcp("publish");
    const stored = rows.get(`${WA_KIND}/${WA_ID}`) as WorkingAgreement;
    expect(stored.meta.version).toBe(1);
    const listed = await callMcp<{
      verdict: string;
      lastCheckIn: { checked: number; working: number };
      consent: { fullyConsented: number };
    }>("list_state");
    const roster = [
      { id: "m1", name: "Alice" },
      { id: "m2", name: "Sam" },
    ];
    expect(listed.verdict).toBe(agreementVerdict(normalizeAgreement(stored), roster));
    expect(listed.lastCheckIn).toMatchObject({ checked: 1, working: 0 });
    expect(listed.consent.fullyConsented).toBe(1);
    // The browser store saw none of it.
    expect(useWorkspaceStore.getState().workingAgreements).toEqual([]);
  });
});
