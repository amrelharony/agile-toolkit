/**
 * tool.user_interviews.* after Phase 8, on both transports: themes counted
 * per participant (lib/interviews), add_interview dated by a day and put
 * first, and a quote raised as an opportunity under a picked node (redacted,
 * no name, once while that node exists, never an example).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Interview,
  OpportunityTree,
  TreeNode,
  UserInterviewLog,
} from "@/lib/stores/workspace-types";
import { UI_ID, quoteOpportunitySource, themeCounts } from "@/lib/interviews/model";
import { OPPORTUNITY_TREE_ID, opportunityFromSource } from "@/lib/opportunity-tree/model";

import "@/lib/actions/tools/user-interviews";

type Path = "handler" | "mcpHandler";
const TRANSPORTS: Path[] = ["handler", "mcpHandler"];
const KIND_UI = "workspace:userInterviewLog";
const KIND_OT = "workspace:opportunityTree";
const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

const run = <T = Record<string, unknown>>(
  path: Path,
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.user_interviews.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

function seed(path: Path, interviews: Interview[], nodes?: TreeNode[]) {
  const log: UserInterviewLog = { id: UI_ID, interviews };
  const tree: OpportunityTree | undefined = nodes && { id: OPPORTUNITY_TREE_ID, nodes };
  if (path === "handler") {
    useWorkspaceStore.setState({ userInterviewLogs: [log], opportunityTrees: tree ? [tree] : [] });
  } else {
    rows.set(`${KIND_UI}/${UI_ID}`, log);
    if (tree) rows.set(`${KIND_OT}/${OPPORTUNITY_TREE_ID}`, tree);
  }
}

const interviewsOf = (path: Path): Interview[] =>
  (path === "handler"
    ? (useWorkspaceStore.getState().userInterviewLogs ?? []).find((d) => d.id === UI_ID)
    : (rows.get(`${KIND_UI}/${UI_ID}`) as UserInterviewLog | undefined)
  )?.interviews ?? [];
const nodesOf = (path: Path): TreeNode[] =>
  (path === "handler"
    ? (useWorkspaceStore.getState().opportunityTrees ?? []).find(
        (d) => d.id === OPPORTUNITY_TREE_ID
      )
    : (rows.get(`${KIND_OT}/${OPPORTUNITY_TREE_ID}`) as OpportunityTree | undefined)
  )?.nodes ?? [];

const LOG: Interview[] = [
  {
    id: "i1",
    date: "2026-10-14",
    participant: "Ana Silva",
    quotes: [
      { id: "q1", text: "I export every Friday, mail me at ana@example.com", tags: ["reporting"] },
      { id: "q2", text: "Reports again", tags: ["Reporting", "pricing"] },
    ],
  },
  {
    id: "i2",
    date: "2026-10-15",
    participant: "Ben",
    quotes: [{ id: "q3", text: "Too pricey", tags: ["pricing"] }],
  },
  {
    id: "example-i",
    date: "2026-10-01",
    participant: "Demo",
    quotes: [{ id: "example-q", text: "Demo", tags: [] }],
  },
];

const TREE: TreeNode[] = [
  { id: "o1", kind: "outcome", text: "Weekly active teams", parentId: null },
  { id: "s1", kind: "solution", text: "A report", parentId: "o1" },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
  rows.clear();
  useWorkspaceStore.setState({ userInterviewLogs: [], opportunityTrees: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registration", () => {
  it("adds send_quote_to_opportunity as a write with a server path", () => {
    const action = registry.get("tool.user_interviews.send_quote_to_opportunity");
    expect(action?.category).toBe("write");
    expect(action?.mcpHandler).toBeTypeOf("function");
    expect(action?.requiresConfirmation).toBe(false);
  });
});

describe.each(TRANSPORTS)("%s", (path) => {
  it("list_state counts themes per participant, as the library does", async () => {
    seed(path, LOG);
    const r = (await run(path, "list_state")) as {
      participants: number;
      themes: unknown[];
      topTags: unknown[];
      totalQuotes: number;
    };
    expect(r.participants).toBe(3);
    expect(r.totalQuotes).toBe(4);
    expect(r.themes).toEqual(themeCounts(LOG));
    expect(r.topTags).toEqual([
      { tag: "pricing", count: 2, participants: 2 },
      { tag: "reporting", count: 2, participants: 1 },
    ]);
  });

  it("add_interview takes a backdated day and goes first; never a later day", async () => {
    seed(path, LOG);
    const r = await run(path, "add_interview", {
      participant: " Cy ",
      date: "2026-10-20",
      context: "Call",
    });
    expect(r.added).toBe(true);
    expect(interviewsOf(path)[0]).toEqual({
      id: r.id,
      participant: "Cy",
      date: "2026-10-20",
      context: "Call",
      quotes: [],
    });
    const today = await run(path, "add_interview", { participant: "Dee" });
    expect(interviewsOf(path).find((i) => i.id === today.id)?.date).toBe("2026-10-27");
    // The user's today may be the server's tomorrow over MCP; never later.
    expect((await run(path, "add_interview", { participant: "E", date: "2026-10-28" })).added).toBe(
      path === "mcpHandler"
    );
    expect(await run(path, "add_interview", { participant: "F", date: "2026-10-29" })).toEqual({
      added: false,
      reason: "future_day",
    });
    expect(await run(path, "add_interview", { participant: "G", date: "2026-02-30" })).toEqual({
      added: false,
      reason: "not_a_day",
    });
  });

  it("add_quote stores each normalised tag once", async () => {
    seed(path, LOG);
    const r = await run(path, "add_quote", {
      interviewId: "i2",
      text: "x",
      tags: ["UX", " ux", ""],
    });
    expect(
      interviewsOf(path)
        .find((i) => i.id === "i2")
        ?.quotes.find((q) => q.id === r.id)?.tags
    ).toEqual(["ux"]);
  });

  it("raises a quote as an opportunity under the picked outcome, redacted and without the name", async () => {
    seed(path, LOG, TREE);
    const r = await run(path, "send_quote_to_opportunity", {
      interviewId: "i1",
      quoteId: "q1",
      parentId: "o1",
    });
    expect(r).toMatchObject({
      sent: true,
      parentId: "o1",
      text: "I export every Friday, mail me at [redacted:email]",
    });
    const added = nodesOf(path).find((n) => n.id === r.nodeId)!;
    const expected = opportunityFromSource(
      quoteOpportunitySource(LOG[0].quotes[0], LOG[0], "o1"),
      TREE,
      r.nodeId as string
    );
    expect(added).toEqual(expected);
    expect(added.evidence).toBe("From an interview on 2026-10-14");
    expect(JSON.stringify(added)).not.toContain("Ana");
    expect(interviewsOf(path)[0].quotes[0].sentTo).toEqual([
      { route: "opportunity", targetId: r.nodeId, at: expect.any(String) },
    ]);

    expect(
      await run(path, "send_quote_to_opportunity", { interviewId: "i1", quoteId: "q1" })
    ).toEqual({
      sent: false,
      reason: "already_sent",
      nodeId: r.nodeId,
    });
  });

  it("goes to the root with no parent, and again once its node is deleted", async () => {
    seed(path, LOG, []);
    const first = await run(path, "send_quote_to_opportunity", {
      interviewId: "i2",
      quoteId: "q3",
    });
    expect(first).toMatchObject({ sent: true, parentId: null });
    // Deleted on the tree: the quote can be sent again.
    if (path === "handler")
      useWorkspaceStore.setState({ opportunityTrees: [{ id: OPPORTUNITY_TREE_ID, nodes: [] }] });
    else rows.set(`${KIND_OT}/${OPPORTUNITY_TREE_ID}`, { id: OPPORTUNITY_TREE_ID, nodes: [] });
    const again = await run(path, "send_quote_to_opportunity", {
      interviewId: "i2",
      quoteId: "q3",
    });
    expect(again.sent).toBe(true);
    expect(interviewsOf(path).find((i) => i.id === "i2")?.quotes[0].sentTo).toEqual([
      { route: "opportunity", targetId: again.nodeId, at: expect.any(String) },
    ]);
  });

  it("never sends an example, an unknown quote, or under a node that can't hold it", async () => {
    seed(path, LOG, TREE);
    const send = (p: Record<string, unknown>) => run(path, "send_quote_to_opportunity", p);
    expect(await send({ interviewId: "example-i", quoteId: "example-q" })).toEqual({
      sent: false,
      reason: "example",
    });
    expect(await send({ interviewId: "i1", quoteId: "q3" })).toEqual({
      sent: false,
      reason: "not_found",
    });
    expect(await send({ interviewId: "nope", quoteId: "q1" })).toEqual({
      sent: false,
      reason: "not_found",
    });
    expect(await send({ interviewId: "i1", quoteId: "q1", parentId: "gone" })).toEqual({
      sent: false,
      reason: "parent_not_found",
    });
    expect(await send({ interviewId: "i1", quoteId: "q1", parentId: "s1" })).toEqual({
      sent: false,
      reason: "kind",
    });
    expect(nodesOf(path)).toEqual(TREE);
  });
});
