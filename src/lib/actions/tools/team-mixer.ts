/**
 * Team Mixer — tool-local actions.
 *
 * Category: Workshops & Facilitation
 * Tool:     Random groups and pairs, balanced by role or skill, with
 *           keep-apart and keep-together rules, rounds that avoid earlier
 *           pairings (coffee chats, pair rotation) and World Café tables.
 *
 * Agent surface: tool.team_mixer.*
 *   1. list_state   — who is in the mix, the settings, the rules, the
 *                     latest rounds and the World Café plan.
 *   2. make_groups  — set who is in the mix and how (all optional), then
 *                     mix: a round of groups or pairs, or a café plan.
 *   3. next_round   — the next round with the same settings, avoiding the
 *                     pairings so far; in a café, the next round's tables.
 *
 * The tool store (`agile-toolkit:team-mixer`) lives in the browser and
 * syncs to the cloud, so in the tab these read and write it, through the
 * same pure lib/team-mixer the page uses. Over MCP the cloud copy is read
 * and the mix is worked out the same way, but nothing is saved (the tool
 * has no server write); the result says so. Nothing here reaches anyone
 * else: showing groups on the room screen is the host's own click.
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverGetUserStateBlob, serverListEntities } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  BALANCES,
  MIXER_LIMITS,
  MIX_MODES,
  ODD_POLICIES,
  groupLabel,
  type MixIssue,
} from "@/lib/team-mixer/model";
import { cafeMoves } from "@/lib/team-mixer/cafe";
import {
  addPeople,
  mixNow,
  settingsPreview,
  rotationNote,
  settingsProblem,
  showCafeRound,
} from "@/lib/team-mixer/ops";
import {
  hasExampleRows,
  normalizeMixerState,
  type MixerCafe,
  type MixerRound,
  type MixerState,
} from "@/lib/team-mixer/state";
import { TEAM_MIXER_STORE_KEY, loadMixer, readMixer, writeMixer } from "@/lib/team-mixer/store";

const KIND_TEAM = "workspace:teamMember";

/** Over MCP: what the tool can't do from here, in plain words. */
export const NOT_SAVED_NOTE =
  "Team Mixer keeps its rounds in the browser, so this mix wasn't saved. Open Team Mixer and ask again there to keep it.";

/* ── The store adapter ───────────────────────────────────────────────── */

interface MixerStore {
  read(): Promise<MixerState>;
  roster(): Promise<TeamMember[]>;
  /** Save the new state; false when this transport can't. */
  write(next: MixerState): Promise<boolean>;
}

const realRoster = (members: readonly TeamMember[] | undefined): TeamMember[] =>
  (members ?? []).filter((m) => !isExampleId(m.id) && m.name.trim());

const browserStore: MixerStore = {
  read: async () => {
    await loadMixer();
    return readMixer();
  },
  roster: async () => realRoster(useWorkspaceStore.getState().teamMembers),
  write: async (next) => {
    writeMixer(next);
    return true;
  },
};

function serverStore(userId: string): MixerStore {
  return {
    read: async () =>
      normalizeMixerState(await serverGetUserStateBlob(userId, TEAM_MIXER_STORE_KEY)),
    roster: async () => realRoster(await serverListEntities<TeamMember>(userId, KIND_TEAM)),
    write: async () => false,
  };
}

/* ── Shapes the agent gets back ──────────────────────────────────────── */

const issueText = (issues: readonly MixIssue[]) => issues.map((i) => i.text);

function roundOut(r: MixerRound) {
  return {
    id: r.id,
    number: r.number,
    at: r.at,
    mode: r.mode,
    title: r.title ?? null,
    balance: r.balance,
    groups: r.groups.map((g, i) => ({
      label: g.name ?? groupLabel(r.mode, i),
      people: g.people,
    })),
    sitOut: r.sitOut,
    issues: issueText(r.issues),
  };
}

function cafeRoundOut(cafe: MixerCafe, index: number) {
  const tables = cafe.rounds[index] ?? [];
  return {
    round: index + 1,
    rounds: cafe.rounds.length,
    tables: tables.map((t, i) => ({
      label: t.name ?? groupLabel("cafe", i),
      host: t.host,
      guests: t.guests,
    })),
  };
}

