import type { TeamMember } from "@/lib/stores/workspace-types";
import { nameKey } from "@/lib/team/use-team-roster";
import type { Participant } from "./markdown";

/**
 * The roster members missing from the speaking order, in roster order, as
 * participants that carry the member's id.
 *
 * Someone counts as present when a participant has their id or their name
 * (trimmed, any case), so loading the team twice adds nobody and a name
 * typed in by hand is not duplicated. Members without a name are skipped.
 */
export function rosterParticipantsToAdd(
  participants: readonly Participant[],
  roster: readonly TeamMember[]
): Participant[] {
  const ids = new Set(participants.map((p) => p.id));
  const names = new Set(participants.map((p) => nameKey(p.name)));
  const additions: Participant[] = [];
  for (const member of roster) {
    const key = nameKey(member.name);
    if (!key || ids.has(member.id) || names.has(key)) continue;
    ids.add(member.id);
    names.add(key);
    additions.push({ id: member.id, name: member.name.trim() });
  }
  return additions;
}
