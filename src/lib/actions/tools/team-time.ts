/**
 * Team Time — tool-local actions.
 *
 * Category: Ceremonies (Team & people section)
 *
 * Agent surface: tool.team_time.*
 *   1. list_state     — people with their local time now and whether they're
 *                       in hours, this week's shared windows (UTC), the
 *                       offices' anchor days, open polls with tallies and
 *                       rotations with their next meeting.
 *   2. set_person     — add or update one person's zone, hours and days
 *                       (one row per person; a roster name links the row).
 *   3. find_times     — up to 10 meeting times ranked by who is outside
 *                       their hours (a read).
 *   4. create_poll    — a poll from given times or from the ranking.
 *   5. record_answers — who can make which time (refused on a closed poll).
 *   6. choose_slot    — close a poll on one time.
 *   7. plan_rotation  — create or update a rotating meeting; returns the next
 *                       8 meetings and each attendee's late or night points.
 * Backing CRUD: workspace.team_time_person, workspace.team_time_poll and
 * workspace.team_time_rotation (create, list, update, delete; deletes go
 * there).
 *
 * Every read goes through the row readers (lib/team-time/rows) and every
 * write through the page's validators (lib/team-time/validate). Times are
 * UTC instants; nothing here reads the machine's own time zone. Everything
 * touches only the person's own data and broadcasts nothing, so every verb
 * is open to visitors (the default).
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  TEAM_TIME_ANSWERS,
  TEAM_TIME_MAX,
  TEAM_TIME_PERSON_KIND,
  TEAM_TIME_POLL_KIND,
  TEAM_TIME_ROTATION_KIND,
  TEAM_TIME_ROTATION_MODES,
  TOOL_TEXT_MAX,
  type CeremonyCadenceDoc,
  type TeamMember,
  type TeamTimePerson,
  type TeamTimePoll,
  type TeamTimeRotation,
} from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import {
  daysLabel,
  hoursText,
  localTimeText,
  personName,
  placeLabel,
  slotLabel,
} from "@/lib/team-time/format";
import {
  chosenPoll,
  editedPerson,
  memberIdFor,
  newPerson,
  newPoll,
  readPeople,
  readPolls,
  readRotations,
  rotationFrom,
  savedCadence,
  withAnswer,
} from "@/lib/team-time/model";
import { officeGroups } from "@/lib/team-time/office";
import { sharedWindows, weekRange, windowLines } from "@/lib/team-time/overlap";
import { readPoll, readRotation, samePerson } from "@/lib/team-time/rows";
import {
  ROTATION_PLAN_COUNT,
  burdenTotals,
  fairnessLine,
  nextOccurrences,
} from "@/lib/team-time/rotation";
import {
  BURDEN_LABEL,
  MEETING_MINUTES,
  QUICK_VOTE_SLOTS,
  SUGGEST_DAYS_MAX,
  bestSlot,
  burden,
  rankSlots,
  tallies,
} from "@/lib/team-time/slots";
import { validatePerson, validatePoll, validateRotation } from "@/lib/team-time/validate";
import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;

/** MUST match registerCollection("teamMember", …) and ("ceremonyCadence", …) in workspace-store.ts. */
const KIND_MEMBER = "workspace:teamMember";
const KIND_CADENCE = "workspace:ceremonyCadence";

/** Where Team Time's rows live: the browser's workspace, or the user's rows on the server. */
interface TeamTimeStore {
  people(): Promise<unknown[]>;
  polls(): Promise<unknown[]>;
  rotations(): Promise<unknown[]>;
  roster(): Promise<TeamMember[]>;
  cadences(): Promise<CeremonyCadenceDoc[]>;
  putPerson(p: TeamTimePerson): Promise<void>;
  putPoll(p: TeamTimePoll): Promise<void>;
  putRotation(r: TeamTimeRotation): Promise<void>;
}

