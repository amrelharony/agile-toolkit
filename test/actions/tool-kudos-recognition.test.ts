/**
 * tool.kudos.recognition_stats and post_kudos, upgraded: the stats count
 * what the Kudos page's Recognition section counts (replies and example
 * kudos left out, a roster member matched by toMemberId, else by name),
 * over a sprint or a date range, with the roster's teammates who have none
 * and the fairness hints; post_kudos stamps a roster member. Both the
 * browser handler and the MCP handler (server store) are covered.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, { id: string }>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
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
import type { Kudos, Sprint, TeamMember } from "@/lib/stores/workspace-types";
import { recognitionReceived, sprintWindow } from "@/lib/kudos/recognition";

import "@/lib/actions/tools/kudos";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const stats = (params: Record<string, unknown> = {}) =>
  registry.get("tool.kudos.recognition_stats")!.handler(params, ctx()) as Promise<
    Record<string, unknown>
  >;
const statsServer = (params: Record<string, unknown> = {}) =>
  registry.get("tool.kudos.recognition_stats")!.mcpHandler!(params, ctx()) as Promise<
    Record<string, unknown>
  >;

const ROSTER: TeamMember[] = [
  { id: "m-sam", name: "Sam" },
  { id: "m-priya", name: "Priya" },
  { id: "m-omar", name: "Omar" },
];
const SPRINT: Sprint = {
  id: "s-12",
  name: "Sprint 12",
  startDate: "2026-09-21",
  endDate: "2026-10-04",
  pointsPlanned: 20,
  status: "completed",
};

let seq = 0;
const kudo = (toName: string, sentAt: string, over: Partial<Kudos> = {}): Kudos => ({
  id: `kud_${(seq++).toString().padStart(8, "0")}`,
  theme: "thank-you",
  toName,
  fromName: "Mia",
  message: `Thanks ${toName}`,
  sentAt,
  ...over,
});

/** Six kudos in Sprint 12 (one a reply, one an example), and one before it. */
function wall(): Kudos[] {
  seq = 0;
  const parent = kudo("Sam", "2026-09-22T10:00:00.000Z");
  return [
    parent,
    kudo("Sam", "2026-09-24T10:00:00.000Z", { fromName: "Priya" }),
    kudo("sam", "2026-09-25T10:00:00.000Z"),
    kudo("Priya", "2026-09-29T10:00:00.000Z", { toMemberId: "m-priya" }),
    kudo("Priya", "2026-10-01T10:00:00.000Z"),
    kudo("Sam", "2026-09-23T10:00:00.000Z", { replyTo: parent.id, fromName: "Sam" }),
    kudo("Omar", "2026-09-26T10:00:00.000Z", { id: "example-kudos-1" }),
    kudo("Omar", "2026-09-10T10:00:00.000Z"),
  ];
}

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({ kudos: wall(), teamMembers: ROSTER, sprints: [SPRINT] });
});

describe("tool.kudos.recognition_stats", () => {
  it("keeps the legacy tallies, without replies or example kudos", async () => {
    const s = await stats();
    expect(s.total).toBe(6);
    expect(s.byRecipient).toEqual({ Sam: 3, Priya: 2, Omar: 1 });
    expect(s.bySender).toEqual({ Mia: 5, Priya: 1 });
    expect(s.topRecipients).toEqual([
      { name: "Sam", count: 3 },
      { name: "Priya", count: 2 },
      { name: "Omar", count: 1 },
    ]);
    expect(s.window).toBeNull();
  });

  it("reads a sprint's days, with the teammates who have none and the hints", async () => {
    const s = await stats({ sprintId: "s-12" });
    expect(s.total).toBe(5);
    expect(s.window).toEqual({
      from: "2026-09-21",
      to: "2026-10-04",
      sprintId: "s-12",
      sprintName: "Sprint 12",
    });
    expect(s.rosterWithNone).toEqual([{ memberId: "m-omar", name: "Omar" }]);
    expect(s.enough).toBe(true);
    expect(s.hints).toEqual([
      {
        kind: "none-received",
        memberIds: ["m-omar"],
        names: ["Omar"],
        sentence: "Omar hasn't received a kudos yet in Sprint 12.",
      },
    ]);
  });

  it("computes the page's numbers: the same lib over the same data", async () => {
    const s = await stats({ sprintId: "s-12" });
    const page = recognitionReceived(wall(), ROSTER, sprintWindow(SPRINT));
    expect(s.received).toEqual(page.recipients);
    expect(s.rosterWithNone).toEqual(page.rosterWithNone);
    expect(s.topShare).toBe(page.topShare);
  });

  it("takes a date range, to defaulting to today and from to the first kudos", async () => {
    const range = await stats({ from: "2026-09-29", to: "2026-10-04" });
    expect(range.total).toBe(2);
    expect(range.enough).toBe(false);
    expect(range.hints).toEqual([]);
    const open = await stats({ to: "2026-09-24" });
    expect(open.window).toEqual({ from: "2026-09-10", to: "2026-09-24" });
    expect(open.total).toBe(3);
  });

  it("says why a window can't be read", async () => {
    expect(await stats({ sprintId: "nope" })).toEqual({ error: "unknown_sprint" });
    useWorkspaceStore.setState({
      sprints: [{ ...SPRINT, startDate: "2020-01-01", endDate: "2020-01-14" }],
    });
    expect(await stats({ sprintId: "s-12" })).toEqual({ error: "sprint_has_no_dates" });
    expect(await stats({ from: "2026-10-05", to: "2026-10-01" })).toEqual({
      error: "from_after_to",
    });
  });

  it("reads the same from the server store", async () => {
    for (const k of wall()) rows.set(`workspace:kudos/${k.id}`, k);
    for (const m of ROSTER) rows.set(`workspace:teamMember/${m.id}`, m);
    rows.set(`workspace:sprint/${SPRINT.id}`, SPRINT);
    const browser = await stats({ sprintId: "s-12" });
    const server = await statsServer({ sprintId: "s-12" });
    expect(server).toEqual(browser);
  });
});

describe("tool.kudos.post_kudos with toMemberId", () => {
  const post = (params: Record<string, unknown>) =>
    registry.get("tool.kudos.post_kudos")!.handler(params, ctx()) as Promise<{
      posted: boolean;
      id?: string;
      error?: string;
    }>;

  it("stamps a roster member, and refuses one off the roster", async () => {
    useWorkspaceStore.setState({ kudos: [] });
    const ok = await post({ toName: "Sam", message: "Great pairing", toMemberId: "m-sam" });
    expect(ok.posted).toBe(true);
    expect(useWorkspaceStore.getState().kudos?.[0]).toMatchObject({
      toName: "Sam",
      toMemberId: "m-sam",
      version: 2,
    });
    expect(await post({ toName: "Kim", message: "Thanks", toMemberId: "m-kim" })).toEqual({
      posted: false,
      error: "unknown_member",
    });
  });

  it("checks the member against the server roster", async () => {
    const server = registry.get("tool.kudos.post_kudos")!.mcpHandler!;
    expect(await server({ toName: "Sam", message: "Hi", toMemberId: "m-sam" }, ctx())).toEqual({
      posted: false,
      error: "unknown_member",
    });
    rows.set("workspace:teamMember/m-sam", ROSTER[0]);
    const ok = (await server({ toName: "Sam", message: "Hi", toMemberId: "m-sam" }, ctx())) as {
      posted: boolean;
      id: string;
    };
    expect(ok.posted).toBe(true);
    expect(rows.get(`workspace:kudos/${ok.id}`)).toMatchObject({ toMemberId: "m-sam" });
  });
});
