import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import { buildWorkspaceContext } from "./cross-tool-context";
import type { Workspace } from "../stores/workspace-types";

interface ControlData {
  controlId: string;
  framework: string;
  title: string;
  status: string;
  owner?: string;
  evidenceCount: number;
  description?: string;
}

export function generateControlMapPrompts(
  data: {
    controls: ControlData[];
    totalControls: number;
    pctVerified: number;
    byFramework: { framework: string; total: number; implemented: number }[];
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.controls.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const fwTable = formatTable(
    ["Framework", "Total", "Implemented", "% Implemented"],
    data.byFramework.map((f) => [
      f.framework,
      f.total,
      f.implemented,
      `${((f.implemented / Math.max(1, f.total)) * 100).toFixed(0)}%`,
    ])
  );

  const ctlTable = formatTable(
    ["Control ID", "Framework", "Title", "Status", "Owner", "Evidence", "Description"],
    data.controls
      .slice(0, 25)
      .map((c) => [
        c.controlId,
        c.framework,
        c.title.slice(0, 60),
        c.status,
        c.owner ?? "—",
        c.evidenceCount,
        (c.description ?? "—").slice(0, 60),
      ])
  );

  return [
    {
      id: "control-map-gaps",
      title: "Framework Coverage Gaps",
      description:
        "Pinpoint frameworks with the lowest implementation rate and which controls are dragging the score down.",
      prompt:
        buildPreamble(
          "Compliance Control Map",
          `${data.totalControls} controls across ${data.byFramework.length} framework(s). ${data.pctVerified.toFixed(0)}% verified overall.`
        ) +
        `## Per-framework rollup\n\n${fwTable}\n\n## Controls\n\n${ctlTable}\n\n## Questions\n\n1. Which framework is furthest from full implementation, and which 3 controls within it would lift the score most?\n2. Are there controls with implemented status but zero evidence? Surface those.\n3. Suggest a 30/60/90-day plan to reach 80% verified across the weakest framework.${context}`,
    },
    {
      id: "control-map-audit",
      title: "Audit-Readiness Review",
      description:
        "Sanity-check evidence quality and surface the controls most likely to fail a real audit.",
      prompt:
        buildPreamble(
          "Compliance Control Map",
          `${data.totalControls} controls; ${data.pctVerified.toFixed(0)}% verified.`
        ) +
        `## Controls\n\n${ctlTable}\n\n## Questions\n\n1. Which controls would fail an audit this week, and why? (status, evidence, ownership.)\n2. Are there controls owned by no one? Recommend an owner type (team or role) for each.\n3. Recommend the next 5 evidence artifacts to collect for highest audit-confidence lift.${context}`,
    },
  ];
}
