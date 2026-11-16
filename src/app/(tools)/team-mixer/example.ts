import { exampleId } from "@/lib/utils/example-id";
import { addPeople, addRule, mixNow } from "@/lib/team-mixer/ops";
import { MIXER_INITIAL, type MixerState } from "@/lib/team-mixer/state";

/**
 * A facilitator splitting ten people into breakout groups for a retro:
 * groups of 3, with Amira and Ben (a manager and their report) kept apart,
 * and Chen and Dana (who pair on the same incident) kept together. One
 * round is already mixed, so the page shows the groups, and "Mix the next
 * round" shows how the next mix avoids these pairings. Every row carries an
 * `example-` id, so Clear example removes exactly them.
 */
export const EXAMPLE_PEOPLE = [
  "Amira",
  "Ben",
  "Chen",
  "Dana",
  "Elif",
  "Femi",
  "Grace",
  "Hugo",
  "Ines",
  "Jonas",
] as const;

export const EXAMPLE_TITLE = "Retro breakouts: what slowed us down this sprint?";

/** A fixed seed, so the example's first round is the same for everyone. */
const EXAMPLE_SEED = 2026;

export function buildExample(now: Date = new Date()): MixerState {
  let n = 0;
  let s: MixerState = {
    ...MIXER_INITIAL,
    mode: "groups",
    split: "size",
    size: 3,
    title: EXAMPLE_TITLE,
  };
  s = addPeople(s, [...EXAMPLE_PEOPLE], [], () => exampleId(`person-${++n}`)).state;
  const rules = [
    { kind: "apart" as const, a: "Amira", b: "Ben" },
    { kind: "together" as const, a: "Chen", b: "Dana" },
  ];
  rules.forEach((rule, i) => {
    const added = addRule(s, rule, exampleId(`rule-${i + 1}`));
    if (added.ok) s = added.state;
  });
  const mixed = mixNow(s, [], {
    seed: EXAMPLE_SEED,
    now,
    id: exampleId("round-1"),
    timeLimitMs: 2_000,
  });
  return mixed.ok ? mixed.state : s;
}