const browserStore: TeamTimeStore = {
  people: async () => ws().teamTimePeople ?? [],
  polls: async () => ws().teamTimePolls ?? [],
  rotations: async () => ws().teamTimeRotations ?? [],
  roster: async () => ws().teamMembers ?? [],
  cadences: async () => ws().ceremonyCadences ?? [],
  putPerson: async (p) => ws().upsertTeamTimePerson(p),
  putPoll: async (p) => ws().upsertTeamTimePoll(p),
  putRotation: async (r) => ws().upsertTeamTimeRotation(r),
};

function serverStore(userId: string): TeamTimeStore {
  return {
    people: () => serverListEntities<TeamTimePerson>(userId, TEAM_TIME_PERSON_KIND),
    polls: () => serverListEntities<TeamTimePoll>(userId, TEAM_TIME_POLL_KIND),
    rotations: () => serverListEntities<TeamTimeRotation>(userId, TEAM_TIME_ROTATION_KIND),
    roster: () => serverListEntities<TeamMember>(userId, KIND_MEMBER),
    cadences: () => serverListEntities<CeremonyCadenceDoc>(userId, KIND_CADENCE),
    putPerson: async (p) => {
      await serverUpsertEntity<TeamTimePerson>(userId, TEAM_TIME_PERSON_KIND, p);
    },
    putPoll: async (p) => {
      await serverUpsertEntity<TeamTimePoll>(userId, TEAM_TIME_POLL_KIND, p);
    },
    putRotation: async (r) => {
      await serverUpsertEntity<TeamTimeRotation>(userId, TEAM_TIME_ROTATION_KIND, r);
    },
  };
}

const nowIso = () => new Date().toISOString();
const iso = (t: number) => new Date(t).toISOString();

/** The people, the roster and a name for each person id. */
async function team(store: TeamTimeStore) {
  const [people, roster] = await Promise.all([store.people().then(readPeople), store.roster()]);
  const names = new Map(people.map((p) => [p.id, personName(p, roster)]));
  return { people, roster, name: (id: string) => names.get(id) ?? id };
}

const describeSlot = (start: string) => ({ start, label: slotLabel(start) });

/* ── tool.team_time.list_state ───────────────────────────────────────── */

