/**
 * The workspace.* CRUD schemas for the Prioritize & decide tools keep every
 * Phase 7 field. `update` validates the merged record and writes what the
 * schema parsed, and z.object drops keys it doesn't know, so a field
 * missing from a schema would be erased by every agent update.
 *
 * Also: the new collections' CRUD (ids, the singleton game, the server kind
 * the browser syncs), records from before Phase 7 still validating (a
 * backlog item with no method inputs, a decision with none of the new
 * fields), and the bounds.
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

import { registry, zodToJsonSchema } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ALLOCATION_ROUND_KIND,
  BUY_A_FEATURE_ID,
  BUY_A_FEATURE_KIND,
  DEFAULT_WEIGHTED_MATRIX_ID,
  WEIGHTED_CRITERION_KIND,
  WEIGHTED_MATRIX_KIND,
  WEIGHTED_OPTION_KIND,
  type DACIDecision,
  type RAPIDDecision,
  type WeightedCriterion,
  type WeightedMatrix,
  type WeightedOption,
  type Workspace,
} from "@/lib/stores/workspace-types";
import "@/lib/actions/workspace";
import {
  ALLOCATION_ROUND,
  BACKLOG_BARE,
  BACKLOG_FULL,
  BUY_A_FEATURE_GAME,
  CRITERION,
  CYNEFIN,
  DECISION,
  DEFAULT_OPTION,
  FUNDED_FEATURE,
  LEGACY_CRITERION,
  LEGACY_OPTION,
  MATRIX,
  OPTION,
  STORY_RANKED,
} from "../stores/phase7-fixtures";

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

/** Run `create` the way both transports do: params validated first. */
async function createViaTransport(toolId: string, entity: unknown, mcp = false) {
  const a = action(`${toolId}.create`);
  const parsed = a.paramsSchema.safeParse({ entity });
  if (!parsed.success) throw new Error(`rejected: ${parsed.error.message}`);
  return mcp
    ? a.mcpHandler!(parsed.data, makeContext("u", "mcp"))
    : a.handler(parsed.data, makeContext("u", "agent"));
}

const rejects = (toolId: string, entity: unknown) =>
  expect(parseCreate(toolId, entity).success, JSON.stringify(entity)).toBe(false);

// Entities whose store upsert writes the parsed record as is.
const FULL: [toolId: string, slice: keyof Workspace, doc: Doc][] = [
  ["workspace.allocation_round", "allocationRounds", ALLOCATION_ROUND],
  ["workspace.buy_a_feature_game", "buyAFeatureGames", BUY_A_FEATURE_GAME],
  ["workspace.weighted_matrix", "weightedMatrices", MATRIX],
  ["workspace.weighted_option", "weightedOptions", OPTION],
  ["workspace.weighted_criterion", "weightedCriteria", CRITERION],
  ["workspace.backlog_item", "backlogItems", BACKLOG_FULL],
  ["workspace.prioritization", "prioritizations", FUNDED_FEATURE],
  ["workspace.decision", "decisions", DECISION],
  ["workspace.cynefin_item", "cynefinItems", CYNEFIN],
];

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  upsertEntity.mockClear();
});

