/**
 * The workspace.* CRUD for the Phase 42 collections (the tools plan's phase
 * 1). `update` validates the merged record and writes what the schema parsed,
 * and z.object drops keys it doesn't know, so every field must be in the
 * schema or an agent's update would erase it. Also: times stamped on create
 * and update, the caps the pages share, one active Product Goal at a time,
 * the kind each syncs under, and the sprint and story fields Phase 42 adds.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
    serverGetEntity: vi.fn(async () => null),
    serverDeleteEntity: vi.fn(async () => {}),
    serverBulkUpsertEntities: vi.fn(async () => {}),
  };
});

import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  INTERRUPT_ITEM_KIND,
  MEETING_AUDIT_KIND,
  NOTEBOOK_ENTRY_KIND,
  PARKING_LOT_ITEM_KIND,
  PRODUCT_GOAL_KIND,
  ROOT_CAUSE_ANALYSIS_KIND,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ProductGoal,
  type Workspace,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/workspace";
import {
  ANALYSIS,
  GOAL,
  INTERRUPT,
  MEETING,
  NOTE,
  PARKED,
  SPRINT_WITH_BUFFER,
  STORY_WITH_GWT,
} from "../stores/phase42-fixtures";

const upsertEntity = vi.mocked(serverStore.serverUpsertEntity);
const listEntities = vi.mocked(serverStore.serverListEntities);

type Doc = { id: string };

const action = (id: string) => {
  const a = registry.get(id);
  if (!a) throw new Error(`missing action ${id}`);
  return a;
};

const parseCreate = (toolId: string, entity: unknown) =>
  action(`${toolId}.create`).paramsSchema.safeParse({ entity });

const rejects = (toolId: string, entity: unknown) =>
  expect(parseCreate(toolId, entity).success, JSON.stringify(entity).slice(0, 120)).toBe(false);

/** Run `create` the way both transports do: params validated first. */
async function create(toolId: string, entity: unknown, mcp = false) {
  const a = action(`${toolId}.create`);
  const parsed = a.paramsSchema.safeParse({ entity });
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  return mcp
    ? a.mcpHandler!(parsed.data, makeContext("u", "mcp"))
    : a.handler(parsed.data, makeContext("u", "agent"));
}

/** Seed the slice, run the in-tab `update` with `patch`, and read the record back. */
async function update(toolId: string, slice: keyof Workspace, doc: Doc, patch = {}) {
  useWorkspaceStore.setState({ [slice]: [doc] } as Partial<Workspace>);
  await action(`${toolId}.update`).handler({ id: doc.id, patch }, makeContext("u", "agent"));
  return (useWorkspaceStore.getState()[slice] as Doc[]).find((d) => d.id === doc.id);
}

const COLLECTIONS: [toolId: string, slice: keyof Workspace, doc: Doc, kind: string][] = [
  ["workspace.parking_lot_item", "parkingLotItems", PARKED, PARKING_LOT_ITEM_KIND],
  ["workspace.root_cause_analysis", "rootCauseAnalyses", ANALYSIS, ROOT_CAUSE_ANALYSIS_KIND],
  ["workspace.product_goal", "productGoals", GOAL, PRODUCT_GOAL_KIND],
  ["workspace.interrupt_item", "interruptItems", INTERRUPT, INTERRUPT_ITEM_KIND],
  ["workspace.notebook_entry", "notebookEntries", NOTE, NOTEBOOK_ENTRY_KIND],
  ["workspace.meeting_audit", "meetingAudits", MEETING, MEETING_AUDIT_KIND],
];

/** Everything but the times the CRUD stamps. */
const unstamped = (d: Doc) => {
  const {
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = d as Doc & {
    createdAt?: string;
    updatedAt?: string;
  };
  void _c;
  void _u;
  return rest;
};

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  upsertEntity.mockClear();
  listEntities.mockReset();
  listEntities.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T08:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Phase 42 CRUD schemas keep every field", () => {
  it.each(COLLECTIONS)("%s parses a full record unchanged", (toolId, _slice, doc) => {
    const parsed = parseCreate(toolId, doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(doc);
  });

  it.each(COLLECTIONS)("%s update keeps every field", async (toolId, slice, doc) => {
    const stored = await update(toolId, slice, doc);
    expect(unstamped(stored!)).toEqual(unstamped(doc));
  });

  it.each(COLLECTIONS)(
    "%s syncs under its exported kind over MCP",
    async (toolId, _s, doc, kind) => {
      await create(toolId, { ...doc, id: undefined }, true);
      expect(upsertEntity).toHaveBeenCalledTimes(1);
      expect(upsertEntity.mock.calls[0][1]).toBe(kind);
    }
  );
});

