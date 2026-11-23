/**
 * tool.kickoff.* action coverage.
 *
 *   1. registration: list_state reads; start, add_items, set_sliders and
 *      set_status write without a confirmation, each with an MCP handler,
 *      and none is kept from visitors (it's the visitor's own data)
 *   2. list_state: every kickoff with its sections, sliders and what's still
 *      open, newest change first; the totals and the team's purpose leave
 *      examples out; a malformed row is skipped
 *   3. start: a Team Canvas's people from the roster (examples left out),
 *      the default sliders for an Inception deck
 *   4. add_items: within the room, no repeats, single answers and their
 *      replace, owners only where a section has them; every refusal named
 *   5. set_sliders / set_status: the order and its stamp, agree and back
 *   6. the MCP path reads and writes the user's rows, the roster included
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
import { changedSinceAgreed, normalizeKickoff } from "@/lib/kickoff/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KICKOFF_KIND,
  type Kickoff,
  type KickoffItem,
  type TeamMember,
} from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";

import "@/lib/actions/tools/kickoff";

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

const AT = "2026-11-20T09:00:00.000Z";
const LATER = "2026-11-21T09:00:00.000Z";

function kickoff(over: Partial<Kickoff> & Pick<Kickoff, "id" | "format">): Kickoff {
  return {
    title: "Payments liftoff",
    sections: {},
    status: "draft",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}
const item = (id: string, text: string, over: Partial<KickoffItem> = {}): KickoffItem => ({
  id,
  text,
  ...over,
});
const stored = (id: string) => (ws().kickoffs ?? []).find((k) => k.id === id);

beforeEach(() => {
  useWorkspaceStore.setState({ kickoffs: [], teamMembers: [] });
  vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
  vi.mocked(serverStore.serverUpsertEntity)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

describe("tool.kickoff: registration", () => {
  it("reads with list_state and writes with start, add_items, set_sliders and set_status", () => {
    expect(registry.get("tool.kickoff.list_state")?.category).toBe("read");
    for (const name of ["start", "add_items", "set_sliders", "set_status"]) {
      const action = registry.get(`tool.kickoff.${name}`);
      expect(action?.category, name).toBe("write");
      expect(action?.requiresConfirmation, name).toBe(false);
      expect(action?.mcpHandler, name).toBeTypeOf("function");
      // Nothing here reaches other people: the visitor flag keeps its default.
      expect(action?.visitor, name).toBeUndefined();
    }
    expect(registry.get("tool.kickoff.list_state")?.mcpHandler).toBeTypeOf("function");
  });

  it("calls the format Team Canvas, as the page does", () => {
    expect(registry.get("tool.kickoff.list_state")!.description).toContain("Team Canvas");
    expect(registry.get("tool.kickoff.start")!.description).toContain("Team Canvas");
  });
});

describe("tool.kickoff.list_state", () => {
  it("lists every kickoff newest first, leaving examples out of the totals and the purpose", async () => {
    useWorkspaceStore.setState({
      kickoffs: [
        kickoff({
          id: "canvas",
          format: "team-canvas",
          status: "agreed",
          agreedAt: AT,
          sections: {
            purpose: [item("p", "Make paying easy")],
            people: [item("a", "", { owner: "Ana" })],
          },
        }),
        kickoff({
          id: exampleId("deck"),
          format: "inception",
          updatedAt: LATER,
          sections: {
            worries: [item("w", "Slow partner", { likelihood: 4, impact: 5 })],
            needs: [item("n", "A contact", { covers: "w", owner: "Omar" })],
          },
          sliders: [
            { id: "s1", label: "Date", position: 1 },
            { id: "s2", label: "Scope", position: 2 },
          ],
        }),
        { id: "junk" } as unknown as Kickoff,
      ],
    });
    const state = await run<{
      total: number;
      byFormat: Record<string, number>;
      teamPurpose: { kickoffId: string; text: string } | null;
      kickoffs: {
        id: string;
        example: boolean;
        formatName: string;
        sections: { id: string; count: number; max: number; items: Record<string, unknown>[] }[];
        sliders: { label: string; position: number }[] | null;
        slidersSet: boolean;
        gaps: string[];
        statement: string | null;
      }[];
    }>("tool.kickoff.list_state");
    expect(state.total).toBe(1);
    expect(state.byFormat).toMatchObject({ "team-canvas": 1, inception: 0 });
    expect(state.teamPurpose).toEqual({ kickoffId: "canvas", text: "Make paying easy" });
    expect(state.kickoffs.map((k) => [k.id, k.example])).toEqual([
      [exampleId("deck"), true],
      ["canvas", false],
    ]);
    const [deck, canvas] = state.kickoffs;
    expect(deck.formatName).toBe("Inception deck");
    const worries = deck.sections.find((s) => s.id === "worries")!;
    expect(worries).toMatchObject({ count: 1, max: 20 });
    expect(worries.items[0]).toMatchObject({
      likelihood: 4,
      impact: 5,
      rated: true,
      covered: true,
    });
    expect(deck.sections.find((s) => s.id === "needs")!.items[0]).toMatchObject({
      owner: "Omar",
      covers: "w",
    });
    expect(deck.sliders).toEqual([
      { label: "Date", position: 1, note: null },
      { label: "Scope", position: 2, note: null },
    ]);
    expect(deck.slidersSet).toBe(false);
    expect(deck.gaps).toContain("Put the trade-offs in order: nobody has set it yet.");
    expect(canvas.formatName).toBe("Team Canvas");
    expect(canvas.sliders).toBeNull();
    expect(canvas.gaps).toContain("Ana has no role yet.");
    expect(canvas.statement).toBeNull();
  });

  it("reports no worry for a line whose worry was deleted, and keeps the link through a write", async () => {
    useWorkspaceStore.setState({
      kickoffs: [
        kickoff({
          id: "deck",
          format: "inception",
          sections: {
            worries: [],
            needs: [item("n", "A contact", { covers: "w", owner: "Omar" })],
          },
        }),
      ],
    });
    type State = { kickoffs: { sections: { id: string; items: Record<string, unknown>[] }[] }[] };
    const needs = (s: State) => s.kickoffs[0].sections.find((x) => x.id === "needs")!.items[0];
    expect(needs(await run<State>("tool.kickoff.list_state"))).toMatchObject({ covers: null });
    // A verb's write keeps the id, so the worry's Undo finds its cover again.
    await run("tool.kickoff.add_items", {
      kickoffId: "deck",
      section: "in-scope",
      items: [{ text: "Tap to pay" }],
    });
    const saved = ws().kickoffs!.find((k) => k.id === "deck")!;
    expect(saved.sections.needs[0].covers).toBe("w");
    useWorkspaceStore.setState({
      kickoffs: [
        {
          ...saved,
          sections: {
            ...saved.sections,
            worries: [item("w", "Slow partner", { likelihood: 4, impact: 5 })],
          },
        },
      ],
    });
    expect(needs(await run<State>("tool.kickoff.list_state"))).toMatchObject({ covers: "w" });
  });

  it("gives a problem framing's statement, typed or built", async () => {
    useWorkspaceStore.setState({
      kickoffs: [
        kickoff({
          id: "pf",
          format: "problem-framing",
          sections: { who: [item("a", "Buyers")], what: [item("b", "Refunds are slow")] },
        }),
      ],
    });
    const state = await run<{ kickoffs: { statement: string | null }[] }>(
      "tool.kickoff.list_state"
    );
    expect(state.kickoffs[0].statement).toBe("For buyers, refunds are slow.");
  });
});

describe("tool.kickoff.start", () => {
  it("starts a Team Canvas with the roster's people, examples left out", async () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana", role: "Product Owner" },
        { id: exampleId("m2"), name: "Example Eve" },
        { id: "m3", name: "Bo" },
      ],
    });
    const r = await run<{ created: true; kickoffId: string }>("tool.kickoff.start", {
      format: "team-canvas",
      title: "Checkout squad",
      brief: "A new squad.",
      date: "2026-11-24",
    });
    expect(r.created).toBe(true);
    expect(r.kickoffId).toMatch(/^kickoff_/);
    const k = stored(r.kickoffId)!;
    expect(k).toMatchObject({
      title: "Checkout squad",
      format: "team-canvas",
      brief: "A new squad.",
      date: "2026-11-24",
      status: "draft",
    });
    expect(k.sections.people.map((p) => [p.owner, p.text])).toEqual([
      ["Ana", "Product Owner"],
      ["Bo", ""],
    ]);
    expect(k.createdAt).toBe(k.updatedAt);
  });

  it("starts an Inception deck with the default sliders, unordered yet", async () => {
    const r = await run<{ kickoffId: string }>("tool.kickoff.start", {
      format: "inception",
      title: "Tap to pay",
    });
    const k = stored(r.kickoffId)!;
    expect(k.sliders?.map((s) => s.label)).toEqual(["Scope", "Date", "Cost", "Quality"]);
    expect(k.slidersSetAt).toBeUndefined();
  });

  it("refuses an unknown format or no title at the schema", () => {
    const schema = registry.get("tool.kickoff.start")!.paramsSchema;
    expect(schema.safeParse({ format: "idea", title: "x" }).success).toBe(false);
    expect(schema.safeParse({ format: "inception", title: " " }).success).toBe(false);
  });
});

describe("tool.kickoff.add_items", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      kickoffs: [
        kickoff({
          id: "map",
          format: "alignment-map",
          sections: {
            mission: [item("m", "By spring, we ship.")],
            objectives: [item("o1", "A pilot")],
          },
        }),
        kickoff({ id: exampleId("ex"), format: "alignment-map" }),
        kickoff({ id: "canvas", format: "team-canvas" }),
      ],
    });
  });

  it("adds lines within the room, skipping repeats, and stamps the kickoff", async () => {
    const r = await run("tool.kickoff.add_items", {
      kickoffId: "map",
      section: "objectives",
      items: [{ text: "Two shops live" }, { text: "a  pilot" }, { text: "Three shops live" }],
    });
    expect(r).toEqual({ added: 2, skipped: 1 });
    const k = stored("map")!;
    expect(k.sections.objectives.map((i) => i.text)).toEqual([
      "A pilot",
      "Two shops live",
      "Three shops live",
    ]);
    expect(k.updatedAt > AT).toBe(true);
  });

  it("says when the section is full", async () => {
    const r = await run<{ added: number; reason?: string }>("tool.kickoff.add_items", {
      kickoffId: "map",
      section: "objectives",
      items: Array.from({ length: 10 }, (_, i) => ({ text: `Result ${i}` })),
    });
    expect(r).toEqual({ added: 10, skipped: 0 });
    const more = await run<{ added: number; skipped: number; reason?: string }>(
      "tool.kickoff.add_items",
      {
        kickoffId: "map",
        section: "objectives",
        items: [{ text: "Result 10" }, { text: "Result 11" }, { text: "Result 12" }],
      }
    );
    // 12 at most: one line had room.
    expect(more).toEqual({ added: 1, skipped: 2, reason: "full" });
    const none = await run("tool.kickoff.add_items", {
      kickoffId: "map",
      section: "objectives",
      items: [{ text: "Result 13" }],
    });
    expect(none).toEqual({ added: 0, skipped: 1, reason: "full" });
  });

  it("keeps a single answer unless told to replace it", async () => {
    expect(
      await run("tool.kickoff.add_items", {
        kickoffId: "map",
        section: "mission",
        items: [{ text: "A new aim" }],
      })
    ).toEqual({ added: 0, skipped: 1, reason: "single_filled" });
    expect(
      await run("tool.kickoff.add_items", {
        kickoffId: "map",
        section: "mission",
        items: [{ text: "A new aim" }],
        replace: true,
      })
    ).toEqual({ added: 1, skipped: 0 });
    expect(stored("map")!.sections.mission.map((i) => i.text)).toEqual(["A new aim"]);
  });

  it("keeps owners only where the section has them, and a person with no role yet", async () => {
    await run("tool.kickoff.add_items", {
      kickoffId: "map",
      section: "commitments",
      items: [{ text: "Talk to the partner", owner: "Omar" }],
    });
    await run("tool.kickoff.add_items", {
      kickoffId: "map",
      section: "resources",
      items: [{ text: "A test phone", owner: "Lena" }],
    });
    const k = stored("map")!;
    expect(k.sections.commitments[0]).toMatchObject({ text: "Talk to the partner", owner: "Omar" });
    expect(k.sections.resources[0].owner).toBeUndefined();
    expect(
      await run("tool.kickoff.add_items", {
        kickoffId: "canvas",
        section: "people",
        items: [{ text: "", owner: "Ana" }, { text: "" }],
      })
    ).toEqual({ added: 1, skipped: 1 });
    expect(stored("canvas")!.sections.people).toEqual([
      expect.objectContaining({ text: "", owner: "Ana" }),
    ]);
  });

  it("names every refusal and writes nothing", async () => {
    const add = (kickoffId: string, section: string) =>
      run("tool.kickoff.add_items", { kickoffId, section, items: [{ text: "x" }] });
    expect(await add("nope", "objectives")).toEqual({ added: 0, skipped: 1, reason: "not_found" });
    expect(await add(exampleId("ex"), "objectives")).toEqual({
      added: 0,
      skipped: 1,
      reason: "example",
    });
    expect(await add("map", "purpose")).toEqual({
      added: 0,
      skipped: 1,
      reason: "unknown_section",
    });
    expect(stored(exampleId("ex"))!.sections).toEqual({});
  });
});

describe("tool.kickoff.set_sliders and set_status", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      kickoffs: [
        kickoff({
          id: "t",
          format: "trade-offs",
          sliders: [
            { id: "a", label: "Scope", position: 1 },
            { id: "b", label: "Date", position: 2 },
            { id: "c", label: "Cost", position: 3 },
          ],
        }),
        kickoff({ id: "map", format: "alignment-map" }),
        kickoff({ id: exampleId("t"), format: "trade-offs" }),
      ],
    });
  });

  it("puts the trade-offs in order, adding a new one, and marks the order set", async () => {
    const r = await run("tool.kickoff.set_sliders", {
      kickoffId: "t",
      order: ["date", "Easy to use"],
    });
    expect(r).toEqual({ set: true, order: ["Date", "Easy to use", "Scope", "Cost"] });
    const k = stored("t")!;
    expect(k.sliders?.map((s) => s.position)).toEqual([1, 2, 3, 4]);
    expect(k.slidersSetAt).toBeTruthy();
    expect(k.updatedAt).toBe(k.slidersSetAt);
  });

  it("refuses a format without sliders, repeats, too many and the example", async () => {
    const set = (kickoffId: string, order: string[]) =>
      run("tool.kickoff.set_sliders", { kickoffId, order });
    expect(await set("map", ["Scope", "Date"])).toEqual({ set: false, reason: "no_sliders" });
    expect(await set("t", ["Scope", "scope"])).toEqual({ set: false, reason: "duplicate" });
    expect(await set("t", ["A", "B", "C", "D", "E", "F"])).toEqual({
      set: false,
      reason: "too_many",
    });
    expect(await set(exampleId("t"), ["Scope", "Date"])).toEqual({ set: false, reason: "example" });
    expect(await set("nope", ["Scope", "Date"])).toEqual({ set: false, reason: "not_found" });
  });

  it("agrees a kickoff and puts it back to draft", async () => {
    expect(await run("tool.kickoff.set_status", { kickoffId: "map", status: "agreed" })).toEqual({
      updated: true,
      status: "agreed",
    });
    const agreed = stored("map")!;
    expect(agreed.agreedAt).toBeTruthy();
    expect(agreed.updatedAt).toBe(agreed.agreedAt);
    await run("tool.kickoff.set_status", { kickoffId: "map", status: "draft" });
    expect(stored("map")!.status).toBe("draft");
    expect(stored("map")!.agreedAt).toBeUndefined();
    expect(
      await run("tool.kickoff.set_status", { kickoffId: exampleId("t"), status: "agreed" })
    ).toEqual({ updated: false, reason: "example" });
  });

  it("agrees again a kickoff changed since it was agreed, and leaves one that wasn't", async () => {
    const changed = kickoff({
      id: "changed",
      format: "alignment-map",
      status: "agreed",
      agreedAt: AT,
      updatedAt: LATER,
    });
    const settled = kickoff({
      id: "settled",
      format: "alignment-map",
      status: "agreed",
      agreedAt: LATER,
      updatedAt: LATER,
    });
    useWorkspaceStore.setState({ kickoffs: [changed, settled] });
    expect(
      await run("tool.kickoff.set_status", { kickoffId: "changed", status: "agreed" })
    ).toEqual({ updated: true, status: "agreed" });
    const again = stored("changed")!;
    expect(again.agreedAt).not.toBe(AT);
    expect(again.updatedAt).toBe(again.agreedAt);
    expect(changedSinceAgreed(normalizeKickoff(again)!)).toBe(false);
    // Nothing changed since: no write.
    expect(
      await run("tool.kickoff.set_status", { kickoffId: "settled", status: "agreed" })
    ).toEqual({ updated: true, status: "agreed" });
    expect(stored("settled")).toEqual(settled);
  });
});

describe("tool.kickoff over MCP", () => {
  it("reads the user's rows", async () => {
    vi.mocked(serverStore.serverListEntities).mockResolvedValue([
      kickoff({ id: "k", format: "trade-offs" }),
    ] as never);
    const state = await runMcp<{ total: number }>("tool.kickoff.list_state");
    expect(state.total).toBe(1);
    expect(serverStore.serverListEntities).toHaveBeenCalledWith("test-user", KICKOFF_KIND);
  });

  it("starts a Team Canvas from the user's roster on the server", async () => {
    const roster: TeamMember[] = [
      { id: "m1", name: "Ana", role: "Tester" },
      { id: exampleId("m2"), name: "Example Eve" },
    ];
    vi.mocked(serverStore.serverListEntities).mockImplementation((async (
      _user: string,
      kind: string
    ) => (kind === "workspace:teamMember" ? roster : [])) as never);
    const r = await runMcp<{ kickoffId: string }>("tool.kickoff.start", {
      format: "team-canvas",
      title: "Squad",
    });
    const [, kind, row] = vi.mocked(serverStore.serverUpsertEntity).mock.calls[0];
    expect(kind).toBe(KICKOFF_KIND);
    expect((row as Kickoff).id).toBe(r.kickoffId);
    expect((row as Kickoff).sections.people.map((p) => p.owner)).toEqual(["Ana"]);
    // The browser's store isn't touched.
    expect(ws().kickoffs).toEqual([]);
  });

  it("adds lines to the user's row", async () => {
    vi.mocked(serverStore.serverGetEntity).mockResolvedValue(
      kickoff({ id: "k", format: "project-poster" }) as never
    );
    const r = await runMcp("tool.kickoff.add_items", {
      kickoffId: "k",
      section: "measures",
      items: [{ text: "Taps a day per shop" }],
    });
    expect(r).toEqual({ added: 1, skipped: 0 });
    expect(serverStore.serverGetEntity).toHaveBeenCalledWith("test-user", KICKOFF_KIND, "k");
    const [, , row] = vi.mocked(serverStore.serverUpsertEntity).mock.calls[0];
    expect((row as Kickoff).sections.measures.map((i) => i.text)).toEqual(["Taps a day per shop"]);
  });
});
