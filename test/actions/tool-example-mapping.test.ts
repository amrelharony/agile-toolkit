/**
 * tool.example_mapping.* action coverage.
 *
 *   1. registration: list_state reads; the six writes run without a
 *      confirmation, each with an MCP handler, and none is kept from
 *      visitors (it's the visitor's own data)
 *   2. list_state: maps newest first with counts, signals and which rules
 *      were split, a junk row read safely
 *   3. add_rule / add_example / add_question within the caps, refused for
 *      an unknown map, a missing rule or a full list
 *   4. answer_question and set_verdict
 *   5. send_to_story: refused with no story, criteria and scenarios written
 *      once, and on the server through the stamped story write
 *   6. one synced row: a write that would grow a map past
 *      ENTITY_ROW_MAX_BYTES (3-byte text) is refused with 'too_big', in the
 *      browser and on the server, and nothing is written
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ENTITY_ROW_MAX_BYTES,
  EXAMPLE_MAP_KIND,
  type ExampleMap,
  type Story,
} from "@/lib/stores/workspace-types";
import { GWT_MAX, MAP_TOO_BIG, withExample } from "@/lib/example-mapping/model";
import { jsonBytes } from "@/lib/utils/json-bytes";

import "@/lib/actions/tools/example-mapping";

const ctx = () => ({
  userId: "test-user",
  source: "agent" as const,
  squadProfileIds: [] as string[],
});
const ws = () => useWorkspaceStore.getState();
const run = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.handler(params, ctx())) as T;
const runMcp = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.mcpHandler!(params, ctx())) as T;

const map = (over: Partial<ExampleMap> = {}): ExampleMap => ({
  id: "exmap_a",
  title: "Pay with a saved card",
  rules: [{ id: "r1", text: "An expired card is refused" }],
  examples: [],
  questions: [],
  createdAt: "2026-11-20T09:00:00.000Z",
  updatedAt: "2026-11-20T09:00:00.000Z",
  ...over,
});
const story = (over: Partial<Story> = {}): Story => ({
  id: "st1",
  title: "Pay with a saved card",
  status: "backlog",
  ...over,
});
const stored = (id = "exmap_a") => (ws().exampleMaps ?? []).find((m) => m.id === id);

beforeEach(() => {
  useWorkspaceStore.setState({ exampleMaps: [], stories: [] });
  vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
  vi.mocked(serverStore.serverUpsertEntity)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

describe("tool.example_mapping: registration", () => {
  it("reads with list_state and writes with six verbs, each with an MCP handler", () => {
    expect(registry.get("tool.example_mapping.list_state")?.category).toBe("read");
    for (const name of [
      "add_rule",
      "add_example",
      "add_question",
      "answer_question",
      "set_verdict",
      "send_to_story",
    ]) {
      const action = registry.get(`tool.example_mapping.${name}`);
      expect(action?.category, name).toBe("write");
      expect(action?.requiresConfirmation, name).toBe(false);
      expect(action?.mcpHandler, name).toBeTypeOf("function");
      expect(action?.visitor, name).not.toBe(false);
    }
  });
});

describe("tool.example_mapping.list_state", () => {
  it("lists maps newest first with counts, signals and split rules", async () => {
    ws().upsertStory(story({ id: "st_split" }));
    ws().upsertExampleMap(map({ id: "exmap_old" }));
    ws().upsertExampleMap(
      map({
        id: "exmap_new",
        updatedAt: "2026-11-21T09:00:00.000Z",
        rules: [
          {
            id: "r1",
            text: "Rule",
            sentTo: [
              { route: "backlog-story", targetId: "st_split", at: "2026-11-21T09:00:00.000Z" },
            ],
          },
        ],
        questions: [{ id: "q1", text: "Who?", status: "open" }],
      })
    );
    const r = await run<{
      total: number;
      maps: {
        id: string;
        counts: { open: number };
        signals: string[];
        rules: { splitInto: string | null }[];
      }[];
    }>("tool.example_mapping.list_state");
    expect(r.total).toBe(2);
    expect(r.maps.map((m) => m.id)).toEqual(["exmap_new", "exmap_old"]);
    expect(r.maps[0].counts.open).toBe(1);
    expect(r.maps[0].rules[0].splitInto).toBe("st_split");
    expect(r.maps[0].signals.some((s) => s.includes("no example"))).toBe(true);
  });

  it("reads the user's rows on the server, junk included", async () => {
    vi.mocked(serverStore.serverListEntities).mockImplementation(async (_u, kind) =>
      kind === EXAMPLE_MAP_KIND ? ([map(), { id: 3 }] as never) : []
    );
    const r = await runMcp<{ maps: unknown[] }>("tool.example_mapping.list_state");
    expect(r.maps).toHaveLength(1);
  });
});

describe("adding cards", () => {
  beforeEach(() => ws().upsertExampleMap(map()));

  it("adds a rule, an example (as Given/When/Then) and a question", async () => {
    const rule = await run<{ added: boolean; ruleId: string }>("tool.example_mapping.add_rule", {
      mapId: "exmap_a",
      text: "Only the holder saves a card",
    });
    expect(rule.added).toBe(true);
    const ex = await run<{ added: boolean }>("tool.example_mapping.add_example", {
      mapId: "exmap_a",
      ruleId: rule.ruleId,
      text: "Ana saves her own card",
      given: "Ana is signed in",
      when: "she saves her card",
      then: "it is on her account",
    });
    expect(ex.added).toBe(true);
    const q = await run<{ added: boolean }>("tool.example_mapping.add_question", {
      mapId: "exmap_a",
      text: "Business accounts?",
      ruleId: rule.ruleId,
      owner: "Priya",
    });
    expect(q.added).toBe(true);
    const m = stored()!;
    expect(m.rules).toHaveLength(2);
    expect(m.examples[0]).toMatchObject({ given: "Ana is signed in", ruleId: rule.ruleId });
    expect(m.questions[0]).toMatchObject({ owner: "Priya", status: "open" });
    expect(m.updatedAt).not.toBe("2026-11-20T09:00:00.000Z");
  });

  it("refuses an unknown map, a missing rule, half a scenario and a full map", async () => {
    expect(await run("tool.example_mapping.add_rule", { mapId: "nope", text: "x" })).toMatchObject({
      added: false,
      reason: "not_found",
    });
    expect(
      await run("tool.example_mapping.add_example", {
        mapId: "exmap_a",
        ruleId: "ghost",
        text: "x",
      })
    ).toMatchObject({ added: false, reason: "refused" });
    const schema = registry.get("tool.example_mapping.add_example")!.paramsSchema;
    expect(
      schema.safeParse({ mapId: "exmap_a", ruleId: "r1", text: "x", given: "g" }).success
    ).toBe(false);
    ws().upsertExampleMap(
      map({ rules: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, text: `Rule ${i}` })) })
    );
    expect(
      await run("tool.example_mapping.add_rule", { mapId: "exmap_a", text: "Thirteenth" })
    ).toMatchObject({ added: false, reason: "full" });
  });
});

describe("answering and deciding", () => {
  beforeEach(() =>
    ws().upsertExampleMap(map({ questions: [{ id: "q1", text: "Who?", status: "open" }] }))
  );

  it("answers a question, drops one, and refuses an answer with no words", async () => {
    expect(
      await run("tool.example_mapping.answer_question", {
        mapId: "exmap_a",
        questionId: "q1",
        answer: "The holder.",
      })
    ).toMatchObject({ updated: true, status: "answered", open: 0 });
    expect(stored()!.questions[0].answer).toBe("The holder.");
    ws().upsertExampleMap(map({ questions: [{ id: "q1", text: "Who?", status: "open" }] }));
    expect(
      await run("tool.example_mapping.answer_question", {
        mapId: "exmap_a",
        questionId: "q1",
        status: "answered",
      })
    ).toMatchObject({ updated: false, reason: "refused" });
    expect(
      await run("tool.example_mapping.answer_question", {
        mapId: "exmap_a",
        questionId: "q1",
        status: "dropped",
      })
    ).toMatchObject({ updated: true, status: "dropped" });
  });

  it("sets and clears the verdict", async () => {
    await run("tool.example_mapping.set_verdict", { mapId: "exmap_a", verdict: "split" });
    expect(stored()!.verdict).toBe("split");
    await run("tool.example_mapping.set_verdict", { mapId: "exmap_a", verdict: null });
    expect(stored()!.verdict).toBeUndefined();
  });
});

describe("tool.example_mapping.send_to_story", () => {
  const sendable = () =>
    map({
      storyId: "st1",
      examples: [
        {
          id: "e1",
          ruleId: "r1",
          text: "A",
          given: "an expired card",
          when: "I pay",
          then: "it is refused",
        },
      ],
    });

  it("refuses a map with no story, and an example map", async () => {
    ws().upsertExampleMap(map());
    expect(await run("tool.example_mapping.send_to_story", { mapId: "exmap_a" })).toMatchObject({
      sent: false,
      reason: "no_story",
    });
    ws().upsertExampleMap(map({ id: "example-map", storyId: "st1" }));
    expect(await run("tool.example_mapping.send_to_story", { mapId: "example-map" })).toMatchObject(
      {
        sent: false,
        reason: "example",
      }
    );
  });

  it("writes the rules and scenarios once, and marks the map sent", async () => {
    ws().upsertStory(story());
    ws().upsertExampleMap(sendable());
    expect(await run("tool.example_mapping.send_to_story", { mapId: "exmap_a" })).toMatchObject({
      sent: true,
      rules: 1,
      examples: 1,
    });
    const s = ws().stories.find((x) => x.id === "st1")!;
    expect(s.acceptanceCriteria).toBe("- An expired card is refused");
    expect(s.gwt).toHaveLength(1);
    expect(stored()!.sentAt).toBeTruthy();
    await run("tool.example_mapping.send_to_story", { mapId: "exmap_a" });
    expect(ws().stories.find((x) => x.id === "st1")!.gwt).toHaveLength(1);
  });

  it("writes the story on the server through the stamped story write", async () => {
    vi.mocked(serverStore.serverGetEntity).mockImplementation(
      async (_u, kind, id) =>
        (kind === EXAMPLE_MAP_KIND ? sendable() : id === "st1" ? story() : null) as never
    );
    const r = await runMcp<{ sent: boolean }>("tool.example_mapping.send_to_story", {
      mapId: "exmap_a",
    });
    expect(r.sent).toBe(true);
    const writes = vi.mocked(serverStore.serverUpsertEntity).mock.calls;
    const storyWrite = writes.find((c) => c[1] === "workspace:story")?.[2] as Story;
    expect(storyWrite.acceptanceCriteria).toBe("- An expired card is refused");
    expect(storyWrite.refinedAt).toBeTruthy();
    const mapWrite = writes.find((c) => c[1] === EXAMPLE_MAP_KIND)?.[2] as ExampleMap;
    expect(mapWrite.sentAt).toBeTruthy();
  });
});

describe("a map the CRUD took with more than ten examples under a rule", () => {
  it("keeps them all through a verb's write, and lists them", async () => {
    const examples = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      ruleId: "r1",
      text: `Example ${i + 1}`,
    }));
    ws().upsertExampleMap(map({ examples }));
    await run("tool.example_mapping.set_verdict", { mapId: "exmap_a", verdict: "split" });
    expect(stored()!.examples).toHaveLength(12);
    const listed = await run<{ maps: { rules: { examples: unknown[] }[] }[] }>(
      "tool.example_mapping.list_state"
    );
    expect(listed.maps[0].rules[0].examples).toHaveLength(12);
    // A thirteenth under that rule is still refused.
    expect(
      await run("tool.example_mapping.add_example", { mapId: "exmap_a", ruleId: "r1", text: "13" })
    ).toMatchObject({ added: false, reason: "refused" });
  });
});

describe("one synced row", () => {
  // 3-byte text (CJK): a map at its caps passes one row.
  const cjk = (n: number) => "漢".repeat(n);
  const full = (ruleId: string) => ({
    ruleId,
    text: cjk(200),
    given: cjk(GWT_MAX),
    when: cjk(GWT_MAX),
    then: cjk(GWT_MAX),
  });
  const sixRules = () =>
    map({
      storyId: "st1",
      rules: Array.from({ length: 6 }, (_, i) => ({ id: `r${i + 1}`, text: `Rule ${i + 1}` })),
      questions: [{ id: "q1", text: "Who?", status: "open" }],
    });
  /** Full examples while one more still fits the row: the next full one doesn't. */
  const nearlyFull = (): ExampleMap => {
    let m = sixRules();
    for (let i = 0; ; i++) {
      const next = withExample(m, full(`r${Math.floor(i / 10) + 1}`), `ex_${i}`, m.updatedAt);
      if (!next || jsonBytes(next) > ENTITY_ROW_MAX_BYTES) return m;
      m = next;
    }
  };
  /** Sixty full examples: already past one row, as a map stored before this check could be. */
  const overFull = (): ExampleMap => {
    let m = sixRules();
    for (let i = 0; i < 60; i++) {
      m = withExample(m, full(`r${Math.floor(i / 10) + 1}`), `ex_${i}`, m.updatedAt)!;
    }
    return m;
  };
  const refused = (r: unknown) =>
    expect(r).toMatchObject({ reason: "too_big", message: MAP_TOO_BIG });

  it("refuses an example that would take the map past the row, and writes nothing", async () => {
    const m = nearlyFull();
    expect(jsonBytes(m)).toBeLessThanOrEqual(ENTITY_ROW_MAX_BYTES);
    ws().upsertExampleMap(m);
    const ruleId = `r${Math.floor(m.examples.length / 10) + 1}`;
    const r = await run("tool.example_mapping.add_example", { mapId: "exmap_a", ...full(ruleId) });
    expect(r).toMatchObject({ added: false });
    refused(r);
    expect(stored()!.examples).toHaveLength(m.examples.length);
    // A small change that still fits goes through.
    expect(
      await run("tool.example_mapping.add_rule", { mapId: "exmap_a", text: "Short rule" })
    ).toMatchObject({ added: true });
  });

  it("refuses every growing write on a map already past the row", async () => {
    const m = overFull();
    expect(jsonBytes(m)).toBeGreaterThan(ENTITY_ROW_MAX_BYTES);
    ws().upsertExampleMap(m);
    ws().upsertStory(story());
    const before = JSON.stringify(stored());
    refused(await run("tool.example_mapping.add_rule", { mapId: "exmap_a", text: "One more" }));
    refused(
      await run("tool.example_mapping.add_question", { mapId: "exmap_a", text: "And this?" })
    );
    refused(
      await run("tool.example_mapping.answer_question", {
        mapId: "exmap_a",
        questionId: "q1",
        answer: cjk(1000),
      })
    );
    refused(await run("tool.example_mapping.set_verdict", { mapId: "exmap_a", verdict: "split" }));
    refused(await run("tool.example_mapping.send_to_story", { mapId: "exmap_a" }));
    expect(JSON.stringify(stored())).toBe(before);
    // send_to_story checks first: the story isn't written either.
    expect(ws().stories.find((x) => x.id === "st1")!.acceptanceCriteria).toBeUndefined();
  });

  it("refuses on the server too, with no row written", async () => {
    const m = nearlyFull();
    vi.mocked(serverStore.serverGetEntity).mockImplementation(
      async (_u, kind) => (kind === EXAMPLE_MAP_KIND ? m : null) as never
    );
    const ruleId = `r${Math.floor(m.examples.length / 10) + 1}`;
    refused(
      await runMcp("tool.example_mapping.add_example", { mapId: "exmap_a", ...full(ruleId) })
    );
    expect(serverStore.serverUpsertEntity).not.toHaveBeenCalled();
  });
});