describe("Prioritize & decide CRUD schemas keep every field", () => {
  it.each(FULL)("%s parses a full record unchanged", (toolId, _slice, doc) => {
    const parsed = parseCreate(toolId, doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(doc);
  });

  it.each(FULL)("%s update keeps every field", async (toolId, slice, doc) => {
    expect(await updateRoundTrip(toolId, slice, doc)).toEqual(doc);
  });

  it("a story keeps its backlog rank through create and update", async () => {
    const parsed = parseCreate("workspace.story", STORY_RANKED);
    expect(parsed.success).toBe(true);
    expect((parsed.data as { entity: typeof STORY_RANKED }).entity.backlogRank).toBe(2);
    const stored = (await updateRoundTrip(
      "workspace.story",
      "stories",
      STORY_RANKED
    )) as typeof STORY_RANKED;
    expect(stored.backlogRank).toBe(2);
  });
});

describe("records from before Phase 7 still validate", () => {
  it("a backlog item with no method inputs is a valid create, and stays bare", async () => {
    const parsed = parseCreate("workspace.backlog_item", BACKLOG_BARE);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(BACKLOG_BARE);
    expect(await updateRoundTrip("workspace.backlog_item", "backlogItems", BACKLOG_BARE)).toEqual(
      BACKLOG_BARE
    );
  });

  it("a backlog item saved with the old defaults (and a legacy value) is unchanged", async () => {
    const legacy = {
      id: "backlog_old",
      name: "Old",
      moscow: "should" as const,
      businessValue: 5,
      timeCriticality: 5,
      riskReduction: 5,
      jobSize: 5,
      reach: 100,
      impact: 1,
      confidence: 80,
      effort: 1,
      value: 5,
      matrixEffort: 5,
    };
    expect(await updateRoundTrip("workspace.backlog_item", "backlogItems", legacy)).toEqual(legacy);
  });

  it("a decision with none of the new fields (an ADR) is unchanged", async () => {
    const adr = {
      id: "dec_old",
      title: "Use Postgres",
      decision: "We will use Postgres",
      alternatives: ["MySQL"],
      status: "proposed" as const,
      date: "2026-09-01",
    };
    expect(await updateRoundTrip("workspace.decision", "decisions", adr)).toEqual(adr);
  });

  it("the legacy DACI and RAPID records keep their own CRUD and shape", async () => {
    const daci: DACIDecision = {
      id: "daci_old",
      title: "Vendor",
      driver: "Bo",
      approver: "Ana",
      contributors: ["Cy"],
      informed: ["Team"],
      options: ["A", "B"],
      recommendation: "A",
      status: "revisit",
      date: "2026-09-01",
    };
    const rapid: RAPIDDecision = {
      id: "rapid_old",
      title: "Pricing",
      recommend: "Bo",
      agree: ["Cy"],
      perform: ["Di"],
      input: ["Ed"],
      decide: "Ana",
      status: "implemented",
      date: "2026-09-01",
    };
    expect(await updateRoundTrip("workspace.daci_decision", "daciDecisions", daci)).toEqual(daci);
    expect(await updateRoundTrip("workspace.rapid_decision", "rapidDecisions", rapid)).toEqual(
      rapid
    );
  });

  it("weighted rows without a matrix and Cynefin items without answers are unchanged", async () => {
    const option = { id: "opt-1", name: "A", scores: { c1: 4 } };
    const item = { id: "c-1", title: "X", domain: "clear" as const, loggedAt: "2026-09-01" };
    expect(await updateRoundTrip("workspace.weighted_option", "weightedOptions", option)).toEqual(
      option
    );
    expect(await updateRoundTrip("workspace.cynefin_item", "cynefinItems", item)).toEqual(item);
  });
});

describe("bounds", () => {
  it("an allocation round holds whole amounts of a 10–9,999 budget, counted in people", () => {
    const item = ALLOCATION_ROUND.items[0];
    rejects("workspace.allocation_round", { ...ALLOCATION_ROUND, budget: 5 });
    rejects("workspace.allocation_round", { ...ALLOCATION_ROUND, budget: 10_000 });
    rejects("workspace.allocation_round", { ...ALLOCATION_ROUND, unit: "dollars" });
    rejects("workspace.allocation_round", { ...ALLOCATION_ROUND, tool: "rice-scoring" });
    rejects("workspace.allocation_round", { ...ALLOCATION_ROUND, date: "2026-10-20T10:00:00Z" });
    rejects("workspace.allocation_round", { ...ALLOCATION_ROUND, minN: 0 });
    rejects("workspace.allocation_round", {
      ...ALLOCATION_ROUND,
      items: [{ ...item, total: 12.5 }],
    });
    rejects("workspace.allocation_round", {
      ...ALLOCATION_ROUND,
      items: [{ ...item, bands: [0, -1, 0, 0, 0] }],
    });
  });

  it("an allocation round counted on paper keeps more than 20 items through create and update", async () => {
    // The 20-item limit is the live round's: a count entry or record_round
    // saves a round of 24 paper splits, and the CRUD must take it back.
    const paper = {
      ...ALLOCATION_ROUND,
      id: "allocationRound_paper24",
      roundId: "tally-paper",
      source: "facilitator" as const,
      spreadKnown: false,
      ballots: 5,
      items: Array.from({ length: 24 }, (_, i) => ({
        itemId: `prio_${i}`,
        text: `Item ${i + 1}`,
        total: 20,
        backers: null,
        bands: null,
      })),
    };
    const parsed = parseCreate("workspace.allocation_round", paper);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    await createViaTransport("workspace.allocation_round", paper);
    await createViaTransport("workspace.allocation_round", paper, true);
    expect(upsertEntity).toHaveBeenCalledTimes(1);
    const result = await action("workspace.allocation_round.update").handler(
      { id: paper.id, patch: { date: "2026-10-21" } },
      makeContext("u", "agent")
    );
    expect(result).toEqual({ updated: true });
    expect(useWorkspaceStore.getState().allocationRounds).toEqual([
      { ...paper, date: "2026-10-21" },
    ]);
  });

  it("an allocation round keeps the kit's record rules", () => {
    const [search, exports] = ALLOCATION_ROUND.items;
    const round = (patch: Partial<typeof ALLOCATION_ROUND>) => ({ ...ALLOCATION_ROUND, ...patch });
    const accepts = (entity: unknown) =>
      expect(
        parseCreate("workspace.allocation_round", entity).success,
        JSON.stringify(entity)
      ).toBe(true);
    // Saved only once revealed.
    rejects("workspace.allocation_round", round({ minN: 7 }));
    // Two items at least, as on the kit's sheet.
    rejects("workspace.allocation_round", round({ items: [search] }));
    // Band edges start at 0 and ascend.
    rejects("workspace.allocation_round", round({ bandEdges: [1, 2, 11, 26, 51] }));
    rejects("workspace.allocation_round", round({ bandEdges: [0, 11, 11, 26, 51] }));
    // One count per band, each ballot in exactly one band.
    rejects(
      "workspace.allocation_round",
      round({ items: [{ ...search, bands: [0, 1, 2, 3] }, exports] })
    );
    rejects(
      "workspace.allocation_round",
      round({ items: [{ ...search, bands: [0, 0, 1, 2, 2] }, exports] })
    );
    // No more backers than ballots, and no more than everyone's budget.
    rejects("workspace.allocation_round", round({ items: [{ ...search, backers: 7 }, exports] }));
    rejects("workspace.allocation_round", round({ items: [{ ...search, total: 601 }, exports] }));
    // Under 5 answers the spread is withheld: totals only.
    const four = { ballots: 4, minN: 3 };
    rejects(
      "workspace.allocation_round",
      round({ ...four, items: [{ ...search, bands: [0, 0, 1, 1, 2] }, exports] })
    );
    rejects(
      "workspace.allocation_round",
      round({ ...four, items: [{ ...search, backers: 4, bands: null }, exports] })
    );
    accepts(round({ ...four, items: [{ ...search, backers: null, bands: null }, exports] }));
    // An id-less create keeps the rules (safeExtend), and a valid one passes.
    const rest: Record<string, unknown> = round({ minN: 7 });
    delete rest.id;
    rejects("workspace.allocation_round", rest);
    accepts(ALLOCATION_ROUND);
  });

  it("a round of typed totals keeps spreadKnown: false through an update, with no spread", async () => {
    const [search, exports] = ALLOCATION_ROUND.items;
    const typed = {
      ...ALLOCATION_ROUND,
      source: "facilitator" as const,
      spreadKnown: false,
      items: [search, exports].map((x) => ({ ...x, backers: null, bands: null })),
    };
    expect(await updateRoundTrip("workspace.allocation_round", "allocationRounds", typed)).toEqual(
      typed
    );
    // Typed totals never know who backed what, or the bands, at any count.
    rejects("workspace.allocation_round", { ...typed, items: [search, typed.items[1]] });
    rejects("workspace.allocation_round", {
      ...typed,
      items: [{ ...typed.items[0], backers: 6 }, typed.items[1]],
    });
    // Only a count entry types totals in.
    rejects("workspace.allocation_round", { ...typed, source: "room" });
  });

  it("a decision's DACI Driver and RAPID Recommend are one person at most", () => {
    rejects("workspace.decision", { ...DECISION, roles: { driver: ["Bo", "Cy"] } });
    rejects("workspace.decision", { ...DECISION, roles: { recommend: ["Bo", "Cy"] } });
    const many = {
      ...DECISION,
      roles: { driver: ["Bo"], contributor: ["Cy", "Di"], agree: ["Ed", "Fa"] },
    };
    const parsed = parseCreate("workspace.decision", many);
    expect(parsed.success).toBe(true);
    expect((parsed.data as { entity: Doc }).entity).toEqual(many);
  });

  it("the game's budget, players and unit are bounded, and each is optional", () => {
    rejects("workspace.buy_a_feature_game", { ...BUY_A_FEATURE_GAME, budgetPerPlayer: 9 });
    rejects("workspace.buy_a_feature_game", { ...BUY_A_FEATURE_GAME, players: 0 });
    rejects("workspace.buy_a_feature_game", { ...BUY_A_FEATURE_GAME, players: 1.5 });
    rejects("workspace.buy_a_feature_game", { ...BUY_A_FEATURE_GAME, unit: "euros" });
    const unset = { id: BUY_A_FEATURE_ID, updatedAt: "2026-10-20T09:00:00.000Z" };
    expect(parseCreate("workspace.buy_a_feature_game", unset).success).toBe(true);
  });

  it("decision roles, templates and statuses are the named ones", () => {
    rejects("workspace.decision", { ...DECISION, roles: { approver: ["Ana"] } });
    rejects("workspace.decision", { ...DECISION, template: "pugh" });
    rejects("workspace.decision", { ...DECISION, status: "implemented" });
    rejects("workspace.decision", { ...DECISION, number: 0 });
    rejects("workspace.decision", { ...DECISION, options: [{ id: "o1" }] });
  });

  it("Cynefin answers are yes, no or unsure to the five questions", () => {
    rejects("workspace.cynefin_item", { ...CYNEFIN, answers: { crisis: "maybe" } });
    rejects("workspace.cynefin_item", { ...CYNEFIN, answers: { gut: "yes" } });
  });

  it("a backlog item's rank is a whole number from 1, and its reach period a named one", () => {
    rejects("workspace.backlog_item", { ...BACKLOG_FULL, rank: 0 });
    rejects("workspace.backlog_item", { ...BACKLOG_FULL, rank: 1.5 });
    rejects("workspace.backlog_item", { ...BACKLOG_FULL, reachPeriod: "day" });
    rejects("workspace.backlog_item", { ...BACKLOG_FULL, moscow: "maybe" });
  });

  it("a criterion's weight is not negative", () => {
    rejects("workspace.weighted_criterion", { ...CRITERION, weight: -1 });
  });
});

describe("the Buy-a-Feature game is a singleton", () => {
  const empty = { updatedAt: "2026-10-20T09:00:00.000Z" };

  it("creates its one document under the fixed id", async () => {
    expect(
      await createViaTransport("workspace.buy_a_feature_game", { id: BUY_A_FEATURE_ID, ...empty })
    ).toEqual({ id: BUY_A_FEATURE_ID });
    expect(useWorkspaceStore.getState().buyAFeatureGames?.map((d) => d.id)).toEqual([
      BUY_A_FEATURE_ID,
    ]);
    expect(action("workspace.buy_a_feature_game.create").description).toContain(BUY_A_FEATURE_ID);
  });

  it("refuses an id-less create, or another id", async () => {
    await expect(createViaTransport("workspace.buy_a_feature_game", empty)).rejects.toThrow(
      /rejected/
    );
    await expect(
      createViaTransport("workspace.buy_a_feature_game", { ...empty, id: "buyAFeature_x" })
    ).rejects.toThrow(/rejected/);
    expect(useWorkspaceStore.getState().buyAFeatureGames ?? []).toEqual([]);
  });

  it("refuses a create when the game exists, in the tab and over MCP", async () => {
    useWorkspaceStore.setState({ buyAFeatureGames: [BUY_A_FEATURE_GAME] });
    await expect(
      createViaTransport("workspace.buy_a_feature_game", { id: BUY_A_FEATURE_ID, ...empty })
    ).rejects.toThrow(/already exists/);
    expect(useWorkspaceStore.getState().buyAFeatureGames).toEqual([BUY_A_FEATURE_GAME]);

    vi.mocked(serverStore.serverGetEntity).mockResolvedValueOnce(BUY_A_FEATURE_GAME);
    await expect(
      createViaTransport("workspace.buy_a_feature_game", { id: BUY_A_FEATURE_ID, ...empty }, true)
    ).rejects.toThrow(/already exists/);
    expect(upsertEntity).not.toHaveBeenCalled();
  });

  it("update still works on the document", async () => {
    useWorkspaceStore.setState({ buyAFeatureGames: [BUY_A_FEATURE_GAME] });
    const result = await action("workspace.buy_a_feature_game.update").handler(
      { id: BUY_A_FEATURE_ID, patch: { players: 6 } },
      makeContext("u", "agent")
    );
    expect(result).toEqual({ updated: true });
    expect(useWorkspaceStore.getState().buyAFeatureGames).toEqual([
      { ...BUY_A_FEATURE_GAME, players: 6 },
    ]);
  });
});

describe("the new collections' CRUD", () => {
  it.each([
    [
      "workspace.allocation_round",
      ALLOCATION_ROUND,
      /^allocationRound_[\w-]{8}$/,
      "allocationRounds",
    ],
    ["workspace.weighted_matrix", MATRIX, /^weightedMatrix_[\w-]{8}$/, "weightedMatrices"],
    ["workspace.weighted_criterion", CRITERION, /^weightedCrit_[\w-]{8}$/, "weightedCriteria"],
  ] as const)("%s mints its own id", async (toolId, doc, idPattern, slice) => {
    const rest: Record<string, unknown> = { ...doc };
    delete rest.id;
    const result = (await action(`${toolId}.create`).handler(
      { entity: rest },
      makeContext("u", "agent")
    )) as { id: string };
    expect(result.id).toMatch(idPattern);
    expect((useWorkspaceStore.getState()[slice] as Doc[])[0]).toEqual({ ...rest, id: result.id });
  });

  it.each([
    ["workspace.allocation_round", ALLOCATION_ROUND_KIND, ALLOCATION_ROUND],
    ["workspace.buy_a_feature_game", BUY_A_FEATURE_KIND, BUY_A_FEATURE_GAME],
    ["workspace.weighted_matrix", WEIGHTED_MATRIX_KIND, MATRIX],
    ["workspace.weighted_criterion", "workspace:weightedCriterion", CRITERION],
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

describe("deleting a weighted matrix or criterion leaves the same rows on both transports", () => {
  type Rows = {
    matrices: WeightedMatrix[];
    options: WeightedOption[];
    criteria: WeightedCriterion[];
  };
  const SEED: Rows = {
    matrices: [MATRIX],
    options: [OPTION, LEGACY_OPTION, DEFAULT_OPTION],
    criteria: [CRITERION, LEGACY_CRITERION],
  };
  const byId = <T extends Doc>(docs: readonly T[] | undefined) =>
    [...(docs ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  /** The verb in the tab, on the store. */
  async function inTab(verb: string, id: string): Promise<Rows> {
    useWorkspaceStore.setState({
      weightedMatrices: structuredClone(SEED.matrices),
      weightedOptions: structuredClone(SEED.options),
      weightedCriteria: structuredClone(SEED.criteria),
    });
    await action(verb).handler({ id }, makeContext("u", "agent"));
    const s = useWorkspaceStore.getState();
    return {
      matrices: byId(s.weightedMatrices),
      options: byId(s.weightedOptions),
      criteria: byId(s.weightedCriteria),
    };
  }

  /** The verb over MCP, on an in-memory user_entities (kind → id → payload). */
  async function overMcp(verb: string, id: string): Promise<Rows> {
    const db = new Map<string, Map<string, Doc>>([
      [WEIGHTED_MATRIX_KIND, new Map(SEED.matrices.map((d) => [d.id, structuredClone(d)]))],
      [WEIGHTED_OPTION_KIND, new Map(SEED.options.map((d) => [d.id, structuredClone(d)]))],
      [WEIGHTED_CRITERION_KIND, new Map(SEED.criteria.map((d) => [d.id, structuredClone(d)]))],
    ]);
    const table = (kind: string) => db.get(kind) ?? new Map<string, Doc>();
    const rows = <T>(kind: string) => Array.from(table(kind).values()) as T[];
    vi.mocked(serverStore.serverListEntities).mockImplementation(
      async (_user, kind) => rows(kind) as never
    );
    vi.mocked(serverStore.serverDeleteEntity).mockImplementation(async (_user, kind, docId) => {
      table(kind).delete(docId);
    });
    vi.mocked(serverStore.serverBulkUpsertEntities).mockImplementation(
      async (_user, kind, docs) => {
        for (const d of docs) table(kind).set(d.id, d);
      }
    );
    await action(verb).mcpHandler!({ id }, makeContext("u", "mcp"));
    return {
      matrices: byId(rows<WeightedMatrix>(WEIGHTED_MATRIX_KIND)),
      options: byId(rows<WeightedOption>(WEIGHTED_OPTION_KIND)),
      criteria: byId(rows<WeightedCriterion>(WEIGHTED_CRITERION_KIND)),
    };
  }

  afterEach(() => {
    vi.mocked(serverStore.serverListEntities).mockImplementation(async () => []);
    vi.mocked(serverStore.serverDeleteEntity).mockImplementation(async () => {});
    vi.mocked(serverStore.serverBulkUpsertEntities).mockImplementation(async () => {});
  });

  it("a named matrix takes its options and criteria, and their scores, with it", async () => {
    const tab = await inTab("workspace.weighted_matrix.delete", MATRIX.id);
    expect(tab).toEqual({
      matrices: [],
      // The legacy option loses its stray score for the removed criterion.
      options: byId([{ ...LEGACY_OPTION, scores: { "crit-legacy": 4 } }, DEFAULT_OPTION]),
      criteria: [LEGACY_CRITERION],
    });
    expect(await overMcp("workspace.weighted_matrix.delete", MATRIX.id)).toEqual(tab);
  });

  it("the default matrix takes the rows without a matrixId", async () => {
    const tab = await inTab("workspace.weighted_matrix.delete", DEFAULT_WEIGHTED_MATRIX_ID);
    expect(tab).toEqual({ matrices: [MATRIX], options: [OPTION], criteria: [CRITERION] });
    expect(await overMcp("workspace.weighted_matrix.delete", DEFAULT_WEIGHTED_MATRIX_ID)).toEqual(
      tab
    );
  });

  it("a criterion takes its score off every option", async () => {
    const tab = await inTab("workspace.weighted_criterion.delete", CRITERION.id);
    expect(tab).toEqual({
      matrices: [MATRIX],
      options: byId([
        { ...OPTION, scores: { weightedCrit_speed: 9 } },
        { ...LEGACY_OPTION, scores: { "crit-legacy": 4 } },
        DEFAULT_OPTION,
      ]),
      criteria: [LEGACY_CRITERION],
    });
    expect(await overMcp("workspace.weighted_criterion.delete", CRITERION.id)).toEqual(tab);
  });

  it("the delete verbs say what else goes", () => {
    expect(action("workspace.weighted_matrix.delete").description).toMatch(
      /options and criteria in it.*weightedMatrix:default/
    );
    expect(action("workspace.weighted_criterion.delete").description).toMatch(
      /score from every option/
    );
  });

  it("a row's matrixId is never empty", () => {
    rejects("workspace.weighted_option", { ...OPTION, matrixId: "" });
    rejects("workspace.weighted_criterion", { ...CRITERION, matrixId: "" });
  });
});
