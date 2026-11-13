/**
 * tool.meeting_audit.* coverage, in the browser and over MCP.
 *
 *   1. registration — reads and writes, each with an MCP handler.
 *   2. list_state — the costliest first, person-hours, ratings, the plan;
 *      the summary without the example.
 *   3. rate — merges ratings, null clears one; set_verdict — with notes.
 *   4. suggest_changes and accept_change — the page's rules and its "Add to
 *      plan", on the user's rows over MCP too.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingAudit } from "@/lib/stores/workspace-types";

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
import "@/lib/actions/tools/meeting-audit";

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

const AT = "2026-11-12T09:00:00.000Z";
const audit = (over: Partial<MeetingAudit> = {}): MeetingAudit => ({
  id: "m1",
  meeting: "Weekly sync",
  cadence: "weekly",
  minutes: 60,
  attendees: 6,
  purpose: "Share progress.",
  ratings: {},
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const ws = () => useWorkspaceStore.getState();
const meeting = (id: string) => (ws().meetingAudits ?? []).find((a) => a.id === id);

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({ meetingAudits: [] });
});

describe("registration", () => {
  it("has the reads and the writes, each with an MCP handler", () => {
    for (const name of ["list_state", "suggest_changes"]) {
      expect(registry.get(`tool.meeting_audit.${name}`)?.category, name).toBe("read");
    }
    for (const name of ["rate", "set_verdict", "accept_change"]) {
      expect(registry.get(`tool.meeting_audit.${name}`)?.category, name).toBe("write");
      expect(registry.get(`tool.meeting_audit.${name}`)?.requiresConfirmation, name).toBe(false);
    }
    for (const name of ["list_state", "suggest_changes", "rate", "set_verdict", "accept_change"]) {
      expect(registry.get(`tool.meeting_audit.${name}`)?.mcpHandler, name).toBeTypeOf("function");
    }
  });
});

describe("list_state", () => {
  it("lists the costliest first with person-hours, ratings and the plan, the example left out of the counts", async () => {
    useWorkspaceStore.setState({
      meetingAudits: [
        audit({ id: "cheap", meeting: "Demo prep", minutes: 30, attendees: 3, verdict: "keep" }),
        audit({ ratings: { purpose: 4, outcome: 2 }, verdict: "drop" }),
        audit({ id: "example-1", attendees: 50 }),
      ],
    });
    const r = await run<{
      summary: Record<string, unknown>;
      plan: { drop: { id: string }[]; hoursNow: number; hoursAfter: number };
      examples: number;
      verdict: string;
      meetings: {
        id: string;
        weeklyHours: number;
        ratings: Record<string, number | null>;
        averageRating: number | null;
      }[];
    }>("tool.meeting_audit.list_state");
    expect(r.meetings.map((m) => m.id)).toEqual(["example-1", "m1", "cheap"]);
    expect(r.meetings[1]).toMatchObject({
      weeklyHours: 6,
      averageRating: 3,
      ratings: { purpose: 4, people: null, outcome: 2, length: null, energy: null },
    });
    expect(r.summary).toMatchObject({ meetings: 2, weeklyHours: 7.5, hoursFreed: 6 });
    expect(r.plan).toMatchObject({ drop: [{ id: "m1" }], hoursNow: 7.5, hoursAfter: 1.5 });
    expect(r.examples).toBe(1);
    expect(r.verdict).toContain("2 recurring meetings take 7.5 person-hours a week");
  });
});

describe("rate and set_verdict", () => {
  it("merges ratings, clears one with null, and refuses an empty ask", async () => {
    useWorkspaceStore.setState({ meetingAudits: [audit({ ratings: { purpose: 2, energy: 1 } })] });
    expect(
      await run("tool.meeting_audit.rate", {
        id: "m1",
        ratings: { purpose: 4, outcome: 5, energy: null },
      })
    ).toEqual({
      updated: true,
      id: "m1",
      rated: ["purpose", "outcome", "energy"],
      averageRating: 4.5,
    });
    expect(meeting("m1")?.ratings).toEqual({ purpose: 4, outcome: 5 });
    expect(await run("tool.meeting_audit.rate", { id: "m1", ratings: {} })).toEqual({
      updated: false,
      reason: "nothing_to_rate",
    });
    expect(() =>
      registry
        .get("tool.meeting_audit.rate")!
        .paramsSchema.parse({ id: "m1", ratings: { purpose: 6 } })
    ).toThrow();
    expect(await run("tool.meeting_audit.rate", { id: "nope", ratings: { purpose: 3 } })).toEqual({
      updated: false,
      reason: "not_found",
    });
  });

  it("sets and clears a verdict, replacing the notes only when given", async () => {
    useWorkspaceStore.setState({ meetingAudits: [audit({ notes: "Old" })] });
    expect(
      await run("tool.meeting_audit.set_verdict", {
        id: "m1",
        verdict: "change",
        notes: " Shorter ",
      })
    ).toEqual({ updated: true, id: "m1", verdict: "change" });
    expect(meeting("m1")).toMatchObject({ verdict: "change", notes: "Shorter" });
    await run("tool.meeting_audit.set_verdict", { id: "m1", verdict: null });
    expect(meeting("m1")).not.toHaveProperty("verdict");
    expect(meeting("m1")?.notes).toBe("Shorter");
    await run("tool.meeting_audit.set_verdict", { id: "m1", verdict: "keep", notes: "" });
    expect(meeting("m1")).not.toHaveProperty("notes");
  });
});

describe("suggest_changes and accept_change", () => {
  it("suggests by the page's rules and accepts one into the plan", async () => {
    useWorkspaceStore.setState({
      meetingAudits: [
        audit({ meeting: "Daily Scrum", cadence: "daily", minutes: 30, attendees: 8 }),
      ],
    });
    const r = await run<{ changes: { meetingId: string; meeting: string; change: string }[] }>(
      "tool.meeting_audit.suggest_changes"
    );
    expect(r.changes).toEqual([
      expect.objectContaining({
        meetingId: "m1",
        meeting: "Daily Scrum",
        change: "Timebox it to 15 minutes",
      }),
    ]);
    expect(
      await run("tool.meeting_audit.accept_change", {
        id: "m1",
        change: "Timebox it to 15 minutes",
      })
    ).toEqual({ updated: true, id: "m1", verdict: "change", notes: "Timebox it to 15 minutes" });
    // Accepted once: the rules don't offer it again.
    expect(
      (await run<{ changes: unknown[] }>("tool.meeting_audit.suggest_changes")).changes
    ).toEqual([]);
  });

  it("works on the user's rows over MCP", async () => {
    server.rows.set("workspace:meetingAudit/m1", audit({ verdict: "drop" }));
    await run("tool.meeting_audit.rate", { id: "m1", ratings: { outcome: 1 } }, true);
    await run("tool.meeting_audit.accept_change", { id: "m1", change: "Write it up" }, true);
    expect(server.rows.get("workspace:meetingAudit/m1")).toMatchObject({
      ratings: { outcome: 1 },
      verdict: "drop",
      notes: "Write it up",
    });
    expect(ws().meetingAudits).toEqual([]);
  });
});
