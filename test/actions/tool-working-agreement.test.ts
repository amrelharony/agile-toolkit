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

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
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

  it("reads a charter published before versions were kept as needing a snapshot, not as changed", async () => {
    useWorkspaceStore.setState({
      workingAgreements: [
        {
          id: WA_ID,
          rules: [{ id: "r1", category: "work", text: "One", agreedBy: [] }],
          meta: { version: 3, publishedAt: "2026-09-12T10:00:00.000Z" },
        },
      ],
    });
    const listed = await call<{
      unpublishedChanges: boolean;
      needsSnapshot: boolean;
      verdict: string;
    }>("list_state");
    expect(listed).toMatchObject({ unpublishedChanges: false, needsSnapshot: true });
    expect(listed.verdict).toContain("before versions were kept: publish once to keep a snapshot");
    expect(await call("publish")).toMatchObject({ published: true, version: 4, changes: null });
    expect(await call("list_state")).toMatchObject({ needsSnapshot: false });
  });

  it("reads an agreement the old agent made at version 1 as never published", async () => {
    useWorkspaceStore.setState({
      workingAgreements: [
        {
          id: WA_ID,
          rules: [{ id: "r1", category: "work", text: "One", agreedBy: [] }],
          meta: { version: 1 },
        },
      ],
    });
    expect(await call("list_state")).toMatchObject({ meta: { version: 0 }, needsSnapshot: false });
    expect(await call("publish")).toMatchObject({ published: true, version: 1 });
  });
});

