/**
 * The workspace.* CRUD schemas for the Team & people tools keep every
 * Phase 6 field. `update` validates the merged record and writes what the
 * schema parsed, and z.object drops keys it doesn't know, so a field
 * missing from a schema would be erased by every agent update.
 *
 * Also: the new collections' CRUD (ids, singleton ids, the server kind the
 * browser syncs), a singleton's create never replacing the team's document,
 * the tightened bounds, and the maturity level's owner.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
    serverGetEntity: vi.fn(async () => null),
    serverDeleteEntity: vi.fn(async () => {}),
  };
});

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ADKAR_DOC_ID,
  DOD_DOC_ID,
  HEALTH_DASHBOARD_ID,
  MOOD_TRACKER_ID,
  RACI_ID,
  WORKING_AGREEMENT_ID,
  type HealthDashboardConfig,
  type Workspace,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/workspace";
import "@/lib/actions/workspace/scalars";
import {
  ADKAR,
  AGREEMENT,
  DOD,
  HEALTH,
  MATURITY,
  MOOD_DOC,
  MOOD_ENTRY,
  PSYCH,
  PULSE,
  RACI,
  SKILLS,
  STORY,
} from "../team/phase6-fixtures";

const upsertEntity = vi.mocked(serverStore.serverUpsertEntity);

type Doc = { id: string };

const action = (id: string) => {
  const a = registry.get(id);
  if (!a) throw new Error(`missing action ${id}`);
  return a;
};

/** What `create` accepts for this entity, parsed. */
function parseCreate(toolId: string, entity: unknown) {
  return action(`${toolId}.create`).paramsSchema.safeParse({ entity });
}

/** Seed the slice, run the in-tab `update` with an empty patch, and read back. */
async function updateRoundTrip(toolId: string, slice: keyof Workspace, doc: Doc) {
  useWorkspaceStore.setState({ [slice]: [doc] } as Partial<Workspace>);
  await action(`${toolId}.update`).handler({ id: doc.id, patch: {} }, makeContext("u", "agent"));
  return (useWorkspaceStore.getState()[slice] as Doc[]).find((d) => d.id === doc.id);
}

// Entities whose store upsert writes the parsed record as is.
const FULL: [toolId: string, slice: keyof Workspace, doc: Doc][] = [
  ["workspace.working_agreement", "workingAgreements", AGREEMENT],
  ["workspace.psych_safety_log", "psychSafetyLogs", PSYCH],
  ["workspace.maturity_assessment", "maturityAssessments", MATURITY],
  ["workspace.health_check", "healthChecks", HEALTH],
  ["workspace.skills_matrix", "skillsMatrices", SKILLS],
  ["workspace.mood_entry", "moodEntries", MOOD_ENTRY],
  ["workspace.mood_pulse", "moodPulses", PULSE],
  ["workspace.mood_tracker_doc", "moodTrackerDocs", MOOD_DOC],
  ["workspace.definition_of_done", "definitionsOfDone", DOD],
  ["workspace.raci_matrix", "raciMatrices", RACI],
  ["workspace.adkar_doc", "adkarDocs", ADKAR],
];

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  upsertEntity.mockClear();
});

