import { exampleId } from "@/components/tool-frame/example-data";
import type { AgendaId } from "./agenda";
import type { Participant } from "./speakers";

/**
 * A mobile checkout team's Daily Scrum: the round of the team with five
 * speakers, three minutes each at the default 15 minutes. Only the timer's
 * own speaking order gets the example rows; nothing is written to the
 * workspace, so "Clear example" leaves the team's real data alone.
 */
export function buildExample(): { agendaId: AgendaId; participants: Participant[] } {
  return {
    agendaId: "daily",
    participants: ["Priya (PM)", "Diego (iOS)", "Mei (Android)", "Sam (Backend)", "Amara (QA)"].map(
      (name, i) => ({ id: exampleId(`speaker-${i + 1}`), name })
    ),
  };
}