async function listState(store: TeamTimeStore): Promise<Out> {
  const { people, roster, name } = await team(store);
  const [polls, rotations, cadences] = await Promise.all([
    store.polls().then(readPolls),
    store.rotations().then(readRotations),
    store.cadences(),
  ]);
  const now = Date.now();
  const week = weekRange("UTC", now);
  const shared = sharedWindows(people, week.from, week.to);
  const line = (l: ReturnType<typeof windowLines>[number]) =>
    `${l.start}–${l.end} UTC, ${daysLabel(l.days)}${l.leftOut ? ` (all but ${name(l.leftOut)})` : ""}`;
  const holidays = savedCadence(cadences)?.holidays;
  const withRows = new Set(people.map((p) => p.teamMemberId).filter(Boolean));
  return {
    now: iso(now),
    people: people.map((p) => {
      const b = burden(p, now, now + 60_000);
      return {
        id: p.id,
        name: name(p.id),
        ...(p.teamMemberId ? { teamMemberId: p.teamMemberId } : {}),
        timeZone: p.timeZone,
        place: placeLabel(p),
        hours: hoursText(p),
        workingDays: daysLabel(p.workingDays),
        officeDays: p.officeDays ? daysLabel(p.officeDays) : null,
        localTime: localTimeText(p.timeZone, now),
        inHours: b === 0,
      };
    }),
    rosterWithoutRow: roster
      .filter((m) => !withRows.has(m.id) && !people.some((p) => samePerson(p, { name: m.name })))
      .map((m) => m.name),
    sharedThisWeek: {
      from: iso(week.from),
      to: iso(week.to),
      everyone: shared.everyone.map((w) => ({ start: iso(w.start), end: iso(w.end) })),
      allButOne: shared.allButOne.map((w) => ({
        start: iso(w.start),
        end: iso(w.end),
        leftOut: w.leftOut ? name(w.leftOut) : null,
      })),
      lines: [
        ...windowLines(shared.everyone, "UTC").map((l) => `Everyone: ${line(l)}`),
        ...windowLines(shared.allButOne, "UTC").map((l) => `All but one: ${line(l)}`),
      ],
    },
    offices: officeGroups(people).map((g) => ({
      office: g.label,
      people: g.people.map(name),
      anchorDays: g.anchorDays.map((d) => WEEKDAY_LABEL[d]),
      inOn: Object.fromEntries(g.inOn.map((ids, d) => [WEEKDAY_LABEL[d], ids.map(name)])),
      neverMeet: g.neverMeet.map(([a, b]) => [name(a), name(b)]),
    })),
    polls: polls.map((p) => {
      const t = tallies(p);
      return {
        id: p.id,
        title: p.title,
        minutes: p.minutes,
        status: p.status,
        chosenSlotId: p.chosenSlotId ?? null,
        bestSlotId: bestSlot(p),
        slots: p.slots.map((s) => ({ id: s.id, ...describeSlot(s.start), tally: t[s.id] })),
        answeredBy: p.answers.map((a) => a.name),
      };
    }),
    rotations: rotations.map((r) => {
      const next = nextOccurrences(r, people, now, 1, { holidays })[0];
      const option = next ? r.options.find((o) => o.id === next.optionId) : undefined;
      return {
        id: r.id,
        meeting: r.meeting,
        minutes: r.minutes,
        everyWeeks: r.everyWeeks,
        mode: r.mode,
        options: r.options,
        next: next
          ? {
              date: next.date,
              optionId: next.optionId,
              option: option?.label ?? null,
              ...describeSlot(next.start),
              outsideHours: Object.entries(next.burdens)
                .filter(([, b]) => b > 0)
                .map(([id, b]) => ({ name: name(id), burden: BURDEN_LABEL[b] })),
            }
          : null,
      };
    }),
  };
}

registry.register({
  id: "tool.team_time.list_state",
  toolId: "tool.team_time",
  name: "list_state",
  category: "read",
  description:
    "List Team Time as the page shows it: each person's zone, hours (on their own clock), working and office days, their local time now and whether they're in hours; roster names with no row yet; this week's shared windows in UTC (everyone, and all but one with who is left out) with lines to quote; each office's anchor day(s), who is in each weekday and pairs who never meet; polls with each time's yes / if needed (maybe) / no tally and the best time; rotations with their next meeting and who it lands outside hours for. Returns {now, people[], rosterWithoutRow[], sharedThisWeek: {from, to, everyone[], allButOne[], lines[]}, offices[], polls[], rotations[]}. Add, edit and remove rows with workspace.team_time_person / _poll / _rotation.",
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_p, ctx) => listState(serverStore(ctx.userId)),
});

/* ── tool.team_time.set_person ───────────────────────────────────────── */

const TimeParam = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "HH:MM, 24-hour");
const Weekdays = z.array(z.number().int().min(0).max(6)).max(7);

const SetPersonParams = z.object({
  name: z.string().trim().min(1).max(TOOL_TEXT_MAX.short).describe("Their name, as on the roster."),
  timeZone: z
    .string()
    .max(TEAM_TIME_MAX.zone)
    .optional()
    .describe('Their IANA time zone, such as "Asia/Tokyo". Needed for a new person.'),
  start: TimeParam.optional().describe("When their working day starts, HH:MM on their clock."),
  end: TimeParam.optional().describe(
    "When it ends, HH:MM. Earlier than the start: a shift past midnight."
  ),
  workingDays: Weekdays.optional().describe("Days they work, 0 Sunday to 6 Saturday."),
  officeDays: Weekdays.optional().describe(
    "Days in the office, among the working days; [] clears."
  ),
  site: z.string().max(TEAM_TIME_MAX.site).optional().describe("Their office; empty clears."),
  note: z.string().max(TOOL_TEXT_MAX.text).optional(),
});

