/**
 * Picker — tool-local actions.
 *
 * Category: Workshops & Facilitation
 * Tool:     Spin a wheel of names fairly (weights, everyone once, names that
 *           leave once picked), rotate standing roles with a fairness
 *           history, roll dice. Its data is the Picker's own store
 *           (lib/picker/store, `agile-toolkit:picker`), not the workspace.
 *
 * Agent surface: tool.picker.*
 *
 *   1. list_state  — the wheel (its names, weights, who is left this round),
 *                    saved lists, roles with who is next, recent picks, the
 *                    name shortlist.
 *   2. spin        — spin the wheel, with the page's rules; saves the pick.
 *   3. add_names   — add names to a saved list (never to the team).
 *   4. rotate_role — give a role to whoever is due, fairest first.
 *   5. roll_dice   — roll 1 to 6 dice of 4 to 20 sides.
 *
 * Every rule is lib/picker/model's, as on the page. Nothing here reaches
 * anyone else: a spin for a live room's screens is the page's own button, so
 * every verb is open to a visitor's chat (on their own browser's data).
 *
 * Over MCP the store is read from the user's synced copy (read-only: the
 * page owns the writes). `spin` and `roll_dice` still answer there, without
 * saving anything; `add_names` and `rotate_role` ask to be run in the app.
 */

import { z } from "zod";
import { registry } from "../registry";
import type { ActionContext } from "../context";
import { serverGetUserStateBlob, serverListEntities } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/names";
import {
  PICKER_LIMITS,
  TEAM_SOURCE,
  addEntries,
  awayToday,
  findList,
  localDay,
  nextForRole,
  normalizePickerState,
  planRoles,
  poolLabel,
  rolePeople,
  roleSourceLabel,
  roleStandings,
  sourceEntries,
  sourceLabel,
  spinWheel,
  wheelView,
  withProgress,
  withRecent,
  withRoleTurn,
  type PickerState,
} from "@/lib/picker/model";
import {
  PICKER_STORE_KEY,
  ensurePickerHydrated,
  readPicker,
  updatePicker,
} from "@/lib/picker/store";
import {
  DICE_SIDES,
  MAX_DICE,
  diceLabel,
  diceResultText,
  rollDice,
} from "@/lib/picker/randomizers";

/** MUST match registerCollection("teamMember", …) in workspace-store.ts. */
const KIND_TEAM = "workspace:teamMember";

const MCP_WRITE_REFUSAL =
  "Picker keeps its lists and rotations in the browser. Ask Amr in the app, on the Picker page, to change them.";

interface Snapshot {
  state: PickerState;
  roster: readonly { name: string }[];
  /**
   * The user's local day. In the browser, this machine's; over MCP, worked
   * out from the UTC offset the page last saved, since the server's clock
   * is UTC (without one, the server's day).
   */
  today: string;
}

/** The Picker's state and the team, on either transport. */
async function snapshot(ctx: ActionContext): Promise<Snapshot> {
  if (ctx.source === "mcp") {
    const [blob, roster] = await Promise.all([
      serverGetUserStateBlob(ctx.userId, PICKER_STORE_KEY),
      serverListEntities<TeamMember>(ctx.userId, KIND_TEAM),
    ]);
    const state = normalizePickerState(blob);
    return { state, roster, today: localDay(state.utcOffset) };
  }
  await ensurePickerHydrated();
  return {
    state: readPicker(),
    roster: useWorkspaceStore.getState().teamMembers ?? [],
    today: localDay(null),
  };
}

/** A role by id or name (case-insensitive). */
function findRole(state: PickerState, idOrName: string) {
  return (
    state.roles.find((r) => r.id === idOrName) ??
    state.roles.find((r) => nameKey(r.name) === nameKey(idOrName))
  );
}

function summarize({ state, roster, today }: Snapshot) {
  const entries = sourceEntries(state, roster);
  const view = wheelView(entries, state.progress, state.everyoneOnce);
  const eligible = new Set(view.eligible);
  const away = awayToday(state.away, today);
  const people = rolePeople(state, roster);
  const options = { away, today };
  const roleName = (roleId: string | null) =>
    roleId ? (state.roles.find((r) => r.id === roleId)?.name ?? null) : null;
  return {
    today,
    wheel: {
      source: state.source,
      sourceName: sourceLabel(state),
      names: view.shown.map((e, i) => ({
        name: e.name,
        weight: e.weight,
        canComeUp: eligible.has(i),
      })),
      removed: view.removed,
      everyoneOnce: state.everyoneOnce,
      removePicked: state.removePicked,
      round: view.round,
      leftThisRound: view.left,
    },
    lists: state.lists.map((l) => ({ id: l.id, name: l.name, count: l.entries.length })),
    rolePeopleFrom: {
      source: state.roleSource,
      name: roleSourceLabel(state),
      count: people.length,
    },
    roles: state.roles.map((role) => ({
      id: role.id,
      name: role.name,
      next: nextForRole(people, state.roleTurns, role.id, options),
      standings: roleStandings(people, state.roleTurns, role.id, options).map((s) => ({
        name: s.name,
        turns: s.turns,
        lastAt: s.lastAt,
        away: s.away,
        roleToday: roleName(s.busyWith),
      })),
    })),
    giveOutToday: planRoles(state.roles, people, state.roleTurns, options).map((p) => ({
      role: p.role.name,
      person: p.person,
    })),
    awayToday: people.filter((p) => away.includes(nameKey(p))),
    recent: state.recent.slice(0, 10).map((r) => ({
      kind: r.kind,
      result: r.result,
      detail: r.detail,
      at: r.at,
    })),
    shortlist: state.shortlist,
  };
}