function cafeOut(cafe: MixerCafe) {
  const moves = cafeMoves({ hosts: cafe.rounds[0].map((t) => t.host), rounds: cafe.rounds });
  return {
    id: cafe.id,
    at: cafe.at,
    title: cafe.title ?? null,
    balance: cafe.balance,
    current: cafe.current + 1,
    rounds: cafe.rounds.length,
    hosts: cafe.rounds[0].map((t) => t.host),
    onScreen: cafeRoundOut(cafe, cafe.current),
    whoGoesWhere: Array.from(moves.entries()).map(([name, tables]) => ({
      name,
      tables: tables.map((t) => (t >= 0 ? t + 1 : null)),
    })),
    issues: issueText(cafe.issues),
  };
}

function settingsOut(s: MixerState) {
  return {
    mode: s.mode,
    split: s.split,
    groupSize: s.size,
    groupCount: s.count,
    balance: s.balance,
    odd: s.odd,
    tables: s.tables,
    cafeRounds: s.cafeRounds,
    hosts: s.hosts.filter(Boolean),
    title: s.title || null,
  };
}

/* ── list_state ──────────────────────────────────────────────────────── */

async function listState(store: MixerStore) {
  const s = await store.read();
  const first = Math.max(0, s.rounds.length - 10);
  return {
    people: s.people.map((p) => p.name),
    settings: settingsOut(s),
    preview: settingsPreview(s),
    problem: settingsProblem(s),
    rules: s.rules.map((r) => ({ id: r.id, kind: r.kind, a: r.a, b: r.b })),
    roundCount: s.rounds.length,
    rounds: s.rounds.slice(first).map(roundOut),
    pairRotation: s.mode === "pairs" ? rotationNote(s) : null,
    cafe: s.cafe ? cafeOut(s.cafe) : null,
    hasExample: hasExampleRows(s),
  };
}

registry.register({
  id: "tool.team_mixer.list_state",
  toolId: "tool.team_mixer",
  name: "list_state",
  category: "read",
  description: `Read Team Mixer as the page shows it. Returns {people: names in the mix (up to ${MIXER_LIMITS.people}), settings: {mode: 'groups' | 'pairs' | 'cafe', split: 'size' | 'count', groupSize, groupCount, balance: 'none' | 'role' | 'skill', odd: 'trio' | 'sit-out' (pairs with an odd number), tables, cafeRounds, hosts, title | null}, preview (one line on what the settings make, e.g. '3 groups of 4') | null, problem (why the settings can't be mixed now) | null, rules: {id, kind: 'apart' | 'together', a, b}[], roundCount (rounds kept, up to ${MIXER_LIMITS.rounds}), rounds: the latest 10 rounds, oldest first, each {id, number (its number in the series, from 1; it goes on counting past the rounds kept), at, mode, title, balance, groups: {label, people}[], sitOut, issues (plain-words lines: broken rules, pairs who met before, who sits out)}, pairRotation (mode pairs: one line on what the rotation can promise with these people and rules) | null, cafe: {id, current (1-based round on screen), rounds, hosts, onScreen: {round, rounds, tables: {label, host, guests}[]}, whoGoesWhere: {name, tables: (number | null)[]}[], issues} | null, hasExample}. Roles and skills for balancing come from the Team page roster, matched by name.`,
  paramsSchema: z.object({}),
  handler: async () => listState(browserStore),
  mcpHandler: async (_params, ctx) => listState(serverStore(ctx.userId)),
});

/* ── make_groups ─────────────────────────────────────────────────────── */

const NameSchema = z.string().trim().min(1).max(MIXER_LIMITS.name);