async function setPerson(
  store: TeamTimeStore,
  params: z.infer<typeof SetPersonParams>
): Promise<Out> {
  const [raw, roster] = await Promise.all([store.people(), store.roster()]);
  const people = readPeople(raw);
  const teamMemberId = memberIdFor(roster, params.name);
  const existing = people.find((p) =>
    samePerson(p, { name: params.name, ...(teamMemberId ? { teamMemberId } : {}) })
  );
  const draft = {
    name: params.name,
    teamMemberId: teamMemberId ?? existing?.teamMemberId,
    timeZone: params.timeZone ?? existing?.timeZone ?? "",
    start: params.start ?? existing?.start ?? "",
    end: params.end ?? existing?.end ?? "",
    workingDays: params.workingDays ?? existing?.workingDays ?? [],
    officeDays: params.officeDays ?? existing?.officeDays ?? [],
    site: params.site ?? existing?.site ?? "",
    note: params.note ?? existing?.note ?? "",
  };
  // Rows that don't read count too: a second row for the same person is refused either way.
  const others = raw
    .map((r) => (r && typeof r === "object" ? (r as TeamTimePerson) : null))
    .filter((r): r is TeamTimePerson => r !== null && r.id !== existing?.id);
  const checked = validatePerson(draft, others);
  if (!checked.ok) {
    return { saved: false, reason: "invalid", problems: Object.values(checked.errors) };
  }
  const now = nowIso();
  const person = existing
    ? editedPerson(existing, checked.values, now)
    : newPerson(checked.values, `ttp_${nanoid(8)}`, now);
  await store.putPerson(person);
  return {
    saved: true,
    created: !existing,
    person: {
      id: person.id,
      name: personName(person, roster),
      linkedToRoster: Boolean(person.teamMemberId),
      timeZone: person.timeZone,
      hours: hoursText(person),
      workingDays: daysLabel(person.workingDays),
      officeDays: person.officeDays ? daysLabel(person.officeDays) : null,
      site: person.site ?? null,
      localTime: localTimeText(person.timeZone, Date.now()),
    },
  };
}

registry.register({
  id: "tool.team_time.set_person",
  toolId: "tool.team_time",
  name: "set_person",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add or update one person on Team Time, as the page's People tab does: their IANA time zone (stored in its canonical spelling), working hours on their own clock (HH:MM; an end before the start is a shift past midnight), working days and office days (0 Sunday to 6 Saturday; office days must be working days) and their office. One row per person: the same roster member, or the same name, updates that row, and a name on the roster links the row to the member. For an update, fields left out stay as they are. Returns {saved: true, created, person} or {saved: false, reason: 'invalid', problems[]}.",
  paramsSchema: SetPersonParams,
  handler: async (p) => setPerson(browserStore, p),
  mcpHandler: async (p, ctx) => setPerson(serverStore(ctx.userId), p),
});

/* ── tool.team_time.find_times ───────────────────────────────────────── */

const FindTimesParams = z.object({
  minutes: z
    .number()
    .int()
    .min(MEETING_MINUTES.min)
    .max(MEETING_MINUTES.max)
    .describe("The meeting's length in minutes."),
  days: z
    .number()
    .int()
    .min(1)
    .max(SUGGEST_DAYS_MAX)
    .default(7)
    .describe("How many days ahead to look, 1 to 14."),
});

/** At most this many times come back from find_times. */
const FIND_TIMES_MAX = 10;

