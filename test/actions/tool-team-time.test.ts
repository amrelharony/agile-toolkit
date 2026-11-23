/**
 * tool.team_time.* coverage, in the browser and over MCP.
 *
 *   1. registration — reads and writes, each with an MCP handler, all open
 *      to visitors (they touch the person's own data only).
 *   2. list_state — people with their local time, roster names with no row,
 *      the week's shared windows, offices, polls and rotations.
 *   3. set_person — one row per person, linked to the roster by name, the
 *      zone stored canonical, an update keeping what it doesn't name.
 *   4. find_times, create_poll, record_answers, choose_slot — the page's
 *      ranking, its validators ("in the future" for new times only) and a
 *      closed poll refusing answers.
 *   5. plan_rotation — the next 8 meetings and the totals, an update
 *      keeping the held meetings of the times it keeps; on the user's rows
 *      over MCP too.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamTimePoll, TeamTimeRotation } from "@/lib/stores/workspace-types";

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
import { canonicalZone } from "@/lib/team-time/zones";
import { rotationFrom } from "@/lib/team-time/model";
import { nextOccurrences } from "@/lib/team-time/rotation";
import { validateRotation } from "@/lib/team-time/validate";
import "@/lib/actions/tools/team-time";
import { london, newYork, tokyo } from "../team-time/fixtures";

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
const ws = () => useWorkspaceStore.getState();
const AT = "2026-11-16T00:00:00.000Z";
const FAR = "2031-03-04T14:00:00.000Z";
const FAR2 = "2031-03-05T14:00:00.000Z";

const poll = (over: Partial<TeamTimePoll> = {}): TeamTimePoll => ({
  id: "poll1",
  title: "Review",
  minutes: 60,
  slots: [
    { id: "a", start: FAR },
    { id: "b", start: FAR2 },
  ],
  answers: [],
  status: "open",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

beforeEach(() => {
  server.rows.clear();
  useWorkspaceStore.setState({
    teamTimePeople: [],
    teamTimePolls: [],
    teamTimeRotations: [],
    teamMembers: [],
    ceremonyCadences: [],
  });
});

const VERBS = {
  read: ["list_state", "find_times"],
  write: ["set_person", "create_poll", "record_answers", "choose_slot", "plan_rotation"],
};

describe("registration", () => {
  it("has the reads and the writes, each with an MCP handler, all open to visitors", () => {
    for (const [category, names] of Object.entries(VERBS)) {
      for (const name of names) {
        const a = registry.get(`tool.team_time.${name}`);
        expect(a?.category, name).toBe(category);
        expect(a?.mcpHandler, name).toBeTypeOf("function");
        expect(a?.visitor, name).not.toBe(false);
        if (category === "write") expect(a?.requiresConfirmation, name).toBe(false);
      }
    }
  });

  it("gives every verb a JSON object schema, the create_poll refine included", () => {
    const tools = registry.toMcpTools().filter((t) => t.name.startsWith("tool.team_time."));
    expect(tools).toHaveLength(7);
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.description.length, t.name).toBeGreaterThan(40);
    }
  });
});

describe("list_state", () => {
  it("lists people with their local time, roster names with no row, and the shared windows", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [
        london,
        newYork,
        { id: "bad", name: "Mars", timeZone: "Mars/Base" } as never,
      ],
      teamMembers: [
        { id: "m1", name: "Lou" },
        { id: "m9", name: "Kim" },
      ],
    });
    const r = await run<{
      people: { id: string; name: string; hours: string; localTime: string; inHours: boolean }[];
      rosterWithoutRow: string[];
      sharedThisWeek: { everyone: unknown[]; lines: string[] };
    }>("tool.team_time.list_state");
    expect(r.people.map((p) => p.id)).toEqual(["london", "ny"]);
    expect(r.people[0]).toMatchObject({ name: "Lou", hours: "09:00–17:30" });
    expect(r.people[0].localTime).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d$/);
    expect(r.rosterWithoutRow).toEqual(["Kim"]);
    expect(r.sharedThisWeek.everyone.length).toBeGreaterThan(0);
    expect(r.sharedThisWeek.lines[0]).toMatch(/^Everyone: \d\d:\d\d–\d\d:\d\d UTC, /);
  });

  it("gives each poll's tallies and each rotation's next meeting", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [london, newYork],
      teamTimePolls: [poll({ answers: [{ name: "Lou", picks: { a: "yes", b: "no" } }] })],
      teamTimeRotations: [rotation()],
    });
    const r = await run<{
      polls: { bestSlotId: string; slots: { id: string; label: string; tally: unknown }[] }[];
      rotations: { next: { label: string; outsideHours: { name: string }[] } | null }[];
    }>("tool.team_time.list_state");
    expect(r.polls[0].bestSlotId).toBe("a");
    expect(r.polls[0].slots[0]).toMatchObject({
      label: "Tue 4 Mar 14:00 UTC",
      tally: { yes: 1, maybe: 0, no: 0 },
    });
    expect(r.rotations[0].next?.label).toMatch(/ UTC$/);
  });
});

describe("set_person", () => {
  it("adds a person, linked to the roster by name, the zone canonical", async () => {
    useWorkspaceStore.setState({ teamMembers: [{ id: "m1", name: "Lee" }] });
    const r = await run<{ saved: boolean; created: boolean; person: Record<string, unknown> }>(
      "tool.team_time.set_person",
      {
        name: "lee",
        timeZone: "asia/tokyo",
        start: "09:00",
        end: "18:00",
        workingDays: [1, 2, 3, 4, 5],
      }
    );
    expect(r).toMatchObject({ saved: true, created: true });
    expect(r.person).toMatchObject({
      name: "Lee",
      linkedToRoster: true,
      timeZone: canonicalZone("Asia/Tokyo"),
    });
    const [row] = ws().teamTimePeople ?? [];
    expect(row).toMatchObject({ teamMemberId: "m1", timeZone: canonicalZone("Asia/Tokyo") });
    expect(row.id).toMatch(/^ttp_/);
  });

  it("updates the same person's row, keeping what it doesn't name", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london] });
    const r = await run<{ saved: boolean; created: boolean }>("tool.team_time.set_person", {
      name: "Lou",
      officeDays: [2],
      site: "London office",
    });
    expect(r).toMatchObject({ saved: true, created: false });
    expect(ws().teamTimePeople).toHaveLength(1);
    expect(ws().teamTimePeople?.[0]).toMatchObject({
      id: "london",
      start: "09:00",
      end: "17:30",
      officeDays: [2],
      site: "London office",
    });
  });

  it("refuses an unknown zone, a day that ends when it starts, or a new person without hours", async () => {
    const bad = await run<{ saved: boolean; problems: string[] }>("tool.team_time.set_person", {
      name: "Ana",
      timeZone: "Mars/Base",
      start: "09:00",
      end: "09:00",
      workingDays: [1],
    });
    expect(bad.saved).toBe(false);
    expect(bad.problems.length).toBe(2);
    const missing = await run<{ saved: boolean }>("tool.team_time.set_person", { name: "Ana" });
    expect(missing.saved).toBe(false);
    expect(ws().teamTimePeople).toEqual([]);
  });
});

describe("polls", () => {
  it("finds up to 10 times, the best first, never in the past", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork, tokyo] });
    const r = await run<{
      times: { start: string; nightOrDayOff: number; earlyOrLate: number; people: unknown[] }[];
    }>("tool.team_time.find_times", { minutes: 60, days: 3 });
    expect(r.times).toHaveLength(10);
    expect(r.times[0].people).toHaveLength(3);
    const keys = r.times.map((x) => x.nightOrDayOff * 100 + x.earlyOrLate);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
    expect(r.times.every((x) => Date.parse(x.start) >= Date.now() - 60_000)).toBe(true);
    useWorkspaceStore.setState({ teamTimePeople: [] });
    expect(await run("tool.team_time.find_times", { minutes: 60 })).toEqual({
      times: [],
      reason: "no_people",
    });
  });

  it("creates a poll from future times, and refuses a past one", async () => {
    const r = await run<{ created: boolean; poll: { id: string; slots: { label: string }[] } }>(
      "tool.team_time.create_poll",
      { title: "Review", minutes: 60, slots: [FAR2, FAR] }
    );
    expect(r.created).toBe(true);
    expect(r.poll.slots.map((s) => s.label)).toEqual([
      "Tue 4 Mar 14:00 UTC",
      "Wed 5 Mar 14:00 UTC",
    ]);
    expect(ws().teamTimePolls?.[0]).toMatchObject({ status: "open", answers: [] });
    const past = await run<{ created: boolean }>("tool.team_time.create_poll", {
      title: "Old",
      minutes: 60,
      slots: ["2020-01-01T10:00:00Z"],
    });
    expect(past.created).toBe(false);
  });

  it("refuses a time with no Z or offset, which each machine would read on its own clock", () => {
    const schema = registry.get("tool.team_time.create_poll")!.paramsSchema;
    const ok = (slot: string) =>
      schema.safeParse({ title: "R", minutes: 60, slots: [slot] }).success;
    expect(ok("2031-03-04T14:00:00")).toBe(false);
    expect(ok("Mar 4 2031 14:00")).toBe(false);
    expect(ok("2031-03-04")).toBe(false);
    expect(ok(FAR)).toBe(true);
    expect(ok("2031-03-04T14:00Z")).toBe(true);
    expect(ok("2031-03-04T09:00:00-05:00")).toBe(true);
  });

  it("takes either slots or suggestions, not both", async () => {
    const schema = registry.get("tool.team_time.create_poll")!.paramsSchema;
    expect(schema.safeParse({ title: "R", minutes: 60 }).success).toBe(false);
    expect(
      schema.safeParse({ title: "R", minutes: 60, slots: [FAR], fromSuggestions: 3 }).success
    ).toBe(false);
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    const r = await run<{ created: boolean; poll: { slots: unknown[] } }>(
      "tool.team_time.create_poll",
      { title: "Review", minutes: 30, fromSuggestions: 3 }
    );
    expect(r.created).toBe(true);
    expect(r.poll.slots).toHaveLength(3);
  });

  it("records answers on an open poll, and refuses a closed one or an unknown slot", async () => {
    useWorkspaceStore.setState({ teamTimePolls: [poll()] });
    const r = await run<{ recorded: boolean; bestSlotId: string; tallies: unknown[] }>(
      "tool.team_time.record_answers",
      {
        pollId: "poll1",
        answers: [
          {
            name: "Lou",
            picks: [
              { slotId: "a", answer: "maybe" },
              { slotId: "b", answer: "yes" },
            ],
          },
          { name: "Noor", picks: [{ slotId: "b", answer: "yes" }] },
        ],
      }
    );
    expect(r).toMatchObject({ recorded: true, bestSlotId: "b" });
    expect(ws().teamTimePolls?.[0].answers).toHaveLength(2);
    expect(
      await run("tool.team_time.record_answers", {
        pollId: "poll1",
        answers: [{ name: "Lou", picks: [{ slotId: "zz", answer: "yes" }] }],
      })
    ).toMatchObject({ recorded: false, reason: "unknown_slot" });
    useWorkspaceStore.setState({ teamTimePolls: [poll({ status: "closed", chosenSlotId: "a" })] });
    expect(
      await run("tool.team_time.record_answers", {
        pollId: "poll1",
        answers: [{ name: "Lou", picks: [{ slotId: "a", answer: "yes" }] }],
      })
    ).toEqual({ recorded: false, reason: "closed" });
  });

  it("records a renamed person's answers on their own row, under their name today", async () => {
    useWorkspaceStore.setState({
      teamMembers: [{ id: "m1", name: "Louise" }],
      teamTimePeople: [{ ...london, teamMemberId: "m1" }],
      teamTimePolls: [poll({ answers: [{ name: "Lou", picks: { a: "yes" } }] })],
    });
    for (const who of ["Lou", "Louise"]) {
      const r = await run<{ recorded: boolean; answeredBy: string[] }>(
        "tool.team_time.record_answers",
        { pollId: "poll1", answers: [{ name: who, picks: [{ slotId: "b", answer: "no" }] }] }
      );
      expect(r).toMatchObject({ recorded: true, answeredBy: ["Louise"] });
    }
    expect(ws().teamTimePolls?.[0].answers).toEqual([
      { name: "Louise", picks: { a: "yes", b: "no" } },
    ]);
  });

  it("closes a poll on the chosen time and gives each person's own time", async () => {
    useWorkspaceStore.setState({ teamTimePolls: [poll()], teamTimePeople: [london, newYork] });
    const r = await run<{ chosen: boolean; people: { name: string; localTime: string }[] }>(
      "tool.team_time.choose_slot",
      { pollId: "poll1", slotId: "a" }
    );
    expect(r.chosen).toBe(true);
    expect(r.people).toEqual([
      { name: "Lou", localTime: "Tue 14:00", burden: "in hours" },
      { name: "Noor", localTime: "Tue 09:00", burden: "in hours" },
    ]);
    expect(ws().teamTimePolls?.[0]).toMatchObject({ status: "closed", chosenSlotId: "a" });
    expect(await run("tool.team_time.choose_slot", { pollId: "poll1", slotId: "b" })).toEqual({
      chosen: false,
      reason: "closed",
      chosenSlotId: "a",
    });
  });
});

function rotation(over: Partial<TeamTimeRotation> = {}): TeamTimeRotation {
  return {
    id: "rot1",
    meeting: "Retro",
    minutes: 60,
    everyWeeks: 1,
    startDate: "2026-11-16",
    mode: "in-turn",
    options: [
      { id: "A", weekday: 2, time: "09:00", timeZone: "Europe/London" },
      { id: "B", weekday: 2, time: "15:00", timeZone: "America/New_York" },
    ],
    held: [],
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

describe("plan_rotation", () => {
  const params = {
    meeting: "Retro",
    minutes: 60,
    everyWeeks: 1,
    startDate: "2026-11-16",
    mode: "in-turn",
    options: [
      { label: "Europe morning", weekday: 2, time: "09:00", timeZone: "Europe/London" },
      { label: "Americas afternoon", weekday: 2, time: "15:00", timeZone: "America/New_York" },
    ],
  };

  it("creates a rotation and returns the next 8 meetings, the totals and the fairness line", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    const r = await run<{
      saved: boolean;
      created: boolean;
      next: { option: string }[];
      totals: { name: string; points: number }[];
      fairness: string;
    }>("tool.team_time.plan_rotation", params);
    expect(r).toMatchObject({ saved: true, created: true });
    expect(r.next).toHaveLength(8);
    expect(
      r.next
        .slice(0, 2)
        .map((o) => o.option)
        .sort()
    ).toEqual(["Americas afternoon", "Europe morning"]);
    expect(r.totals.map((t) => t.name)).toEqual(["Lou", "Noor"]);
    expect(r.fairness).toMatch(/points/);
  });

  it("keeps the held meetings of the times an update keeps", async () => {
    useWorkspaceStore.setState({
      teamTimePeople: [london, newYork],
      teamTimeRotations: [
        rotation({
          held: [
            { date: "2026-11-17", optionId: "A" },
            { date: "2026-11-24", optionId: "B" },
          ],
        }),
      ],
    });
    const r = await run<{ saved: boolean; created: boolean }>("tool.team_time.plan_rotation", {
      ...params,
      id: "rot1",
      options: [params.options[0], { weekday: 4, time: "15:00", timeZone: "America/New_York" }],
    });
    expect(r).toMatchObject({ saved: true, created: false });
    const saved = ws().teamTimeRotations?.[0];
    expect(saved?.options[0].id).toBe("A");
    expect(saved?.held).toEqual([{ date: "2026-11-17", optionId: "A" }]);
  });

  it("keeps the held meetings of a time sent with another spelling of its zone", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork] });
    const options = [
      { weekday: 2, time: "09:00", timeZone: "Asia/Kolkata" },
      { weekday: 2, time: "15:00", timeZone: "Europe/London" },
    ];
    await run("tool.team_time.plan_rotation", { ...params, options });
    const created = ws().teamTimeRotations![0];
    const held = [
      { date: "2026-11-17", optionId: created.options[0].id },
      { date: "2026-11-24", optionId: created.options[1].id, skipped: true as const },
    ];
    ws().upsertTeamTimeRotation({ ...created, held });
    const r = await run<{ saved: boolean }>("tool.team_time.plan_rotation", {
      ...params,
      id: created.id,
      minutes: 45,
      options: [options[0], { ...options[1], timeZone: "europe/london" }],
    });
    expect(r.saved).toBe(true);
    const saved = ws().teamTimeRotations![0];
    expect(saved.options.map((o) => o.id)).toEqual(created.options.map((o) => o.id));
    expect(saved.held).toEqual(held);
  });

  it("keeps the same held meetings as the page after the same edit", async () => {
    const prev = rotation({
      held: [
        { date: "2026-11-17", optionId: "A" },
        { date: "2026-11-24", optionId: "B" },
      ],
    });
    useWorkspaceStore.setState({ teamTimePeople: [london, newYork], teamTimeRotations: [prev] });
    // Time 1 moves from Tue 09:00 London to Wed 15:00 Toronto; the form keeps its row's id.
    const edited = [
      { label: "", weekday: 3, time: "15:00", timeZone: "America/Toronto" },
      { label: "", weekday: 2, time: "15:00", timeZone: "America/New_York" },
    ];
    const checked = validateRotation({
      ...prev,
      options: edited.map((o, i) => ({ ...o, id: prev.options[i].id })),
    });
    if (!checked.ok) throw new Error("the page's edit didn't check out");
    const page = rotationFrom(checked.values, prev, prev.id, () => "opt_page", AT);
    await run("tool.team_time.plan_rotation", { ...params, id: "rot1", options: edited });
    const verb = ws().teamTimeRotations![0];
    expect(verb.held).toEqual(page.held);
    const plan = (r: TeamTimeRotation) =>
      nextOccurrences(r, [london, newYork], Date.parse("2026-11-26T00:00:00Z")).map(
        (o) => `${o.start} ${o.optionId === "B" ? "B" : "new"}`
      );
    expect(plan(verb)).toEqual(plan(page));
  });

  it("refuses an unknown attendee, a missing rotation or two of the same time", async () => {
    useWorkspaceStore.setState({ teamTimePeople: [london] });
    expect(
      await run("tool.team_time.plan_rotation", { ...params, attendees: ["Lou", "Nobody"] })
    ).toEqual({ saved: false, reason: "unknown_attendee", names: ["Nobody"] });
    expect(await run("tool.team_time.plan_rotation", { ...params, id: "nope" })).toEqual({
      saved: false,
      reason: "not_found",
    });
    const same = await run<{ saved: boolean }>("tool.team_time.plan_rotation", {
      ...params,
      options: [params.options[0], params.options[0]],
    });
    expect(same.saved).toBe(false);
  });
});

describe("over MCP", () => {
  it("reads and writes the user's rows on the server", async () => {
    server.rows.set("workspace:teamMember/m1", { id: "m1", name: "Lee" } as never);
    const r = await run<{ saved: boolean }>(
      "tool.team_time.set_person",
      { name: "Lee", timeZone: "Asia/Tokyo", start: "09:00", end: "18:00", workingDays: [1, 2, 3] },
      true
    );
    expect(r.saved).toBe(true);
    const rows = Array.from(server.rows.entries()).filter(([k]) =>
      k.startsWith("workspace:teamTimePerson/")
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toMatchObject({ teamMemberId: "m1" });
    expect(ws().teamTimePeople).toEqual([]);
    const state = await run<{ people: { name: string }[] }>("tool.team_time.list_state", {}, true);
    expect(state.people.map((p) => p.name)).toEqual(["Lee"]);
  });
});