describe("times", () => {
  it("are stamped on create, so an agent needn't send them", async () => {
    const { id } = (await create("workspace.parking_lot_item", {
      text: "Rename the build job",
      status: "open",
    })) as { id: string };
    expect(id).toMatch(/^parking_/);
    const item = useWorkspaceStore.getState().parkingLotItems!.find((p) => p.id === id)!;
    expect(item.createdAt).toBe("2026-11-13T08:00:00.000Z");
    expect(item.updatedAt).toBe("2026-11-13T08:00:00.000Z");
  });

  it("keep createdAt and move updatedAt on update", async () => {
    const stored = (await update("workspace.notebook_entry", "notebookEntries", NOTE, {
      title: "Quieter standup",
      createdAt: "1999-01-01T00:00:00.000Z",
    })) as typeof NOTE;
    expect(stored.title).toBe("Quieter standup");
    expect(stored.createdAt).toBe(NOTE.createdAt);
    expect(stored.updatedAt).toBe("2026-11-13T08:00:00.000Z");
  });

  it("stamp when an interrupt landed, keep it on later updates, and let it be backdated", async () => {
    const { id } = (await create("workspace.interrupt_item", {
      title: "Password reset emails bounce",
      kind: "support",
      emergency: false,
    })) as { id: string };
    const logged = useWorkspaceStore.getState().interruptItems!.find((i) => i.id === id)!;
    expect(logged.loggedAt).toBe("2026-11-13T08:00:00.000Z");
    const sized = (await update("workspace.interrupt_item", "interruptItems", INTERRUPT, {
      size: 5,
    })) as typeof INTERRUPT;
    expect(sized.loggedAt).toBe(INTERRUPT.loggedAt);
    expect(sized.size).toBe(5);
    const backdated = (await update("workspace.interrupt_item", "interruptItems", INTERRUPT, {
      loggedAt: "2026-11-11T16:00:00.000Z",
    })) as typeof INTERRUPT;
    expect(backdated.loggedAt).toBe("2026-11-11T16:00:00.000Z");
  });
});

describe("bounds", () => {
  it("refuse blank text where a record needs it", () => {
    rejects("workspace.parking_lot_item", { ...PARKED, text: "   " });
    rejects("workspace.root_cause_analysis", { ...ANALYSIS, title: "" });
    rejects("workspace.product_goal", { ...GOAL, statement: " " });
    rejects("workspace.interrupt_item", { ...INTERRUPT, title: "" });
    rejects("workspace.notebook_entry", { ...NOTE, body: "" });
    rejects("workspace.meeting_audit", { ...MEETING, meeting: "" });
  });

  it("hold the caps the pages share", () => {
    const long = "x".repeat(TOOL_TEXT_MAX.text + 1);
    rejects("workspace.parking_lot_item", { ...PARKED, text: long });
    rejects("workspace.root_cause_analysis", {
      ...ANALYSIS,
      whys: Array.from({ length: TOOL_LIST_MAX.whys + 1 }, (_, i) => ({
        id: `w${i}`,
        text: "why",
      })),
    });
    rejects("workspace.product_goal", {
      ...GOAL,
      measures: Array.from({ length: TOOL_LIST_MAX.measures + 1 }, () => "m"),
    });
    rejects("workspace.notebook_entry", { ...NOTE, body: "x".repeat(TOOL_TEXT_MAX.long + 1) });
    rejects("workspace.notebook_entry", {
      ...NOTE,
      tags: Array.from({ length: TOOL_LIST_MAX.tags + 1 }, (_, i) => `t${i}`),
    });
    rejects("workspace.meeting_audit", {
      ...MEETING,
      ratings: Object.fromEntries(
        Array.from({ length: TOOL_LIST_MAX.ratings + 1 }, (_, i) => [`q${i}`, 3])
      ),
    });
  });

  it("refuse values outside their range or set", () => {
    rejects("workspace.parking_lot_item", { ...PARKED, status: "parked" });
    rejects("workspace.root_cause_analysis", { ...ANALYSIS, method: "ishikawa" });
    rejects("workspace.root_cause_analysis", {
      ...ANALYSIS,
      causes: [{ id: "c", category: "Tools", text: "t", count: 1.5 }],
    });
    rejects("workspace.product_goal", { ...GOAL, targetDate: "next spring" });
    rejects("workspace.interrupt_item", { ...INTERRUPT, kind: "chore" });
    rejects("workspace.interrupt_item", { ...INTERRUPT, size: -1 });
    rejects("workspace.notebook_entry", { ...NOTE, date: "12/11/2026" });
    rejects("workspace.meeting_audit", { ...MEETING, cadence: "hourly" });
    rejects("workspace.meeting_audit", { ...MEETING, minutes: 0 });
    rejects("workspace.meeting_audit", { ...MEETING, attendees: 0 });
    rejects("workspace.meeting_audit", { ...MEETING, verdict: "maybe" });
  });
});

