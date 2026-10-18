import type { CapacityMember, TeamMember } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/use-team-roster";

/** The row fields a sync may change on an existing row. */
type SyncedFields = Pick<CapacityMember, "name" | "role" | "availability" | "teamMemberId">;

export interface RosterSyncResult {
  /** The plan's rows after the sync. The input array itself when nothing changed. */
  members: CapacityMember[];
  /** Rows the sync appended, one per roster member that had none. */
  added: CapacityMember[];
  /** Existing rows the sync changed, with the values they had before. */
  changed: { id: string; before: SyncedFields }[];
}

function clampPct(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
}

/** The untouched row a fresh plan starts with. */
function isBlankStarter(m: CapacityMember): boolean {
  return (
    !m.teamMemberId &&
    !m.name.trim() &&
    !m.role.trim() &&
    !m.description?.trim() &&
    m.availability === 100 &&
    m.daysOff === 0
  );
}

function pickSynced(m: CapacityMember): SyncedFields {
  return {
    name: m.name,
    role: m.role,
    availability: m.availability,
    teamMemberId: m.teamMemberId,
  };
}

/**
 * Give every roster member a capacity row. Never removes a row.
 *
 * 1. A row already linked to the member (`teamMemberId`) is theirs; it takes
 *    the roster's name if the two differ by more than case.
 * 2. Otherwise an unlinked row with the same name (trimmed, any case) is
 *    linked to them. A link to someone no longer on the roster counts as
 *    unlinked.
 * 3. Otherwise the blank starter row is filled in, or a new row is added
 *    with the member's role and capacity.
 *
 * Every roster member ends up linked to a row whose name matches, so a
 * second run finds nothing to do and returns the same array.
 */
export function syncFromRoster(
  members: CapacityMember[],
  roster: readonly TeamMember[],
  newId: () => string = () => crypto.randomUUID()
): RosterSyncResult {
  const people = roster.filter((r) => nameKey(r.name) !== "");
  const rosterIds = new Set(people.map((r) => r.id));
  const isLinked = (m: CapacityMember) => !!m.teamMemberId && rosterIds.has(m.teamMemberId);

  const next = members.slice();
  const changed = new Map<string, SyncedFields>();
  const taken = new Set<number>();
  const added: CapacityMember[] = [];

  const update = (index: number, patch: Partial<CapacityMember>) => {
    const row = next[index];
    if (!changed.has(row.id)) changed.set(row.id, pickSynced(members[index]));
    next[index] = { ...row, ...patch };
  };

  const pending: TeamMember[] = [];
  for (const person of people) {
    const linked = next.findIndex((m, i) => !taken.has(i) && m.teamMemberId === person.id);
    if (linked >= 0) {
      taken.add(linked);
      if (nameKey(next[linked].name) !== nameKey(person.name)) {
        update(linked, { name: person.name.trim() });
      }
      continue;
    }
    pending.push(person);
  }

  for (const person of pending) {
    const key = nameKey(person.name);
    const byName = next.findIndex(
      (m, i) => !taken.has(i) && !isLinked(m) && nameKey(m.name) === key
    );
    if (byName >= 0) {
      taken.add(byName);
      update(byName, { teamMemberId: person.id });
      continue;
    }
    const blank = next.findIndex((m, i) => !taken.has(i) && isBlankStarter(m));
    if (blank >= 0) {
      taken.add(blank);
      update(blank, {
        name: person.name.trim(),
        role: person.role?.trim() ?? "",
        availability: clampPct(person.capacityPct),
        teamMemberId: person.id,
      });
      continue;
    }
    const row: CapacityMember = {
      id: newId(),
      name: person.name.trim(),
      role: person.role?.trim() ?? "",
      availability: clampPct(person.capacityPct),
      daysOff: 0,
      teamMemberId: person.id,
    };
    taken.add(next.length);
    next.push(row);
    added.push(row);
  }

  if (added.length === 0 && changed.size === 0) {
    return { members, added, changed: [] };
  }
  return {
    members: next,
    added,
    changed: Array.from(changed, ([id, before]) => ({ id, before })),
  };
}

/**
 * Take a sync back out of the current rows: drop the rows it added and put
 * the fields it changed back. Edits made since then to other fields (days
 * off, a description) are kept.
 */
export function revertRosterSync(
  members: CapacityMember[],
  sync: Pick<RosterSyncResult, "added" | "changed">
): CapacityMember[] {
  const addedIds = new Set(sync.added.map((m) => m.id));
  const before = new Map(sync.changed.map((c) => [c.id, c.before]));
  return members
    .filter((m) => !addedIds.has(m.id))
    .map((m) => {
      const prev = before.get(m.id);
      if (!prev) return m;
      const restored: CapacityMember = {
        ...m,
        name: prev.name,
        role: prev.role,
        availability: prev.availability,
        teamMemberId: prev.teamMemberId,
      };
      if (prev.teamMemberId === undefined) delete restored.teamMemberId;
      return restored;
    });
}