async function findTimes(
  store: TeamTimeStore,
  params: z.infer<typeof FindTimesParams>
): Promise<Out> {
  const { people, name } = await team(store);
  if (people.length === 0) return { times: [], reason: "no_people" };
  const ranked = rankSlots(people, {
    minutes: params.minutes,
    from: Date.now(),
    days: params.days,
    limit: FIND_TIMES_MAX,
  });
  return {
    times: ranked.map((s) => ({
      ...describeSlot(s.start),
      nightOrDayOff: s.night,
      earlyOrLate: s.outside,
      people: people.map((p) => ({
        name: name(p.id),
        localTime: localTimeText(p.timeZone, Date.parse(s.start)),
        burden: BURDEN_LABEL[s.burdens[p.id]],
      })),
    })),
  };
}

registry.register({
  id: "tool.team_time.find_times",
  toolId: "tool.team_time",
  name: "find_times",
  category: "read",
  description: `Find meeting times for everyone on Team Time, as the poll's "Suggest times" does: every half hour (UTC) over the next 1–14 days, never in the past, ranked by fewest people at night (22:00–06:59 on their clock) or on a day off, then fewest early or late, then the earliest; up to ${FIND_TIMES_MAX}. Params: minutes (${MEETING_MINUTES.min}–${MEETING_MINUTES.max}), days. Returns {times: {start, label (UTC), nightOrDayOff, earlyOrLate, people: {name, localTime, burden: 'in hours' | 'early or late' | 'night or day off'}[]}[]}.`,
  paramsSchema: FindTimesParams,
  handler: async (p) => findTimes(browserStore, p),
  mcpHandler: async (p, ctx) => findTimes(serverStore(ctx.userId), p),
});

/* ── tool.team_time.create_poll ──────────────────────────────────────── */

const CreatePollParams = z
  .object({
    title: z.string().trim().min(1).max(TOOL_TEXT_MAX.short).describe("What the poll is for."),
    minutes: z.number().int().min(MEETING_MINUTES.min).max(MEETING_MINUTES.max),
    slots: z
      .array(z.string().max(40))
      .max(TEAM_TIME_MAX.slots)
      .optional()
      .describe("The times to offer, ISO instants in the future."),
    fromSuggestions: z
      .number()
      .int()
      .min(1)
      .max(QUICK_VOTE_SLOTS)
      .optional()
      .describe("Or: offer this many of find_times's best times instead."),
    days: z
      .number()
      .int()
      .min(1)
      .max(SUGGEST_DAYS_MAX)
      .optional()
      .describe("With fromSuggestions: days ahead."),
  })
  .refine((p) => (p.slots !== undefined) !== (p.fromSuggestions !== undefined), {
    message: "Give either slots or fromSuggestions, not both.",
  });

async function createPoll(
  store: TeamTimeStore,
  params: z.infer<typeof CreatePollParams>
): Promise<Out> {
  const now = Date.now();
  let starts = params.slots ?? [];
  if (params.fromSuggestions !== undefined) {
    const { people } = await team(store);
    if (people.length === 0) return { created: false, reason: "no_people" };
    starts = rankSlots(people, {
      minutes: params.minutes,
      from: now,
      days: params.days ?? 7,
      limit: params.fromSuggestions,
    }).map((s) => s.start);
  }
  const checked = validatePoll(
    { title: params.title, minutes: params.minutes, starts },
    { now, added: starts }
  );
  if (!checked.ok) {
    return { created: false, reason: "invalid", problems: Object.values(checked.errors) };
  }
  const poll = newPoll(checked.values, `ttpoll_${nanoid(8)}`, () => `slot_${nanoid(8)}`, iso(now));
  await store.putPoll(poll);
  return {
    created: true,
    poll: {
      id: poll.id,
      title: poll.title,
      minutes: poll.minutes,
      slots: poll.slots.map((s) => ({ id: s.id, ...describeSlot(s.start) })),
    },
  };
}