const MakeGroupsParams = z
  .object({
    people: z
      .array(NameSchema)
      .max(MIXER_LIMITS.people)
      .optional()
      .describe(
        "Who is in the mix, by name: replaces the list. Names on the Team page bring their role and skills."
      ),
    fromRoster: z
      .boolean()
      .optional()
      .describe("Put everyone on the Team page in the mix (ignored when people is given)."),
    mode: z.enum(MIX_MODES).optional().describe("groups, pairs, or cafe (World Café tables)."),
    groupSize: z
      .number()
      .int()
      .min(2)
      .max(MIXER_LIMITS.groupSize)
      .optional()
      .describe("Groups of this size (mode groups). Give this or groupCount, not both."),
    groupCount: z
      .number()
      .int()
      .min(2)
      .max(MIXER_LIMITS.groups)
      .optional()
      .describe("This many groups (mode groups)."),
    balance: z
      .enum(BALANCES)
      .optional()
      .describe("Spread each role, or each skill, across the groups (from the Team page)."),
    odd: z
      .enum(ODD_POLICIES)
      .optional()
      .describe("Pairs with an odd number of people: one trio, or one person sits out."),
    tables: z
      .number()
      .int()
      .min(2)
      .max(MIXER_LIMITS.tables)
      .optional()
      .describe("World Café tables."),
    rounds: z
      .number()
      .int()
      .min(1)
      .max(MIXER_LIMITS.cafeRounds)
      .optional()
      .describe("World Café rounds."),
    hosts: z
      .array(z.string().trim().max(MIXER_LIMITS.name))
      .max(MIXER_LIMITS.tables)
      .optional()
      .describe("World Café hosts by table, in order; a blank one is picked at random."),
    title: z
      .string()
      .trim()
      .max(MIXER_LIMITS.title)
      .optional()
      .describe("What the groups are for, shown with them."),
    fresh: z
      .boolean()
      .optional()
      .describe(
        "Forget the earlier rounds first, so old pairings no longer count. Default false: the new mix avoids them."
      ),
    seed: z
      .number()
      .int()
      .min(0)
      .max(0xffffffff)
      .optional()
      .describe("A seed, to get the same mix again. Default a fresh one."),
  })
  .refine((p) => p.groupSize === undefined || p.groupCount === undefined, {
    message: "Give groupSize or groupCount, not both.",
  });

type MakeGroupsInput = z.infer<typeof MakeGroupsParams>;

function mixResult(step: Extract<ReturnType<typeof mixNow>, { ok: true }>, saved: boolean) {
  const base = saved ? { saved: true as const } : { saved: false as const, note: NOT_SAVED_NOTE };
  if (step.cafe) {
    return { mixed: true as const, ...base, kind: "cafe" as const, cafe: cafeOut(step.cafe) };
  }
  return {
    mixed: true as const,
    ...base,
    kind: "round" as const,
    round: roundOut(step.round),
  };
}

async function makeGroups(store: MixerStore, p: MakeGroupsInput) {
  const [current, roster] = await Promise.all([store.read(), store.roster()]);
  let s: MixerState = {
    ...current,
    ...(p.mode ? { mode: p.mode } : {}),
    ...(p.groupSize !== undefined ? { split: "size" as const, size: p.groupSize } : {}),
    ...(p.groupCount !== undefined ? { split: "count" as const, count: p.groupCount } : {}),
    ...(p.balance ? { balance: p.balance } : {}),
    ...(p.odd ? { odd: p.odd } : {}),
    ...(p.tables !== undefined ? { tables: p.tables } : {}),
    ...(p.rounds !== undefined ? { cafeRounds: p.rounds } : {}),
    ...(p.hosts ? { hosts: p.hosts.slice(0, MIXER_LIMITS.tables) } : {}),
    ...(p.title !== undefined ? { title: p.title } : {}),
  };
  // Who: the names given, else the roster when asked (or when the mix is empty).
  const names =
    p.people ?? (p.fromRoster || s.people.length === 0 ? roster.map((m) => m.name) : null);
  if (names) s = addPeople({ ...s, people: [] }, names, roster).state;
  if (p.fresh) {
    s = {
      ...s,
      rounds: [],
      seriesSeed: 0,
      seriesRound: 0,
      cafe: s.mode === "cafe" ? null : s.cafe,
    };
  }

  const step = mixNow(s, roster, { seed: p.seed });
  if (!step.ok) return { mixed: false as const, reason: step.error, settings: settingsOut(s) };
  const saved = await store.write(step.state);
  return mixResult(step, saved);
}