const NameSchema = z.string().trim().min(1).max(PICKER_LIMITS.maxNameChars);

// ──────── tool.picker.list_state ────────
registry.register({
  id: "tool.picker.list_state",
  toolId: "tool.picker",
  name: "list_state",
  category: "read",
  description:
    "Read the Picker: today (the user's local day), the wheel {source ('team' or a list id), sourceName, names: {name, weight 1-5, canComeUp}[], removed (taken off after being picked), everyoneOnce, removePicked, round, leftThisRound}, lists {id, name, count}[], rolePeopleFrom {source, name, count} (who takes the roles: the team, or a saved list chosen for roles; never the wheel's names), roles {id, name, next (who is due, passing over anyone with another role today; null when all are away), standings: {name, turns, lastAt, away, roleToday}[] fairest first}[], giveOutToday {role, person}[] (each role not given today, to different people where possible), awayToday, recent picks (10, newest first) and the name shortlist.",
  paramsSchema: z.object({}),
  handler: async (_params, ctx) => summarize(await snapshot(ctx)),
});

// ──────── tool.picker.spin ────────
registry.register({
  id: "tool.picker.spin",
  toolId: "tool.picker",
  name: "spin",
  category: "write",
  requiresConfirmation: false,
  description:
    "Spin the Picker's wheel: one name, in proportion to its weight, following the page's rules (with everyoneOnce nobody comes up twice until all have; with removePicked the name leaves the wheel). source switches the wheel first: 'team' for the Team page's people, or a saved list's id or name. Saves the pick in recent picks. Returns {name, from, round, leftThisRound, newRound, roundDone, saved}. It does not show the spin in a live room (the page's own button does that).",
  paramsSchema: z.object({
    source: z.string().trim().min(1).max(PICKER_LIMITS.maxListNameChars).optional(),
  }),
  handler: async (params, ctx) => {
    const snap = await snapshot(ctx);
    let state = snap.state;
    if (params.source) {
      const target =
        nameKey(params.source) === TEAM_SOURCE
          ? TEAM_SOURCE
          : findList(state.lists, params.source)?.id;
      if (!target) {
        throw new Error(
          `No saved list called "${params.source}". Use 'team' or one of: ${state.lists.map((l) => l.name).join(", ") || "(no lists yet)"}.`
        );
      }
      if (target !== state.source) state = normalizePickerState({ ...state, source: target });
    }
    const entries = sourceEntries(state, snap.roster);
    const outcome = spinWheel(entries, state.progress, state);
    if (!outcome) {
      throw new Error(
        entries.length === 0
          ? state.source === TEAM_SOURCE
            ? "The team has nobody on it yet. Add people on the Team page, or spin a saved list."
            : "That list has no names yet. Add some with add_names."
          : "Everyone has been taken off the wheel. Put them back on the Picker page."
      );
    }
    const from = poolLabel(sourceLabel(state), outcome.shown.length, state.source === TEAM_SOURCE);
    const after = wheelView(entries, outcome.progress, state.everyoneOnce);
    const result = {
      name: outcome.entry.name,
      from,
      round: outcome.progress.round,
      leftThisRound: after.left,
      newRound: outcome.newRound,
      roundDone: outcome.roundDone,
      saved: ctx.source !== "mcp",
    };
    if (ctx.source !== "mcp") {
      const source = state.source;
      // withProgress parks the progress of the source the wheel leaves.
      updatePicker((s) => ({
        ...withProgress({ ...s, source }, outcome.progress),
        recent: withRecent(s.recent, {
          id: crypto.randomUUID(),
          kind: "wheel",
          result: outcome.entry.name,
          detail: from,
          at: new Date().toISOString(),
        }),
      }));
    }
    return result;
  },
});