registry.register({
  id: "tool.team_time.create_poll",
  toolId: "tool.team_time",
  name: "create_poll",
  category: "write",
  requiresConfirmation: false,
  description: `Create a Team Time poll for a meeting time, as the page's Find a time tab does: a title, the meeting's length (${MEETING_MINUTES.min}–${MEETING_MINUTES.max} minutes) and either slots (up to ${TEAM_TIME_MAX.slots} ISO instants, each in the future and different) or fromSuggestions (1–${QUICK_VOTE_SLOTS} of find_times's best times). The facilitator then records who can make each time (record_answers) and chooses one (choose_slot). Returns {created: true, poll: {id, slots: {id, start, label}[]}} or {created: false, reason: 'invalid' | 'no_people', problems?}.`,
  paramsSchema: CreatePollParams,
  handler: async (p) => createPoll(browserStore, p),
  mcpHandler: async (p, ctx) => createPoll(serverStore(ctx.userId), p),
});

/* ── tool.team_time.record_answers ───────────────────────────────────── */

const RecordAnswersParams = z.object({
  pollId: z.string().min(1).max(64),
  answers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(TOOL_TEXT_MAX.short),
        picks: z
          .array(z.object({ slotId: z.string().min(1).max(64), answer: z.enum(TEAM_TIME_ANSWERS) }))
          .max(TEAM_TIME_MAX.slots),
      })
    )
    .min(1)
    .max(TEAM_TIME_MAX.answers),
});

async function findPoll(store: TeamTimeStore, id: string) {
  const raw = (await store.polls()).find(
    (p) => p && typeof p === "object" && (p as { id?: unknown }).id === id
  );
  return raw ? readPoll(raw) : null;
}

async function recordAnswers(
  store: TeamTimeStore,
  params: z.infer<typeof RecordAnswersParams>
): Promise<Out> {
  const poll = await findPoll(store, params.pollId);
  if (!poll) return { recorded: false, reason: "not_found" };
  if (poll.status === "closed") return { recorded: false, reason: "closed" };
  const ids = new Set(poll.slots.map((s) => s.id));
  const unknown = params.answers
    .flatMap((a) => a.picks.map((p) => p.slotId))
    .filter((id) => !ids.has(id));
  if (unknown.length > 0) {
    return { recorded: false, reason: "unknown_slot", slotIds: Array.from(new Set(unknown)) };
  }
  const newNames = new Set(
    params.answers
      .map((a) => nameKey(a.name))
      .filter((k) => !poll.answers.some((x) => nameKey(x.name) === k))
  );
  if (poll.answers.length + newNames.size > TEAM_TIME_MAX.answers) {
    return { recorded: false, reason: "too_many_people", max: TEAM_TIME_MAX.answers };
  }
  const now = nowIso();
  let next = poll;
  for (const a of params.answers) {
    for (const p of a.picks) next = withAnswer(next, a.name, p.slotId, p.answer, now);
  }
  await store.putPoll(next);
  const t = tallies(next);
  return {
    recorded: true,
    answeredBy: next.answers.map((a) => a.name),
    tallies: next.slots.map((s) => ({ slotId: s.id, label: slotLabel(s.start), ...t[s.id] })),
    bestSlotId: bestSlot(next),
  };
}

registry.register({
  id: "tool.team_time.record_answers",
  toolId: "tool.team_time",
  name: "record_answers",
  category: "write",
  requiresConfirmation: false,
  description: `Record who can make which time on an open Team Time poll, as the facilitator does on the page: for each person (by name), yes, maybe ("if needed") or no per slot id. Picks left out stay as they are. Refused on a closed poll. Params: pollId, answers: {name, picks: {slotId, answer}[]}[] (up to ${TEAM_TIME_MAX.answers} people). Returns {recorded: true, answeredBy, tallies: {slotId, label, yes, maybe, no}[], bestSlotId} or {recorded: false, reason: 'not_found' | 'closed' | 'unknown_slot' | 'too_many_people'}.`,
  paramsSchema: RecordAnswersParams,
  handler: async (p) => recordAnswers(browserStore, p),
  mcpHandler: async (p, ctx) => recordAnswers(serverStore(ctx.userId), p),
});

/* ── tool.team_time.choose_slot ──────────────────────────────────────── */