registry.register({
  id: "tool.team_mixer.make_groups",
  toolId: "tool.team_mixer",
  name: "make_groups",
  category: "write",
  description: `Mix people into groups, pairs or World Café tables, as the page's Mix button does. Every param is optional and changes the saved settings: people (replaces who is in the mix; with neither people nor fromRoster, an empty mix takes everyone on the Team page), fromRoster, mode, groupSize or groupCount (groups of that size, or that many groups), balance, odd, tables + rounds + hosts (World Café), title, fresh (forget earlier rounds so their pairings no longer count), seed. The mix keeps the saved keep-apart / keep-together rules first, then avoids people who were together in earlier rounds, then balances; it names whatever it couldn't keep in plain words (issues). Groups and pairs add a round; cafe makes a new plan (round 1 on screen). Returns {mixed: true, saved: true, kind: 'round', round: {id, number, groups: {label, people}[], sitOut, issues, …}} or {mixed: true, saved: true, kind: 'cafe', cafe: {current, rounds, onScreen, whoGoesWhere, issues, …}}, or {mixed: false, reason} (e.g. fewer than 2 people, or too few for the tables). Over MCP it is worked out the same way from the cloud copy but not saved: saved: false with a note.`,
  paramsSchema: MakeGroupsParams,
  visitor: true,
  handler: async (params) => makeGroups(browserStore, params),
  mcpHandler: async (params, ctx) => makeGroups(serverStore(ctx.userId), params),
});

/* ── next_round ──────────────────────────────────────────────────────── */

const NextRoundParams = z.object({
  round: z
    .number()
    .int()
    .min(1)
    .max(MIXER_LIMITS.cafeRounds)
    .optional()
    .describe("World Café only: show this round (from 1) instead of the next one."),
  seed: z
    .number()
    .int()
    .min(0)
    .max(0xffffffff)
    .optional()
    .describe("Groups and pairs: a seed, to get the same mix again."),
});

async function nextRound(store: MixerStore, p: z.infer<typeof NextRoundParams>) {
  const [s, roster] = await Promise.all([store.read(), store.roster()]);
  if (s.mode === "cafe") {
    if (!s.cafe) {
      return {
        moved: false as const,
        reason: "There's no World Café plan yet: make one with make_groups (mode cafe).",
      };
    }
    const target = p.round !== undefined ? p.round - 1 : s.cafe.current + 1;
    if (target >= s.cafe.rounds.length) {
      return {
        moved: false as const,
        reason: `The plan has ${s.cafe.rounds.length} rounds and round ${s.cafe.current + 1} is on screen: that was the last. Make a new plan with make_groups.`,
      };
    }
    const next = showCafeRound(s, target);
    const saved = await store.write(next);
    const before = s.cafe.rounds[s.cafe.current];
    const after = next.cafe!.rounds[target];
    const tableOf = (round: typeof before, name: string) =>
      round.findIndex((t) => t.guests.includes(name));
    const moves = after.flatMap((t, i) =>
      t.guests.map((name) => {
        const from = tableOf(before, name);
        return { name, from: from >= 0 ? from + 1 : null, to: i + 1 };
      })
    );
    return {
      moved: true as const,
      ...(saved ? { saved: true as const } : { saved: false as const, note: NOT_SAVED_NOTE }),
      onScreen: cafeRoundOut(next.cafe!, target),
      moves,
    };
  }
  const step = mixNow(s, roster, { seed: p.seed });
  if (!step.ok) return { mixed: false as const, reason: step.error };
  const saved = await store.write(step.state);
  return mixResult(step, saved);
}

registry.register({
  id: "tool.team_mixer.next_round",
  toolId: "tool.team_mixer",
  name: "next_round",
  category: "write",
  description:
    "The next round, as the page's Next round button does. Groups and pairs: a new mix with the saved settings that avoids everyone who was together in the rounds so far, keeping the rules. Pairs follow a rotation: with an even number of people (or one sitting out each round) and no rule between two of them, everyone meets everyone before anyone pairs twice; a group of 3 or a rule means some meet again sooner (list_state's pairRotation says which); returns {mixed: true, saved: true, kind: 'round', round: {number, groups: {label, people}[], sitOut, issues}} or {mixed: false, reason}. World Café: puts the plan's next round (or round, from 1) on screen and says who moves; returns {moved: true, saved: true, onScreen: {round, rounds, tables: {label, host, guests}[]}, moves: {name, from, to}[]} or {moved: false, reason} (no plan, or the last round). Over MCP nothing is saved: saved: false with a note.",
  paramsSchema: NextRoundParams,
  requiresConfirmation: false,
  visitor: true,
  handler: async (params) => nextRound(browserStore, params),
  mcpHandler: async (params, ctx) => nextRound(serverStore(ctx.userId), params),
});
