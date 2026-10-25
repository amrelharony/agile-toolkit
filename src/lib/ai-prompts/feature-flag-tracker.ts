import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { FeatureFlag } from "@/lib/stores/workspace-types";
import {
  PURPOSE_LABEL,
  STATUS_LABEL,
  TYPICAL_LIFETIME_DAYS,
  flagStaleness,
  type FlagSummary,
} from "@/lib/flags/model";

/**
 * Prompts for the Feature Flag Tracker. Staleness comes from lib/flags (the
 * page's and the agent's one rule: by purpose, kill switches exempt, a
 * removal date first), not a 90-day cut-off of its own.
 */
export function generateFeatureFlagPrompts(data: {
  flags: readonly FeatureFlag[];
  today: string;
  summary: FlagSummary;
}): PromptDefinition[] {
  if (data.flags.length === 0) return [];
  const { today, summary: s } = data;
  const rows = data.flags.map((f) => ({ f, st: flagStaleness(f, today) }));

  const flagTable = formatTable(
    ["Name", "Owner", "Status", "Purpose", "Created", "Remove by", "Age (d)", "Description"],
    rows
      .slice(0, 20)
      .map(({ f, st }) => [
        f.name,
        f.owner ?? "—",
        STATUS_LABEL[f.status],
        PURPOSE_LABEL[f.purpose],
        f.createdAt || "—",
        f.removeBy ?? "—",
        st.ageDays ?? "—",
        (f.description ?? "—").slice(0, 60),
      ])
  );

  const stale = rows.filter((x) => x.st.stale);
  const staleTable =
    stale.length > 0
      ? formatTable(
          ["Name", "Owner", "Purpose", "Why stale", "Days over"],
          stale
            .slice(0, 20)
            .map(({ f, st }) => [
              f.name,
              f.owner ?? "—",
              PURPOSE_LABEL[f.purpose],
              st.reason === "past-removal-date"
                ? `past its removal date (${f.removeBy})`
                : `over ${TYPICAL_LIFETIME_DAYS[f.purpose]} days for its purpose`,
              st.daysOver,
            ])
        )
      : "_No stale flags._";

  return [
    {
      id: "flag-stale-cleanup",
      title: "Stale-flag cleanup priorities",
      description: "Sequence stale-flag retirement to maximize cleanup with minimum risk.",
      prompt:
        buildPreamble(
          "Feature Flag Tracker",
          `${s.live} live flag(s), ${s.stale} stale (${s.pastRemoval} past their removal date, ${s.overLifetime} over their purpose's typical lifetime: rollouts 30 days, experiments 60), ${s.exempt} exempt (kill switches, and permission flags with no removal date). ${s.noOwner} live flag(s) have no owner. Retired this quarter: ${s.retiredThisQuarter}.`
        ) +
        `## Stale flags\n\n${staleTable}\n\n## All flags\n\n${flagTable}\n\n## Questions\n\n1. Which stale flags are safest to remove first?\n2. Group the cleanup work into 3 batches with rollout/rollback notes.\n3. What policy (removal dates, owners, retirement gates) would prevent the next wave of stale flags?`,
    },
    {
      id: "flag-purpose-hygiene",
      title: "Flag-purpose hygiene",
      description: "Critique how purposes are tagged and surface mis-tagged flags.",
      prompt:
        buildPreamble(
          "Feature Flag Tracker",
          `Live flags by purpose: rollout ${s.byPurpose.rollout}, experiment ${s.byPurpose.experiment}, kill switch ${s.byPurpose.kill_switch}, permission ${s.byPurpose.permission}.`
        ) +
        `## Flags\n\n${flagTable}\n\n## Questions\n\n1. Which flags look like the wrong purpose given their name and description (a "kill switch" that is really a rollout escapes the staleness check)?\n2. Are experiments outliving their measurement window?\n3. Suggest a purpose-by-purpose retirement playbook (e.g., experiments retire after the readout, rollouts after 100% saturation, …).`,
    },
  ];
}