const ChooseSlotParams = z.object({
  pollId: z.string().min(1).max(64),
  slotId: z.string().min(1).max(64).describe("The time to choose (see list_state)."),
});

async function chooseSlot(
  store: TeamTimeStore,
  params: z.infer<typeof ChooseSlotParams>
): Promise<Out> {
  const poll = await findPoll(store, params.pollId);
  if (!poll) return { chosen: false, reason: "not_found" };
  const slot = poll.slots.find((s) => s.id === params.slotId);
  if (!slot) return { chosen: false, reason: "unknown_slot" };
  if (poll.status === "closed" && poll.chosenSlotId !== slot.id) {
    return { chosen: false, reason: "closed", chosenSlotId: poll.chosenSlotId ?? null };
  }
  if (poll.status !== "closed") await store.putPoll(chosenPoll(poll, slot.id, nowIso()));
  const { people, name } = await team(store);
  const at = Date.parse(slot.start);
  return {
    chosen: true,
    poll: { id: poll.id, title: poll.title, minutes: poll.minutes },
    slot: { id: slot.id, ...describeSlot(slot.start) },
    people: people.map((p) => ({
      name: name(p.id),
      localTime: localTimeText(p.timeZone, at),
      burden: BURDEN_LABEL[burden(p, at, at + poll.minutes * 60_000)],
    })),
  };
}

registry.register({
  id: "tool.team_time.choose_slot",
  toolId: "tool.team_time",
  name: "choose_slot",
  category: "write",
  requiresConfirmation: false,
  description:
    "Choose a time on a Team Time poll, as the page's Choose does: the poll closes on that slot. Returns {chosen: true, poll, slot: {id, start, label}, people: {name, localTime, burden}[]} (each person's own time) or {chosen: false, reason: 'not_found' | 'unknown_slot' | 'closed' (already closed on another slot)}.",
  paramsSchema: ChooseSlotParams,
  handler: async (p) => chooseSlot(browserStore, p),
  mcpHandler: async (p, ctx) => chooseSlot(serverStore(ctx.userId), p),
});

/* ── tool.team_time.plan_rotation ────────────────────────────────────── */

const PlanRotationParams = z.object({
  id: z.string().min(1).max(64).optional().describe("The rotation to update; left out, a new one."),
  meeting: z.string().trim().min(1).max(TOOL_TEXT_MAX.short).describe("The meeting that rotates."),
  minutes: z.number().int().min(MEETING_MINUTES.min).max(MEETING_MINUTES.max),
  everyWeeks: z.number().int().min(1).max(4).describe("How often it meets, every 1 to 4 weeks."),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      "The first meeting's week, YYYY-MM-DD: each meeting is on its option's weekday on or after it."
    ),
  mode: z
    .enum(TEAM_TIME_ROTATION_MODES)
    .describe(
      "in-turn: each time in order; fairest: the time that keeps the worst-off attendee's points lowest."
    ),
  options: z
    .array(
      z.object({
        label: z.string().max(TEAM_TIME_MAX.label).optional(),
        weekday: z.number().int().min(0).max(6),
        time: TimeParam,
        timeZone: z
          .string()
          .max(TEAM_TIME_MAX.zone)
          .describe("The zone whose clock the time is on."),
      })
    )
    .min(2)
    .max(TEAM_TIME_MAX.options),
  attendees: z
    .array(z.string().min(1).max(TOOL_TEXT_MAX.short))
    .max(TEAM_TIME_MAX.attendees)
    .optional()
    .describe("Who attends, by name or Team Time person id; left out, everyone."),
});