describe("charter templates", () => {
  const LADDER = {
    levels: [
      {
        label: "Emergency",
        when: "Prod is down",
        channel: "Page the on-call",
        replyWithin: "15 minutes",
      },
      { label: "Normal", when: "Questions", channel: "Team thread", replyWithin: "1 working day" },
    ],
    afterHours: true,
  };

  it("registers list_templates as a read and apply_template as a write on both paths", () => {
    expect(registry.get("tool.working_agreement.list_templates")?.category).toBe("read");
    const apply = registry.get("tool.working_agreement.apply_template");
    expect(apply?.category).toBe("write");
    expect(apply?.mcpHandler).toBeTypeOf("function");
    expect(apply?.requiresConfirmation).toBe(false);
  });

  it("converts apply_template's params to a JSON Schema object (not a union)", () => {
    const json = zodToJsonSchema(
      registry.get("tool.working_agreement.apply_template")!.paramsSchema
    ) as { type?: string; properties?: Record<string, unknown> };
    expect(json.type).toBe("object");
    expect(Object.keys(json.properties ?? {}).sort()).toEqual([
      "aiUse",
      "coreHours",
      "focusTime",
      "template",
      "urgencyLadder",
    ]);
  });

  it("refuses a template without its answers, and answers past the caps", () => {
    const schema = registry.get("tool.working_agreement.apply_template")!.paramsSchema;
    expect(schema.safeParse({ template: "urgency-ladder" }).success).toBe(false);
    expect(schema.safeParse({ template: "core-hours", urgencyLadder: LADDER }).success).toBe(false);
    expect(schema.safeParse({ template: "urgency-ladder", urgencyLadder: LADDER }).success).toBe(
      true
    );
    expect(
      schema.safeParse({
        template: "urgency-ladder",
        urgencyLadder: { levels: [LADDER.levels[0]] },
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        template: "ai-use",
        aiUse: { review: "as-any-work", tools: ["a", "b", "c", "d", "e", "f"] },
      }).success
    ).toBe(false);
  });

  it("applies a template, lists it, and applying again updates in place", async () => {
    const first = await call<{ applied: boolean; added: string[]; ruleIds: string[] }>(
      "apply_template",
      { template: "urgency-ladder", urgencyLadder: LADDER }
    );
    expect(first.applied).toBe(true);
    expect(first.added).toHaveLength(2);
    expect(doc().rules.map((r) => r.template?.slot)).toEqual(["ladder", "after-hours"]);
    const listed = await call<{ templates: { id: string; applied: boolean; ruleIds: string[] }[] }>(
      "list_templates"
    );
    expect(listed.templates.map((t) => [t.id, t.applied, t.ruleIds.length])).toEqual([
      ["urgency-ladder", true, 2],
      ["core-hours", false, 0],
      ["focus-time", false, 0],
      ["ai-use", false, 0],
    ]);
    const again = await call<{ updated: string[]; removed: string[] }>("apply_template", {
      template: "urgency-ladder",
      urgencyLadder: { ...LADDER, afterHours: false },
    });
    expect(again.removed).toEqual([first.ruleIds[1]]);
    expect(again.updated).toEqual([]);
  });

  it("skips a line already in the charter and reports invalid answers", async () => {
    await call("add_rule", {
      category: "work",
      text: "A person reads anything customer-facing before it goes out",
    });
    const r = await call<{ skipped: { slot: string; reason: string }[] }>("apply_template", {
      template: "ai-use",
      aiUse: { review: "closer-look", customerFacing: true, neverIn: ["secrets"] },
    });
    expect(r.skipped.map((s) => [s.slot, s.reason])).toEqual([["customer-facing", "duplicate"]]);
    expect(
      await call("apply_template", {
        template: "core-hours",
        coreHours: {
          start: "13:00",
          end: "15:00",
          timeZone: "Mars/Base",
          days: [1],
          purposes: ["meetings"],
        },
      })
    ).toMatchObject({
      applied: false,
      reason: "invalid",
      errors: { timeZone: expect.any(String) },
    });
    expect(
      await call("apply_template", {
        template: "ai-use",
        aiUse: { review: "as-any-work", neverIn: [] },
      })
    ).toMatchObject({ applied: false, reason: "invalid" });
  });

  it("keeps the charter's answer for anything left out, and takes the page's defaults first", async () => {
    // A first apply with only the review level: the page's defaults fill the rest.
    const first = await call<{ applied: boolean }>("apply_template", {
      template: "ai-use",
      aiUse: { review: "as-any-work" },
    });
    expect(first.applied).toBe(true);
    expect(doc().rules.map((r) => r.template?.slot)).toEqual([
      "never-in",
      "review",
      "customer-facing",
    ]);
    // Changing only the review keeps the customer-facing rule.
    const again = await call<{ removed: string[] }>("apply_template", {
      template: "ai-use",
      aiUse: { review: "closer-look", neverIn: ["secrets"] },
    });
    expect(again.removed).toEqual([]);
    expect(doc().templates?.aiUse).toMatchObject({
      review: "closer-look",
      neverIn: ["secrets"],
      customerFacing: true,
    });
    // Said out loud, it goes.
    const off = await call<{ removed: string[] }>("apply_template", {
      template: "ai-use",
      aiUse: { review: "closer-look", customerFacing: false },
    });
    expect(off.removed).toHaveLength(1);
    expect(doc().rules.map((r) => r.template?.slot)).toEqual(["never-in", "review"]);

    // The ladder keeps its after-hours line, core hours their zone and office days.
    await call("apply_template", { template: "urgency-ladder", urgencyLadder: LADDER });
    const levelsOnly = await call<{ removed: string[] }>("apply_template", {
      template: "urgency-ladder",
      urgencyLadder: { levels: LADDER.levels },
    });
    expect(levelsOnly.removed).toEqual([]);
    expect(doc().templates?.urgencyLadder?.afterHours).toBe(true);
    const hours = {
      start: "13:00",
      end: "15:00",
      days: [1, 2, 3, 4],
      purposes: ["meetings"],
    };
    await call("apply_template", {
      template: "core-hours",
      coreHours: {
        ...hours,
        timeZone: "Europe/London",
        anchorDays: [{ site: "HQ", days: [2] }],
      },
    });
    await call("apply_template", { template: "core-hours", coreHours: { ...hours, end: "16:00" } });
    expect(doc().templates?.coreHours).toMatchObject({
      end: "16:00",
      timeZone: "Europe/London",
      anchorDays: [{ site: "HQ", days: [2] }],
    });
    await call("apply_template", {
      template: "core-hours",
      coreHours: { ...hours, anchorDays: [] },
    });
    expect(doc().templates?.coreHours).not.toHaveProperty("anchorDays");
    // Focus time's weekly minimum stays until null takes it out.
    await call("apply_template", {
      template: "focus-time",
      focusTime: { days: [2], start: "09:00", end: "11:00", weeklyMinHours: 4 },
    });
    await call("apply_template", {
      template: "focus-time",
      focusTime: { days: [2, 4], start: "09:00", end: "11:00" },
    });
    expect(doc().templates?.focusTime?.weeklyMinHours).toBe(4);
    await call("apply_template", {
      template: "focus-time",
      focusTime: { days: [2, 4], start: "09:00", end: "11:00", weeklyMinHours: null },
    });
    expect(doc().templates?.focusTime).not.toHaveProperty("weeklyMinHours");
  });

  it("defaults core hours to UTC over MCP and writes the server's document", async () => {
    const r = await callMcp<{ applied: boolean }>("apply_template", {
      template: "core-hours",
      coreHours: { start: "13:00", end: "15:00", days: [1, 2, 3, 4], purposes: ["meetings"] },
    });
    expect(r.applied).toBe(true);
    const stored = normalizeAgreement(rows.get(`${WA_KIND}/${WA_ID}`));
    expect(stored.templates?.coreHours?.timeZone).toBe("UTC");
    expect(stored.rules[0].text).toBe(
      "Our core hours are 13:00–15:00 UTC, Mon–Thu: we keep meetings inside them."
    );
    const listed = await callMcp<{ templates: { id: string; applied: boolean }[] }>(
      "list_templates"
    );
    expect(listed.templates.find((t) => t.id === "core-hours")?.applied).toBe(true);
  });

  it("update_rule detaches a template's rule, as a hand edit on the page does", async () => {
    const { ruleIds } = await call<{ ruleIds: string[] }>("apply_template", {
      template: "focus-time",
      focusTime: { days: [2], start: "09:00", end: "11:00" },
    });
    expect(doc().rules[0].template).toEqual({ id: "focus-time", slot: "focus" });
    expect(doc().rules[0].text).toContain("on each person's own clock");
    await call("update_rule", { ruleId: ruleIds[0], category: "meetings" });
    expect(doc().rules[0]).not.toHaveProperty("template");
    expect(doc().rules[0].category).toBe("meetings");
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
