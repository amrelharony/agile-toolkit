/**
 * tool.test_sessions.* coverage, in the browser and over MCP.
 *
 *   1. registration — reads and writes, each with an MCP handler, none a room verb.
 *   2. plan_session, then list_state: newest first, the sentence, the clock.
 *   3. start_session stamps only (no docked timer), one running at a time;
 *      add_note needs a started session and stamps minutes in; end_session
 *      takes a debrief whose split adds up to 100.
 *   4. send_bugs makes bugs in Bug Triage linked both ways, skips the ones
 *      there, never sends the example; over MCP the bugs are the user's rows.
 *   5. suggest_charters — the lenses, past charters skipped.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BugReport, TestSession } from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useDockTimer } from "@/lib/timer/dock-timer";
import "@/lib/actions/tools/test-sessions";

const ctx = (source: "agent" | "mcp" = "agent") => ({
  userId: "u",
  source,
  squadProfileIds: [] as string[],
});
const run = async <T>(id: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = registry.get(id)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx(onServer ? "mcp" : "agent"))) as T;
};

const session = (over: Partial<TestSession> = {}): TestSession => ({
  id: "tsess_a",
  charter: { target: "Saved addresses", toLearn: "whether the list loads" },
  minutes: 60,
  status: "planned",
  notes: [],
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-20T08:00:00.000Z",
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id: string) => (ws().testSessions ?? []).find((s) => s.id === id);

beforeEach(() => {
  server.rows.clear();
  useDockTimer.setState({ timer: null });
  useWorkspaceStore.setState({ testSessions: [], bugReports: [] });
});

describe("registration", () => {
  it("has the reads and the writes, each with an MCP handler", () => {
    for (const name of ["list_state", "suggest_charters"]) {
      expect(registry.get(`tool.test_sessions.${name}`)?.category, name).toBe("read");
    }
    for (const name of ["plan_session", "start_session", "add_note", "end_session", "send_bugs"]) {
      const a = registry.get(`tool.test_sessions.${name}`);
      expect(a?.category, name).toBe("write");
      expect(a?.requiresConfirmation, name).toBe(false);
      expect(a?.visitor, name).toBeUndefined();
      expect(a?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("plan and list", () => {
  it("plans a session from a charter and lists it with its sentence", async () => {
    const out = await run<{ planned: boolean; id: string; sentence: string }>(
      "tool.test_sessions.plan_session",
      {
        target: " Saved  addresses ",
        using: "a slow network",
        toLearn: "what fails",
        minutes: 45,
        tester: "Sam",
      }
    );
    expect(out).toMatchObject({
      planned: true,
      sentence: "Look at Saved addresses, using a slow network, to learn what fails",
    });
    expect(stored(out.id)).toMatchObject({
      status: "planned",
      minutes: 45,
      tester: "Sam",
      notes: [],
    });
    expect(() =>
      registry.get("tool.test_sessions.plan_session")!.paramsSchema.parse({
        target: "x",
        toLearn: "y",
        minutes: 10,
      })
    ).toThrow();
    const list = await run<{ running: string | null; sessions: { id: string; status: string }[] }>(
      "tool.test_sessions.list_state"
    );
    expect(list.running).toBeNull();
    expect(list.sessions.map((s) => s.id)).toEqual([out.id]);
  });
});

describe("running a session", () => {
  it("starts with a stamp only, one at a time, and never claims the docked timer", async () => {
    useWorkspaceStore.setState({
      testSessions: [session(), session({ id: "tsess_b", createdAt: "2026-11-20T08:30:00Z" })],
    });
    const out = await run<{ started: boolean; endsAt: string }>(
      "tool.test_sessions.start_session",
      {
        id: "tsess_a",
      }
    );
    expect(out.started).toBe(true);
    expect(stored("tsess_a")?.status).toBe("running");
    expect(useDockTimer.getState().timer).toBeNull();
    expect(Date.parse(out.endsAt) - Date.parse(stored("tsess_a")!.startedAt!)).toBe(60 * 60_000);
    expect(await run("tool.test_sessions.start_session", { id: "tsess_b" })).toMatchObject({
      started: false,
      reason: "another_running",
      runningId: "tsess_a",
    });
    expect(await run("tool.test_sessions.start_session", { id: "tsess_a" })).toMatchObject({
      started: false,
      reason: "running",
    });
  });

  it("adds notes to a started session only, stamped with their minutes in", async () => {
    useWorkspaceStore.setState({
      testSessions: [
        session(),
        session({ id: "tsess_r", status: "running", startedAt: new Date().toISOString() }),
      ],
    });
    expect(
      await run("tool.test_sessions.add_note", { id: "tsess_a", kind: "bug", text: "Broken" })
    ).toMatchObject({ added: false, reason: "not_started" });
    const out = await run<{ added: boolean; minutesIn: number }>("tool.test_sessions.add_note", {
      id: "tsess_r",
      kind: "question",
      text: "Is a PO box allowed?",
    });
    expect(out).toMatchObject({ added: true, minutesIn: 0 });
    expect(stored("tsess_r")?.notes).toEqual([
      expect.objectContaining({ kind: "question", text: "Is a PO box allowed?" }),
    ]);
  });

  it("ends a session with its debrief, and refuses a split that doesn't add up", async () => {
    useWorkspaceStore.setState({
      testSessions: [
        session({ status: "running", startedAt: "2026-11-20T09:00:00.000Z", notes: [] }),
      ],
    });
    expect(() =>
      registry.get("tool.test_sessions.end_session")!.paramsSchema.parse({
        id: "tsess_a",
        split: { testing: 50, bugs: 20, setup: 10 },
      })
    ).toThrow();
    const out = await run<{ ended: boolean; alreadyEnded: boolean }>(
      "tool.test_sessions.end_session",
      {
        id: "tsess_a",
        coverage: "most",
        split: { testing: 70, bugs: 20, setup: 10 },
        debrief: "Prices follow the address.",
      }
    );
    expect(out).toMatchObject({ ended: true, alreadyEnded: false });
    expect(stored("tsess_a")).toMatchObject({
      status: "done",
      coverage: "most",
      split: { testing: 70, bugs: 20, setup: 10 },
      debrief: "Prices follow the address.",
    });
    expect(stored("tsess_a")?.endedAt).toBeDefined();
    expect(
      await run("tool.test_sessions.end_session", { id: "tsess_a", coverage: "all" })
    ).toMatchObject({ ended: true, alreadyEnded: true });
    expect(stored("tsess_a")?.coverage).toBe("all");
  });
});

describe("send_bugs", () => {
  const withBugs = (over: Partial<TestSession> = {}) =>
    session({
      status: "done",
      tester: "Priya",
      area: "Checkout",
      notes: [
        { id: "n1", at: "2026-11-20T09:10:00Z", kind: "bug", text: "The list jumps\nto the top" },
        { id: "n2", at: "2026-11-20T09:20:00Z", kind: "bug", text: "Prices stay wrong" },
        { id: "n3", at: "2026-11-20T09:25:00Z", kind: "idea", text: "Try a phone" },
      ],
      ...over,
    });

  it("logs each bug note in Bug Triage, linked both ways, and skips the ones already there", async () => {
    useWorkspaceStore.setState({ testSessions: [withBugs()] });
    const out = await run<{
      sent: number;
      bugs: { noteId: string; bugId: string; href: string }[];
    }>("tool.test_sessions.send_bugs", { id: "tsess_a", noteIds: ["n1"] });
    expect(out.sent).toBe(1);
    const bug = (ws().bugReports ?? [])[0];
    expect(bug).toMatchObject({
      title: "The list jumps",
      actual: "The list jumps\nto the top",
      reportedBy: "Priya",
      area: "Checkout",
      status: "new",
      sourceRef: { tool: "test-sessions", id: "n1", doc: "tsess_a" },
    });
    expect(out.bugs[0]).toEqual({ noteId: "n1", bugId: bug.id, href: `/bug-triage?bug=${bug.id}` });
    expect(stored("tsess_a")?.notes[0].sentTo).toEqual([
      expect.objectContaining({ route: "bug", targetId: bug.id }),
    ]);
    const rest = await run<{ sent: number }>("tool.test_sessions.send_bugs", { id: "tsess_a" });
    expect(rest.sent).toBe(1);
    expect(ws().bugReports).toHaveLength(2);
    expect(await run("tool.test_sessions.send_bugs", { id: "tsess_a" })).toEqual({
      sent: 0,
      reason: "none",
    });
  });

  it("never sends the example's bugs", async () => {
    useWorkspaceStore.setState({ testSessions: [withBugs({ id: "example-s" })] });
    expect(await run("tool.test_sessions.send_bugs", { id: "example-s" })).toEqual({
      sent: 0,
      reason: "example",
    });
    expect(ws().bugReports ?? []).toEqual([]);
  });

  it("over MCP writes the bugs to the user's rows", async () => {
    server.rows.set("workspace:testSession/tsess_a", withBugs());
    const out = await run<{ sent: number; bugs: { bugId: string }[] }>(
      "tool.test_sessions.send_bugs",
      { id: "tsess_a" },
      true
    );
    expect(out.sent).toBe(2);
    const bug = server.rows.get(`workspace:bugReport/${out.bugs[0].bugId}`) as BugReport;
    expect(bug).toMatchObject({
      status: "new",
      sourceRef: { tool: "test-sessions", doc: "tsess_a" },
    });
    const back = server.rows.get("workspace:testSession/tsess_a") as TestSession;
    expect(back.notes.filter((n) => n.sentTo?.length)).toHaveLength(2);
    expect(ws().bugReports ?? []).toEqual([]);
    const list = await run<{
      sessions: { unsentBugs: number; notes: { bug: { state: string } | null }[] }[];
    }>("tool.test_sessions.list_state", {}, true);
    expect(list.sessions[0].unsentBugs).toBe(0);
    expect(list.sessions[0].notes[0].bug).toMatchObject({ state: "open" });
  });
});

describe("suggest_charters", () => {
  it("suggests from the lenses, skipping ones past sessions used", async () => {
    useWorkspaceStore.setState({
      testSessions: [
        session({
          charter: { target: "Booking", using: "other dates, times and time zones", toLearn: "x" },
        }),
      ],
    });
    const out = await run<{ charters: { using: string }[] }>(
      "tool.test_sessions.suggest_charters",
      {
        target: "Booking a delivery date",
        count: 4,
      }
    );
    expect(out.charters).toHaveLength(4);
    expect(out.charters.map((c) => c.using)).not.toContain("other dates, times and time zones");
  });
});