async function planRotation(
  store: TeamTimeStore,
  params: z.infer<typeof PlanRotationParams>
): Promise<Out> {
  const { people, name } = await team(store);
  const [rotations, cadences] = await Promise.all([store.rotations(), store.cadences()]);
  const rawPrev = params.id
    ? rotations.find((r) => r && typeof r === "object" && (r as { id?: unknown }).id === params.id)
    : undefined;
  const prev = rawPrev ? readRotation(rawPrev) : null;
  if (params.id && !prev) return { saved: false, reason: "not_found" };
  const unknown: string[] = [];
  const attendees = params.attendees?.map((who) => {
    const p = people.find(
      (x) =>
        x.id === who || nameKey(name(x.id)) === nameKey(who) || nameKey(x.name) === nameKey(who)
    );
    if (!p) unknown.push(who);
    return p?.id ?? who;
  });
  if (unknown.length > 0) return { saved: false, reason: "unknown_attendee", names: unknown };
  // rotationFrom keeps the id (and the held meetings) of each time whose
  // weekday, time and zone stay the same, as the page does.
  const options = params.options.map((o) => ({
    label: o.label ?? "",
    weekday: o.weekday,
    time: o.time,
    timeZone: o.timeZone,
  }));
  const checked = validateRotation({ ...params, options, ...(attendees ? { attendees } : {}) });
  if (!checked.ok) {
    return { saved: false, reason: "invalid", problems: Object.values(checked.errors) };
  }
  const now = Date.now();
  const rotation = rotationFrom(
    checked.values,
    prev,
    prev?.id ?? `ttrot_${nanoid(8)}`,
    () => `opt_${nanoid(8)}`,
    iso(now)
  );
  await store.putRotation(rotation);
  const holidays = savedCadence(cadences)?.holidays;
  const next = nextOccurrences(rotation, people, now, ROTATION_PLAN_COUNT, { holidays });
  const totals = burdenTotals(rotation, people, now, ROTATION_PLAN_COUNT, { holidays });
  const place = (id: string) => {
    const p = people.find((x) => x.id === id);
    return p ? placeLabel(p) : "";
  };
  return {
    saved: true,
    created: !prev,
    rotation: {
      id: rotation.id,
      meeting: rotation.meeting,
      mode: rotation.mode,
      options: rotation.options,
    },
    next: next.map((o) => ({
      date: o.date,
      option: rotation.options.find((x) => x.id === o.optionId)?.label ?? null,
      optionId: o.optionId,
      ...describeSlot(o.start),
      outsideHours: Object.entries(o.burdens)
        .filter(([, b]) => b > 0)
        .map(([id, b]) => ({ name: name(id), burden: BURDEN_LABEL[b] })),
    })),
    totals: totals.totals.map((t) => ({ name: name(t.personId), points: t.points })),
    spread: totals.spread,
    fairness: fairnessLine(totals, name, place),
  };
}

registry.register({
  id: "tool.team_time.plan_rotation",
  toolId: "tool.team_time",
  name: "plan_rotation",
  category: "write",
  requiresConfirmation: false,
  description: `Create or update a Team Time rotation, as the page's Rotate tab does: a meeting that moves between 2–${TEAM_TIME_MAX.options} times (a weekday and HH:MM on a zone's clock), every 1–4 weeks from startDate, in-turn or fairest, for its attendees (everyone by default). Updating keeps the held and skipped meetings of the times it keeps (the same weekday, time and zone, any spelling of the zone); a changed time starts with none. A past meeting nobody marked counts as held, so the plan goes on after it. Returns {saved: true, created, rotation, next: the next ${ROTATION_PLAN_COUNT} meetings {date, option, start, label, outsideHours: {name, burden}[]}, totals: {name, points}[] (1 per meeting early or late, 2 at night or on a day off, held plus planned), spread, fairness (a sentence to quote)} or {saved: false, reason: 'not_found' | 'unknown_attendee' | 'invalid', problems?}. Mark meetings held or skipped with workspace.team_time_rotation.update (its held list).`,
  paramsSchema: PlanRotationParams,
  handler: async (p) => planRotation(browserStore, p),
  mcpHandler: async (p, ctx) => planRotation(serverStore(ctx.userId), p),
});