describe("Team & people CRUD schemas keep every field", () => {
  it.each(FULL)("%s parses a full document unchanged", (toolId, _slice, doc) => {
    const parsed = parseCreate(toolId, doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(doc);
  });

  it.each(FULL)("%s update keeps every field", async (toolId, slice, doc) => {
    expect(await updateRoundTrip(toolId, slice, doc)).toEqual(doc);
  });

  it("a story keeps its DoD checks through create and update", async () => {
    const parsed = parseCreate("workspace.story", STORY);
    expect(parsed.success).toBe(true);
    expect((parsed.data as { entity: typeof STORY }).entity.dodChecks).toEqual(STORY.dodChecks);
    const stored = (await updateRoundTrip("workspace.story", "stories", STORY)) as typeof STORY;
    expect(stored.dodChecks).toEqual(STORY.dodChecks);
  });

  it("a health check light parses without a trend (it is derived at save)", () => {
    const current = {
      ...HEALTH.current,
      scores: { ...HEALTH.current.scores, Fun: { light: "yellow" } },
    };
    expect(parseCreate("workspace.health_check", { ...HEALTH, current }).success).toBe(true);
  });
});

describe("bounds", () => {
  const rejects = (toolId: string, entity: unknown) =>
    expect(parseCreate(toolId, entity).success).toBe(false);

  it("a mood entry is a whole score 1-5 on a YYYY-MM-DD day", () => {
    rejects("workspace.mood_entry", { ...MOOD_ENTRY, score: 6 });
    rejects("workspace.mood_entry", { ...MOOD_ENTRY, score: 2.5 });
    rejects("workspace.mood_entry", { ...MOOD_ENTRY, date: "2026-10-01T09:00:00Z" });
  });

  it("a mood pulse counts every face, in whole people", () => {
    rejects("workspace.mood_pulse", { ...PULSE, counts: { 1: 0, 2: 1, 3: 2, 4: 3 } });
    rejects("workspace.mood_pulse", { ...PULSE, counts: { ...PULSE.counts, 3: -1 } });
  });

  it("a psych-safety round has five counts for each of the seven questions", () => {
    const round = PSYCH.rounds![0];
    const short = { ...round, counts: { ...round.counts, q4: [1, 1, 1, 1] } };
    rejects("workspace.psych_safety_log", { ...PSYCH, rounds: [short] });
    const six: Partial<typeof round.counts> = { ...round.counts };
    delete six.q7;
    rejects("workspace.psych_safety_log", { ...PSYCH, rounds: [{ ...round, counts: six }] });
  });

  it("skill levels are whole numbers 0-4 and targets 2-4", () => {
    rejects("workspace.skills_matrix", { ...SKILLS, grid: { s1: { member_ana: 5 } } });
    rejects("workspace.skills_matrix", {
      ...SKILLS,
      skills: [{ ...SKILLS.skills[0], targetLevel: 1 }],
    });
  });

  it("maturity scores are whole levels 1-5 and saved assessments are dated", () => {
    rejects("workspace.maturity_assessment", { ...MATURITY, scores: { a: 0 } });
    rejects("workspace.maturity_assessment", {
      ...MATURITY,
      history: [{ ...MATURITY.history![0], assessedAt: "last week" }],
    });
  });

  it("health votes are counts of people and notes stay short", () => {
    const scores = {
      ...HEALTH.current.scores,
      Fun: { light: "red", trend: "same", votes: { green: -1, yellow: 0, red: 3 } },
    };
    rejects("workspace.health_check", { ...HEALTH, current: { ...HEALTH.current, scores } });
    const long = { ...HEALTH.current.scores, Fun: { light: "red", note: "x".repeat(501) } };
    rejects("workspace.health_check", {
      ...HEALTH,
      current: { ...HEALTH.current, scores: long },
    });
  });

  it("RACI cells hold only R, A, C and I", () => {
    rejects("workspace.raci_matrix", { ...RACI, cells: { a1: { r1: ["X"] } } });
  });
});

/** Run `create` the way both transports do: params validated first. */
async function createViaTransport(toolId: string, entity: unknown, mcp = false) {
  const a = action(`${toolId}.create`);
  const parsed = a.paramsSchema.safeParse({ entity });
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  return mcp
    ? a.mcpHandler!(parsed.data, makeContext("u", "mcp"))
    : a.handler(parsed.data, makeContext("u", "agent"));
}

const DASHBOARD: HealthDashboardConfig = {
  id: HEALTH_DASHBOARD_ID,
  sprintWindow: 4,
  updatedAt: "2026-10-20T09:00:00.000Z",
};

// Singletons: [toolId, slice, fixed id, an empty document's other fields, the
// team's document]. The empty one is what an id-less create used to write over
// the team's.
const SINGLETONS: [toolId: string, slice: keyof Workspace, id: string, empty: object, doc: Doc][] =
  [
    [
      "workspace.definition_of_done",
      "definitionsOfDone",
      DOD_DOC_ID,
      { items: [], history: [] },
      DOD,
    ],
    [
      "workspace.raci_matrix",
      "raciMatrices",
      RACI_ID,
      { roles: [], activities: [], cells: {} },
      RACI,
    ],
    ["workspace.adkar_doc", "adkarDocs", ADKAR_DOC_ID, { initiatives: [] }, ADKAR],
    ["workspace.mood_tracker_doc", "moodTrackerDocs", MOOD_TRACKER_ID, { mode: "named" }, MOOD_DOC],
    [
      "workspace.working_agreement",
      "workingAgreements",
      WORKING_AGREEMENT_ID,
      { rules: [], meta: { version: 0 } },
      AGREEMENT,
    ],
    ["workspace.health_dashboard", "healthDashboards", HEALTH_DASHBOARD_ID, {}, DASHBOARD],
  ];

describe("singleton CRUD never overwrites the team's document", () => {
  it.each(SINGLETONS)(
    "%s creates its one document under the fixed id",
    async (toolId, slice, id, empty) => {
      expect(await createViaTransport(toolId, { id, ...empty })).toEqual({ id });
      expect((useWorkspaceStore.getState()[slice] as Doc[]).map((d) => d.id)).toEqual([id]);
      expect(action(`${toolId}.create`).description).toContain(id);
    }
  );

  it.each(SINGLETONS)(
    "%s create needs the fixed id: none or another is refused",
    async (toolId, slice, id, empty) => {
      await expect(createViaTransport(toolId, { ...empty })).rejects.toThrow(/rejected/);
      await expect(createViaTransport(toolId, { ...empty, id: `${id}-2` })).rejects.toThrow(
        /rejected/
      );
      expect(useWorkspaceStore.getState()[slice] ?? []).toEqual([]);
    }
  );

  it.each(SINGLETONS)(
    "%s create on an existing document throws and keeps it",
    async (toolId, slice, id, empty, doc) => {
      useWorkspaceStore.setState({ [slice]: [doc] } as Partial<Workspace>);
      await expect(createViaTransport(toolId, { id, ...empty })).rejects.toThrow(/already exists/);
      await expect(createViaTransport(toolId, { ...empty })).rejects.toThrow(/rejected/);
      expect(useWorkspaceStore.getState()[slice]).toEqual([doc]);
    }
  );

  it.each(SINGLETONS)(
    "%s MCP create on an existing document throws and writes nothing",
    async (toolId, _slice, id, empty, doc) => {
      vi.mocked(serverStore.serverGetEntity).mockResolvedValueOnce(doc);
      await expect(createViaTransport(toolId, { id, ...empty }, true)).rejects.toThrow(
        /already exists/
      );
      expect(upsertEntity).not.toHaveBeenCalled();
    }
  );

  it.each(SINGLETONS)(
    "%s update still works on the document",
    async (toolId, slice, id, _empty, doc) => {
      useWorkspaceStore.setState({ [slice]: [doc] } as Partial<Workspace>);
      const result = await action(`${toolId}.update`).handler(
        { id, patch: {} },
        makeContext("u", "agent")
      );
      expect(result).toEqual({ updated: true });
      expect(useWorkspaceStore.getState()[slice]).toEqual([doc]);
    }
  );
});

describe("the new collections' CRUD", () => {
  it("a mood pulse gets its own id", async () => {
    const rest: Omit<typeof PULSE, "id"> = {
      date: PULSE.date,
      counts: PULSE.counts,
      source: PULSE.source,
      createdAt: PULSE.createdAt,
    };
    const result = (await action("workspace.mood_pulse.create").handler(
      { entity: { ...rest } },
      makeContext("u", "agent")
    )) as { id: string };
    expect(result.id).toMatch(/^moodPulse_/);
    expect(useWorkspaceStore.getState().moodPulses?.[0]).toMatchObject(rest);
  });

  it.each([
    ["workspace.definition_of_done", "workspace:definitionOfDone", DOD],
    ["workspace.raci_matrix", "workspace:raciMatrix", RACI],
    ["workspace.adkar_doc", "workspace:adkarDoc", ADKAR],
    ["workspace.mood_tracker_doc", "workspace:moodTrackerDoc", MOOD_DOC],
    ["workspace.mood_pulse", "workspace:moodPulse", PULSE],
  ])("%s writes to %s on the server (the kind the browser syncs)", async (toolId, kind, doc) => {
    await action(`${toolId}.create`).mcpHandler!({ entity: { ...doc } }, makeContext("u", "mcp"));
    expect(upsertEntity).toHaveBeenCalledTimes(1);
    expect(upsertEntity.mock.calls[0][1]).toBe(kind);
  });

  it("every CRUD verb is registered and its create schema converts to JSON Schema", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [toolId] of FULL) {
      for (const verb of ["create", "list", "update", "delete"]) {
        expect(registry.get(`${toolId}.${verb}`), `${toolId}.${verb}`).toBeDefined();
      }
      const json = zodToJsonSchema(action(`${toolId}.create`).paramsSchema);
      expect(json, toolId).toHaveProperty("properties.entity");
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("the maturity level's owner", () => {
  it("set_maturity_level says the Maturity tool's latest assessment owns the level", () => {
    const description = action("workspace.scalars.set_maturity_level").description;
    expect(description).toMatch(/Maturity tool's latest saved assessment owns this level/);
    expect(description).toMatch(/unassessed/);
  });
});