// ──────── tool.picker.add_names ────────
registry.register({
  id: "tool.picker.add_names",
  toolId: "tool.picker",
  name: "add_names",
  category: "write",
  description: `Add names to one of the Picker's saved lists (never to the team on the Team page). list is a saved list's id or name; a name that matches no list makes a new list with it (default "Picker list"). Each name once (repeats are skipped), up to ${PICKER_LIMITS.maxNames} per list. The wheel then spins that list. Returns {listId, listName, created, added, skipped}.`,
  paramsSchema: z.object({
    names: z.array(NameSchema).min(1).max(PICKER_LIMITS.maxNames),
    list: z.string().trim().min(1).max(PICKER_LIMITS.maxListNameChars).optional(),
  }),
  handler: async (params, ctx) => {
    if (ctx.source === "mcp") throw new Error(MCP_WRITE_REFUSAL);
    const { state } = await snapshot(ctx);
    const wanted = params.list ?? (state.source !== TEAM_SOURCE ? state.source : "Picker list");
    const existing = findList(state.lists, wanted);
    if (!existing && state.lists.length >= PICKER_LIMITS.maxLists) {
      throw new Error(
        `The Picker holds ${PICKER_LIMITS.maxLists} lists. Delete one on the page, or add to an existing list.`
      );
    }
    const now = new Date().toISOString();
    const id = existing?.id ?? `list_${crypto.randomUUID()}`;
    const name = existing?.name ?? wanted;
    const { entries, added, skipped } = addEntries(existing?.entries ?? [], params.names);
    updatePicker((s) => {
      const list = { id, name, entries, updatedAt: now };
      const lists = s.lists.some((l) => l.id === id)
        ? s.lists.map((l) => (l.id === id ? list : l))
        : [...s.lists, list];
      return { ...s, lists, source: id };
    });
    return { listId: id, listName: name, created: !existing, added, skipped };
  },
});

// ──────── tool.picker.rotate_role ────────
registry.register({
  id: "tool.picker.rotate_role",
  toolId: "tool.picker",
  name: "rotate_role",
  category: "write",
  description:
    "Give a standing role (Facilitator, Scribe, Timekeeper or the team's own; role is its id or name) to whoever is due among the people who take roles (the team, or the saved list chosen for roles; see list_state rolePeopleFrom): the fewest turns, then the longest since their last, passing over anyone who already has another role today unless nobody else is free. skip names people away today: they are passed over (and stay away for today) without losing their place. Records the turn in the fairness history. Returns {role, person, turns}.",
  paramsSchema: z.object({
    // A custom role's id (`role-<uuid>`) is longer than a role's name.
    role: z.string().trim().min(1).max(80),
    skip: z.array(NameSchema).max(PICKER_LIMITS.maxNames).optional(),
  }),
  handler: async (params, ctx) => {
    if (ctx.source === "mcp") throw new Error(MCP_WRITE_REFUSAL);
    const { state, roster, today } = await snapshot(ctx);
    const role = findRole(state, params.role);
    if (!role) {
      throw new Error(
        `No role called "${params.role}". The roles are: ${state.roles.map((r) => r.name).join(", ")}.`
      );
    }
    const people = rolePeople(state, roster);
    if (people.length === 0) {
      throw new Error(
        "Nobody to rotate: add people on the Team page, or choose a saved list for roles on the Picker page."
      );
    }
    const away = Array.from(
      new Set([...awayToday(state.away, today), ...(params.skip ?? []).map(nameKey)])
    ).filter(Boolean);
    const person = nextForRole(people, state.roleTurns, role.id, { away, today });
    if (!person) throw new Error("Everyone is away today, so nobody can take the role.");
    const at = new Date().toISOString();
    const next = updatePicker((s) => ({
      ...s,
      away: { day: today, keys: away },
      roleTurns: withRoleTurn(s.roleTurns, {
        id: crypto.randomUUID(),
        roleId: role.id,
        person,
        at,
        day: today,
      }),
      recent: withRecent(s.recent, {
        id: crypto.randomUUID(),
        kind: "role",
        result: person,
        detail: role.name,
        at,
      }),
    }));
    const turns = next.roleTurns.filter(
      (t) => t.roleId === role.id && nameKey(t.person) === nameKey(person)
    ).length;
    return { role: role.name, person, turns };
  },
});

// ──────── tool.picker.roll_dice ────────
registry.register({
  id: "tool.picker.roll_dice",
  toolId: "tool.picker",
  name: "roll_dice",
  category: "write",
  requiresConfirmation: false,
  description: `Roll dice: count 1-${MAX_DICE} (default 1), sides ${DICE_SIDES.join(" | ")} (default 6). Saves the roll in the Picker's recent picks (in the app). Returns {dice ('2d6'), rolls, total, text}.`,
  paramsSchema: z.object({
    count: z.number().int().min(1).max(MAX_DICE).default(1),
    sides: z
      .number()
      .int()
      .refine((n) => (DICE_SIDES as readonly number[]).includes(n), {
        message: `A die has ${DICE_SIDES.join(", ")} sides.`,
      })
      .default(6),
  }),
  handler: async (params, ctx) => {
    const roll = rollDice(params.count, params.sides);
    const dice = diceLabel(roll.count, roll.sides);
    const text = diceResultText(roll);
    if (ctx.source !== "mcp") {
      await ensurePickerHydrated();
      updatePicker((s) => ({
        ...s,
        recent: withRecent(s.recent, {
          id: crypto.randomUUID(),
          kind: "dice",
          result: text,
          detail: dice,
          at: new Date().toISOString(),
        }),
      }));
    }
    return { dice, rolls: roll.rolls, total: roll.total, text };
  },
});
