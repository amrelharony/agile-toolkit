/**
 * What every Team Time tab gets from the page: the rows (the workspace's,
 * or the example's while it is loaded), names and places by person id,
 * where to write, the history log (silent for the example), the live
 * announcer, the time now and the clocks.
 */

import type {
  CeremonyCadenceDoc,
  MeetingAudit,
  TeamMember,
  TeamTimePerson,
  TeamTimePoll,
  TeamTimeRotation,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import type { TeamTimeWriter } from "./store";

export interface TeamTimeCtx {
  people: TeamTimePerson[];
  roster: TeamMember[];
  polls: TeamTimePoll[];
  rotations: TeamTimeRotation[];
  /** The roster's name for a person, else their stored one. */
  name: (personId: string) => string;
  /** Their office, else their zone's city. */
  place: (personId: string) => string;
  writer: TeamTimeWriter;
  /** History: ids and counts only, and nothing while the example is loaded. */
  record: (action: string, payload: Record<string, unknown>) => void;
  announce: (message: string) => void;
  now: Date;
  /** The viewer's own zone (the cadence's times are on it). */
  viewerZone: string;
  /** The clock the page shows times on. */
  zone: string;
  /** The example is loaded. */
  preview: boolean;
  /** A new row id: an example id while the example is loaded. */
  newId: (prefix: string) => string;
  /** The team's holidays, from its saved cadence. */
  holidays: string[];
  cadences: readonly CeremonyCadenceDoc[];
  agreements: readonly WorkingAgreement[];
  meetingAudits: readonly MeetingAudit[];
}
