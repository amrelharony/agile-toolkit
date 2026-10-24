import type { RetroAction } from "@/lib/retro/actions";
import type { TeamMember } from "@/lib/stores/workspace-types";
import { findRosterMember, nameKey } from "@/lib/team/use-team-roster";

/*
 * Owner filter values. Names are trimmed before they are stored or
 * compared, so a value with a leading space can never be somebody's name.
 */
export const EVERYONE = " everyone";
export const NO_OWNER = " no-owner";

export interface OwnerOption {
  /** The name as shown, which is also the filter value. */
  name: string;
  /** Open actions this person owns. */
  open: number;
}

/**
 * One option per person who owns an action, matched by `nameKey`, so "Sam"
 * and "sam " are one owner. A roster member is shown with the roster's
 * spelling and listed first, in roster order (the team as the Team page
 * has it); anyone else follows alphabetically, spelled as first seen.
 */
export function ownerOptions(
  actions: readonly RetroAction[],
  roster: readonly TeamMember[]
): OwnerOption[] {
  const byKey = new Map<string, OwnerOption & { rosterIndex: number }>();
  for (const a of actions) {
    const key = nameKey(a.assignee);
    if (!key) continue;
    let option = byKey.get(key);
    if (!option) {
      const member = findRosterMember(roster, a.assignee);
      const name = member?.name.trim() ?? a.assignee.trim();
      option = {
        name,
        open: 0,
        rosterIndex: member ? roster.indexOf(member) : -1,
      };
      byKey.set(key, option);
    }
    if (!a.done) option.open++;
  }
  return Array.from(byKey.values())
    .sort((x, y) => {
      if (x.rosterIndex >= 0 && y.rosterIndex >= 0) return x.rosterIndex - y.rosterIndex;
      if (x.rosterIndex >= 0) return -1;
      if (y.rosterIndex >= 0) return 1;
      return x.name.localeCompare(y.name);
    })
    .map(({ name, open }) => ({ name, open }));
}

/** Whether `action` passes the owner filter. */
export function matchesOwner(action: Pick<RetroAction, "assignee">, owner: string): boolean {
  if (owner === EVERYONE) return true;
  if (owner === NO_OWNER) return nameKey(action.assignee) === "";
  return nameKey(action.assignee) === nameKey(owner);
}