describe("the Product Goal", () => {
  const active: ProductGoal = { ...GOAL, id: "goal_active", status: "active", closedAt: undefined };

  it("refuses a second active goal, in the tab and over MCP", async () => {
    useWorkspaceStore.setState({ productGoals: [active] });
    await expect(
      create("workspace.product_goal", { ...GOAL, id: undefined, status: "active" })
    ).rejects.toThrow(/Another Product Goal is active/);
    expect(useWorkspaceStore.getState().productGoals).toEqual([active]);

    listEntities.mockResolvedValue([active]);
    await expect(
      create("workspace.product_goal", { ...GOAL, id: undefined, status: "active" }, true)
    ).rejects.toThrow(/one goal is active at a time/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("lets the active goal itself be edited, and a closed one be added beside it", async () => {
    const edited = (await update("workspace.product_goal", "productGoals", active, {
      why: "Shops asked for it.",
    })) as ProductGoal;
    expect(edited.why).toBe("Shops asked for it.");
    await create("workspace.product_goal", { ...GOAL, id: "goal_old" });
    expect(useWorkspaceStore.getState().productGoals!.map((g) => g.id)).toEqual([
      "goal_active",
      "goal_old",
    ]);
  });

  it("stamps closedAt when a goal is closed, and clears it when it is active again", async () => {
    const closed = (await update("workspace.product_goal", "productGoals", active, {
      status: "achieved",
    })) as ProductGoal;
    expect(closed.closedAt).toBe("2026-11-13T08:00:00.000Z");
    const reopened = (await update("workspace.product_goal", "productGoals", closed, {
      status: "active",
    })) as ProductGoal;
    expect(reopened).not.toHaveProperty("closedAt");
  });
});

describe("the sprint and story fields Phase 42 adds", () => {
  it("a sprint's interrupt buffer survives create and update", async () => {
    const parsed = parseCreate("workspace.sprint", SPRINT_WITH_BUFFER);
    expect(parsed.success).toBe(true);
    const stored = await update("workspace.sprint", "sprints", SPRINT_WITH_BUFFER);
    expect(stored).toEqual(SPRINT_WITH_BUFFER);
    rejects("workspace.sprint", { ...SPRINT_WITH_BUFFER, interruptBuffer: { pct: 120 } });
    rejects("workspace.sprint", { ...SPRINT_WITH_BUFFER, interruptBuffer: { points: -2 } });
  });

  it("a story's Given/When/Then criteria survive create and update, beside the free text", async () => {
    const parsed = parseCreate("workspace.story", STORY_WITH_GWT);
    expect(parsed.success).toBe(true);
    expect((parsed.data as { entity: typeof STORY_WITH_GWT }).entity.gwt).toEqual(
      STORY_WITH_GWT.gwt
    );
    const stored = (await update("workspace.story", "stories", STORY_WITH_GWT, {
      title: "Pay by phone, any bank",
    })) as typeof STORY_WITH_GWT;
    expect(stored.gwt).toEqual(STORY_WITH_GWT.gwt);
    expect(stored.acceptanceCriteria).toBe(STORY_WITH_GWT.acceptanceCriteria);
    rejects("workspace.story", {
      ...STORY_WITH_GWT,
      gwt: Array.from({ length: TOOL_LIST_MAX.gwt + 1 }, (_, i) => ({
        id: `g${i}`,
        given: "a",
        when: "b",
        then: "c",
      })),
    });
    rejects("workspace.story", {
      ...STORY_WITH_GWT,
      gwt: [{ id: "g", given: "x".repeat(TOOL_TEXT_MAX.text + 1), when: "b", then: "c" }],
    });
  });
});
