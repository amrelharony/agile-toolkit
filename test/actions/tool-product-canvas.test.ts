/**
 * tool.product_canvas.* action coverage.
 *
 *   1. registration: list_state reads; create_canvas, add_items,
 *      update_item and set_field write without a confirmation, each with an
 *      MCP handler, and none is kept from visitors (it's their own data);
 *      no description says "board" or "sticky" (the whiteboard's words)
 *   2. list_state: the goal, the vision, every canvas newest first (the
 *      example marked and left out of the total), a format filter, and one
 *      canvas in full with what its format works out
 *   3. create_canvas: a named canvas in a format, from the Product Goal
 *      when asked (no AI), with the CRUD's id prefix
 *   4. add_items / update_item / set_field: the model's writes and
 *      refusals (an unknown box, a one-line box through add_items, a full
 *      box or canvas, links outside their boxes, a past launch date)
 *   5. the MCP path reads and writes the user's rows, and the vision from
 *      the Product Goal page's synced row
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
    serverGetUserStateBlob: vi.fn(async () => null),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  PRODUCT_CANVAS_KIND,
  PRODUCT_GOAL_KIND,
  type ProductCanvas,
  type ProductCanvasItem,
  type ProductGoal,
} from "@/lib/stores/workspace-types";
import { PRODUCT_CANVAS_ID_PREFIX } from "@/lib/product-canvas/model";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { PRODUCT_GOAL_STORE_KEY } from "@/lib/product-goal/prefs";

import "@/lib/actions/tools/product-canvas";
import "@/lib/actions/workspace";

const ctx = () => ({
  userId: "test-user",
  source: "agent" as const,
  squadProfileIds: [] as string[],
});
const ws = () => useWorkspaceStore.getState();
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const runMcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};
const parses = (id: string, params: Record<string, unknown>) =>
  registry.get(id)!.paramsSchema.safeParse(params).success;

const STAMP = "2026-11-20T09:00:00.000Z";
const item = (
  id: string,
  text: string,
  over: Partial<ProductCanvasItem> = {}
): ProductCanvasItem => ({
  id,
  text,
  ...over,
});
const canvas = (over: Partial<ProductCanvas> & Pick<ProductCanvas, "id">): ProductCanvas => ({
  format: "vision-board",
  title: "Tapline",
  sections: {},
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});
const goal: ProductGoal = {
  id: "goal_1",
  statement: "Shop owners take every payment on their own phone.",
  why: "Card machines cost too much.",
  measures: ["Shops with no card machine: 40% to 70%"],
  status: "active",
  createdAt: STAMP,
  updatedAt: STAMP,
};
const stored = (id: string) => (ws().productCanvases ?? []).find((c) => c.id === id);

const VERBS = ["create_canvas", "add_items", "update_item", "set_field"];

beforeEach(() => {
  useWorkspaceStore.setState({
    productCanvases: [],
    productGoals: [],
    stories: [],
    hypothesisTrackers: [],
  });
  window.localStorage.clear();
  vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
  vi.mocked(serverStore.serverUpsertEntity)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(serverStore.serverGetUserStateBlob).mockReset().mockResolvedValue(null);
});

describe("tool.product_canvas: registration", () => {
  it("reads with list_state and writes with the four verbs, each with an MCP handler", () => {
    expect(registry.get("tool.product_canvas.list_state")?.category).toBe("read");
    for (const name of ["list_state", ...VERBS]) {
      const a = registry.get(`tool.product_canvas.${name}`)!;
      expect(a.mcpHandler, name).toBeTypeOf("function");
      // The visitor's own data: nothing here reaches other people.
      expect(a.visitor, name).not.toBe(false);
      expect(a.description, name).not.toMatch(/\b(board|sticky)\b/i);
    }
    for (const name of VERBS) {
      const a = registry.get(`tool.product_canvas.${name}`)!;
      expect(a.category).toBe("write");
      expect(a.requiresConfirmation).toBe(false);
    }
  });

  it("offers every format in the catalog, and no other", () => {
    for (const format of ["lean-ux", "idea", "business-case", "shape-up"]) {
      expect(parses("tool.product_canvas.create_canvas", { format, title: "Q" })).toBe(true);
    }
    expect(parses("tool.product_canvas.create_canvas", { format: "lean-canvas", title: "Q" })).toBe(
      false
    );
  });

  it("mints canvas ids with the prefix the CRUD uses", async () => {
    const created = (await registry.get("workspace.product_canvas.create")!.handler(
      {
        entity: {
          format: "pr-faq",
          title: "News",
          sections: {},
          createdAt: STAMP,
          updatedAt: STAMP,
        },
      },
      makeContext("u", "agent")
    )) as { id: string };
    expect(created.id.startsWith(PRODUCT_CANVAS_ID_PREFIX)).toBe(true);
    const mine = await run<{ id: string }>("tool.product_canvas.create_canvas", {
      format: "pr-faq",
      title: "News",
    });
    expect(mine.id.startsWith(PRODUCT_CANVAS_ID_PREFIX)).toBe(true);
  });
});

describe("tool.product_canvas.list_state", () => {
  it("lists the goal, the vision and every canvas, the example marked and not counted", async () => {
    window.localStorage.setItem(
      PRODUCT_GOAL_STORE_KEY,
      JSON.stringify({ state: { vision: "Pay anywhere" } })
    );
    useWorkspaceStore.setState({
      productGoals: [goal],
      productCanvases: [
        canvas({
          id: "pcanvas_old",
          updatedAt: "2026-11-01T09:00:00.000Z",
          sections: { vision: [item("v", "x")] },
        }),
        canvas({ id: "example-pc", format: "pr-faq", title: "Example" }),
        canvas({
          id: "pcanvas_new",
          format: "lean-ux",
          title: "Queue",
          updatedAt: "2026-11-22T09:00:00.000Z",
        }),
        { id: "pcanvas_bad", format: "lean-canvas" } as unknown as ProductCanvas,
      ],
    });
    const out = await run<{
      goal: { id: string } | null;
      vision: string;
      total: number;
      formats: { id: string }[];
      canvases: {
        id: string;
        example: boolean;
        formatName: string;
        boxes: { filled: number };
        gaps: number;
      }[];
    }>("tool.product_canvas.list_state");
    expect(out.goal).toEqual({ id: "goal_1", statement: goal.statement });
    expect(out.vision).toBe("Pay anywhere");
    expect(out.total).toBe(2);
    expect(out.formats.map((f) => f.id)).toEqual([
      "vision-board",
      "value-proposition",
      "idea",
      "lean-ux",
      "pr-faq",
      "business-case",
      "shape-up",
    ]);
    expect(out.canvases.map((c) => c.id)).toEqual(["pcanvas_new", "example-pc", "pcanvas_old"]);
    expect(out.canvases.find((c) => c.id === "example-pc")?.example).toBe(true);
    expect(out.canvases.find((c) => c.id === "pcanvas_old")).toMatchObject({
      formatName: "Vision Board",
      boxes: { filled: 1 },
    });
    expect(out.canvases[0].gaps).toBeGreaterThan(0);
    const only = await run<{ canvases: { id: string }[] }>("tool.product_canvas.list_state", {
      format: "lean-ux",
    });
    expect(only.canvases.map((c) => c.id)).toEqual(["pcanvas_new"]);
  });

  it("reads one canvas in full, with its format's numbers", async () => {
    useWorkspaceStore.setState({
      hypothesisTrackers: [
        {
          id: HYPOTHESIS_TRACKER_ID,
          hypotheses: [
            {
              id: "h1",
              believe: "x",
              willDo: "",
              toLearn: "",
              successMetric: "",
              status: "running",
              raisedAt: "2026-11-20",
            },
          ],
        },
      ],
      productCanvases: [
        canvas({
          id: "pcanvas_vp",
          format: "value-proposition",
          sections: {
            pains: [
              item("p1", "No signal", {
                evidence: "fact",
                sentTo: [{ route: "hypothesis", targetId: "h1", at: STAMP }],
              }),
              item("p2", "Rent"),
            ],
            eases: [item("e1", "Offline", { links: ["p1"] })],
          },
        }),
        canvas({
          id: "pcanvas_vb",
          sections: {
            "pitch-name": [item("n", "Tapline")],
            "pitch-who": [item("w", "Stall holders")],
          },
        }),
      ],
    });
    const vp = await run<{
      found: boolean;
      canvas: {
        fit: { pains: { eased: number; total: number }; line: string };
        boxes: { id: string; lines: { id: string; test: string; links?: string[] }[] }[];
        gapList: { box: string | null; text: string }[];
      };
    }>("tool.product_canvas.list_state", { id: "pcanvas_vp" });
    expect(vp.found).toBe(true);
    expect(vp.canvas.fit.pains).toEqual({ eased: 1, total: 2 });
    expect(vp.canvas.fit.line).toContain("Fit is a guess");
    const pains = vp.canvas.boxes.find((b) => b.id === "pains")!;
    expect(pains.lines[0]).toMatchObject({ id: "p1", test: "testing" });
    expect(vp.canvas.gapList.some((g) => g.text.includes("nothing that eases"))).toBe(true);
    const vb = await run<{ canvas: { pitch: string } }>("tool.product_canvas.list_state", {
      id: "pcanvas_vb",
    });
    expect(vb.canvas.pitch).toBe("Tapline helps stall holders.");
    expect(await run("tool.product_canvas.list_state", { id: "nope" })).toMatchObject({
      found: false,
    });
  });
});

describe("tool.product_canvas.create_canvas", () => {
  it("starts an empty canvas by name", async () => {
    const out = await run<{ created: true; id: string; lines: number }>(
      "tool.product_canvas.create_canvas",
      { format: "value-proposition", title: "Stall holders" }
    );
    expect(out).toMatchObject({ created: true, lines: 0 });
    expect(stored(out.id)).toMatchObject({
      format: "value-proposition",
      title: "Stall holders",
      sections: {},
    });
  });

  it("starts from the Product Goal with no AI, its guesses marked and tied to the goal", async () => {
    useWorkspaceStore.setState({ productGoals: [goal] });
    const out = await run<{ id: string; lines: number; fromGoal: boolean }>(
      "tool.product_canvas.create_canvas",
      { format: "lean-ux", title: "Queue", fromGoal: true }
    );
    const c = stored(out.id)!;
    expect(out.fromGoal).toBe(true);
    expect(c.productGoalId).toBe("goal_1");
    expect(c.sections.problem[0].text).toBe(goal.why);
    expect(c.sections.outcomes.map((i) => i.text)).toEqual(goal.measures);
    expect(c.sections.users[0]).toMatchObject({ evidence: "assumption" });
    expect(c.sections.users[0].text).toMatch(/\[/);
  });

  it("keeps the line breaks of a goal's why in the paragraph box it starts", async () => {
    const why = "Card machines cost too much.\n\nStalls lose sales with no signal.";
    useWorkspaceStore.setState({ productGoals: [{ ...goal, why }] });
    const out = await run<{ id: string }>("tool.product_canvas.create_canvas", {
      format: "lean-ux",
      title: "Queue",
      fromGoal: true,
    });
    expect(stored(out.id)!.sections.problem[0].text).toBe(why);
  });
});

describe("tool.product_canvas writes", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      productCanvases: [
        canvas({
          id: "pcanvas_1",
          format: "value-proposition",
          sections: { pains: [item("p1", "No signal")], eases: [item("e1", "Offline")] },
        }),
        canvas({ id: "pcanvas_pr", format: "pr-faq" }),
      ],
    });
  });

  it("adds lines to a list box, with their marks", async () => {
    const out = await run<{ added: true; ids: string[]; lines: number }>(
      "tool.product_canvas.add_items",
      {
        canvasId: "pcanvas_1",
        section: "pains",
        items: [{ text: "Buyers with no cash", evidence: "fact" }, { text: "Rent" }],
      }
    );
    expect(out).toMatchObject({ added: true, lines: 4 });
    expect(stored("pcanvas_1")!.sections.pains.slice(1)).toEqual([
      { id: out.ids[0], text: "Buyers with no cash", evidence: "fact" },
      { id: out.ids[1], text: "Rent" },
    ]);
    expect(stored("pcanvas_1")!.updatedAt).not.toBe(STAMP);
  });

  it("refuses an unknown canvas or box, a one-line box and a full box", async () => {
    const add = (params: Record<string, unknown>) =>
      run<{ added: boolean; reason: string }>("tool.product_canvas.add_items", {
        canvasId: "pcanvas_1",
        items: [{ text: "x" }],
        ...params,
      });
    expect(await add({ canvasId: "nope", section: "pains" })).toMatchObject({
      added: false,
      reason: "not_found",
    });
    expect(await add({ section: "nope" })).toMatchObject({
      added: false,
      reason: "unknown_section",
    });
    expect(await add({ section: "customer" })).toMatchObject({
      added: false,
      reason: "not_a_list",
    });
    const ten = Array.from({ length: 10 }, (_, i) => ({ text: `Pain ${i}` }));
    expect(await add({ section: "pains", items: ten })).toMatchObject({
      added: false,
      reason: "section_full",
    });
    expect(stored("pcanvas_1")!.sections.pains).toHaveLength(1);
  });

  it("updates a line's words, mark, answer and links, checking links against their boxes", async () => {
    expect(
      await run("tool.product_canvas.update_item", {
        canvasId: "pcanvas_1",
        itemId: "e1",
        links: ["p1"],
      })
    ).toEqual({ updated: true });
    expect(stored("pcanvas_1")!.sections.eases[0].links).toEqual(["p1"]);
    expect(
      await run("tool.product_canvas.update_item", {
        canvasId: "pcanvas_1",
        itemId: "e1",
        links: ["e1"],
      })
    ).toMatchObject({ updated: false, reason: "bad_field" });
    expect(
      await run("tool.product_canvas.update_item", {
        canvasId: "pcanvas_1",
        itemId: "p1",
        text: "No signal in the hall",
        evidence: "fact",
      })
    ).toEqual({ updated: true });
    expect(stored("pcanvas_1")!.sections.pains[0]).toMatchObject({
      text: "No signal in the hall",
      evidence: "fact",
    });
    expect(
      await run("tool.product_canvas.update_item", {
        canvasId: "pcanvas_1",
        itemId: "p1",
        evidence: null,
      })
    ).toEqual({ updated: true });
    expect(stored("pcanvas_1")!.sections.pains[0].evidence).toBeUndefined();
    expect(
      await run("tool.product_canvas.update_item", {
        canvasId: "pcanvas_1",
        itemId: "p1",
        detail: "x",
      })
    ).toMatchObject({ updated: false, reason: "bad_field" });
  });

  it("sets and clears a one-line box, and checks a launch date", async () => {
    expect(
      await run("tool.product_canvas.set_field", {
        canvasId: "pcanvas_1",
        field: "customer",
        text: "Stall holders",
      })
    ).toEqual({ set: true, cleared: false });
    expect(stored("pcanvas_1")!.sections.customer[0].text).toBe("Stall holders");
    expect(
      await run("tool.product_canvas.set_field", {
        canvasId: "pcanvas_1",
        field: "customer",
        text: null,
      })
    ).toEqual({ set: true, cleared: true });
    expect(
      await run("tool.product_canvas.set_field", {
        canvasId: "pcanvas_1",
        field: "pains",
        text: "x",
      })
    ).toMatchObject({ set: false, reason: "not_an_answer" });
    expect(
      await run("tool.product_canvas.set_field", {
        canvasId: "pcanvas_pr",
        field: "launch-date",
        text: "2020-01-01",
      })
    ).toMatchObject({ set: false, reason: "bad_date" });
    expect(
      await run("tool.product_canvas.set_field", {
        canvasId: "pcanvas_pr",
        field: "launch-date",
        text: "2099-01-01",
      })
    ).toEqual({ set: true, cleared: false });
  });

  it("never rewrites a one-line or paragraph box's words through update_item", async () => {
    await run("tool.product_canvas.set_field", {
      canvasId: "pcanvas_pr",
      field: "launch-date",
      text: "2099-01-01",
    });
    await run("tool.product_canvas.set_field", {
      canvasId: "pcanvas_pr",
      field: "summary",
      text: "Tapline takes cards.",
    });
    const date = stored("pcanvas_pr")!.sections["launch-date"][0];
    const summary = stored("pcanvas_pr")!.sections.summary[0];
    for (const text of ["next spring", "2020-01-01"]) {
      expect(
        await run("tool.product_canvas.update_item", {
          canvasId: "pcanvas_pr",
          itemId: date.id,
          text,
        })
      ).toMatchObject({ updated: false, reason: "not_a_list" });
    }
    expect(
      await run("tool.product_canvas.update_item", {
        canvasId: "pcanvas_pr",
        itemId: summary.id,
        text: "Something else",
      })
    ).toMatchObject({
      updated: false,
      reason: "not_a_list",
      message: expect.stringMatching(/Summary/),
    });
    expect(stored("pcanvas_pr")!.sections["launch-date"][0].text).toBe("2099-01-01");
    expect(stored("pcanvas_pr")!.sections.summary[0].text).toBe("Tapline takes cards.");
    expect(registry.get("tool.product_canvas.update_item")!.description).toMatch(/set_field/);
  });
});

describe("tool.product_canvas over MCP", () => {
  it("reads and writes the user's rows, and the vision from their synced row", async () => {
    vi.mocked(serverStore.serverListEntities).mockImplementation(async (_u, kind) =>
      kind === PRODUCT_GOAL_KIND
        ? [goal]
        : kind === PRODUCT_CANVAS_KIND
          ? [canvas({ id: "pcanvas_s", format: "vision-board" })]
          : []
    );
    vi.mocked(serverStore.serverGetUserStateBlob).mockResolvedValue({ vision: "From the server" });
    vi.mocked(serverStore.serverGetEntity).mockResolvedValue(canvas({ id: "pcanvas_s" }) as never);
    const state = await runMcp<{
      vision: string;
      canvases: { id: string }[];
      goal: { id: string };
    }>("tool.product_canvas.list_state");
    expect(state.vision).toBe("From the server");
    expect(state.goal.id).toBe("goal_1");
    expect(state.canvases.map((c) => c.id)).toEqual(["pcanvas_s"]);
    expect(
      await runMcp("tool.product_canvas.add_items", {
        canvasId: "pcanvas_s",
        section: "who",
        items: [{ text: "Stall holders" }],
      })
    ).toMatchObject({ added: true });
    const [userId, kind, written] = vi.mocked(serverStore.serverUpsertEntity).mock.calls.at(-1)!;
    expect(userId).toBe("test-user");
    expect(kind).toBe(PRODUCT_CANVAS_KIND);
    expect((written as ProductCanvas).sections.who[0].text).toBe("Stall holders");
    const created = await runMcp<{ id: string }>("tool.product_canvas.create_canvas", {
      format: "vision-board",
      title: "From goal",
      fromGoal: true,
    });
    const made = vi.mocked(serverStore.serverUpsertEntity).mock.calls.at(-1)![2] as ProductCanvas;
    expect(made.id).toBe(created.id);
    expect(made.sections.vision[0].text).toBe("From the server");
    expect(made.productGoalId).toBe("goal_1");
    // The browser's store is never touched on the server path.
    expect(ws().productCanvases).toEqual([]);
  });
});
