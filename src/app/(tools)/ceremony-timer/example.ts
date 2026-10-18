import { exampleId } from "@/components/tool-frame/example-data";
import type { Participant } from "./markdown";

/**
 * A mobile checkout team's daily standup: the 15-minute preset with rotation
 * on, three minutes for each of five speakers.
 */
export function buildExample(): { minutes: number; participants: Participant[] } {
  return {
    minutes: 15,
    participants: ["Priya (PM)", "Diego (iOS)", "Mei (Android)", "Sam (Backend)", "Amara (QA)"].map(
      (name, i) => ({ id: exampleId(`speaker-${i + 1}`), name })
    ),
  };
}
