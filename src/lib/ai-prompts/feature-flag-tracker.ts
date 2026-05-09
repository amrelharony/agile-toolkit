import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface FlagData {
  name: string;
  owner?: string;
  status: "active" | "on" | "off" | "deprecated";
  createdAt: string;
  retiredAt?: string;
  environment: "dev" | "staging" | "prod" | "all";
  purpose: "rollout" | "experiment" | "kill_switch" | "permission";
  description?: string;
}

export function generateFeatureFlagPrompts(data: {
  flags: FlagData[];
  active: number;
  stale: number;
  retiredThisQuarter: number;
  byPurpose: Record<string, number>;
}): PromptDefinition[] {
  if (data.flags.length === 0) return [];
  const today = Date.now();

  const flagTable = formatTable(
    [
      "Name",
      "Owner",
      "Status",
      "Env",
      "Purpose",
      "Age (d)",
      "Description",
    ],
    data.flags.slice(0, 20).map((f) => [
      f.name,
      f.owner ?? "—",
      f.status,
      f.environment,
      f.purpose,
      Math.floor((today - new Date(f.createdAt).getTime()) / 86400000),
      (f.description ?? "—").slice(0, 60),
    ])
  );

  const staleTable =
    data.stale > 0
      ? formatTable(
          ["Name", "Owner", "Purpose", "Age (d)"],
          data.flags
            .filter((f) => {
              if (f.retiredAt) return false;
              if (f.status === "deprecated") return false;
              const age =
                (today - new Date(f.createdAt).getTime()) / 86400000;
              return age > 90;
            })
            .slice(0, 20)
            .map((f) => [
              f.name,
              f.owner ?? "—",
              f.purpose,
              Math.floor((today - new Date(f.createdAt).getTime()) / 86400000),
            ])
        )
      : "_No stale flags._";

  return [
    {
      id: "flag-stale-cleanup",
      title: "Stale-flag cleanup priorities",
      description:
        "Sequence stale-flag retirement to maximize cleanup with minimum risk.",
      prompt:
        buildPreamble(
          "Feature Flag Tracker",
          `${data.active} active flag(s), ${data.stale} stale (>90d). Retired this quarter: ${data.retiredThisQuarter}.`
        ) +
        `## Stale flags\n\n${staleTable}\n\n## All flags\n\n${flagTable}\n\n## Questions\n\n1. Which stale flags are safest to remove first (kill_switch + permission flags rarely)?\n2. Group the cleanup work into 3 batches with rollout/rollback notes.\n3. What policy (max-age, owner, retirement gates) would prevent the next wave of stale flags?`,
    },
    {
      id: "flag-purpose-hygiene",
      title: "Flag-purpose hygiene",
      description:
        "Critique how purposes are tagged and surface mis-tagged flags.",
      prompt:
        buildPreamble(
          "Feature Flag Tracker",
          `By purpose: rollout ${data.byPurpose.rollout ?? 0}, experiment ${
            data.byPurpose.experiment ?? 0
          }, kill_switch ${data.byPurpose.kill_switch ?? 0}, permission ${
            data.byPurpose.permission ?? 0
          }.`
        ) +
        `## Flags\n\n${flagTable}\n\n## Questions\n\n1. Which flags look like the wrong purpose given their name and description?\n2. Are experiments outliving their measurement window?\n3. Suggest a purpose-by-purpose retirement playbook (e.g., experiments retire after the readout, rollouts after 100% saturation, …).`,
    },
  ];
}
