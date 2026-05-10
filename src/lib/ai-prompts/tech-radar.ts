import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

type Ring = "adopt" | "trial" | "assess" | "hold";
type Quadrant = "languages_frameworks" | "tools" | "platforms" | "techniques";

interface Blip {
  id: string;
  name: string;
  ring: Ring;
  quadrant: Quadrant;
  movedAt: string;
  description?: string;
}

const QUADRANT_LABEL: Record<Quadrant, string> = {
  languages_frameworks: "Languages & Frameworks",
  tools: "Tools",
  platforms: "Platforms",
  techniques: "Techniques",
};

export function generateTechRadarPrompts(
  data: { blips: Blip[] },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.blips.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const byRing: Record<Ring, Blip[]> = {
    adopt: [],
    trial: [],
    assess: [],
    hold: [],
  };
  for (const b of data.blips) byRing[b.ring].push(b);

  const blipTable = formatTable(
    ["Name", "Ring", "Quadrant", "Moved", "Description"],
    data.blips.slice(0, 30).map((b) => [
      b.name,
      b.ring,
      QUADRANT_LABEL[b.quadrant],
      b.movedAt.slice(0, 10),
      (b.description ?? "—").slice(0, 80),
    ])
  );

  return [
    {
      id: "tech-radar-adoption",
      title: "Adoption Sequencing",
      description:
        "Recommend a sequence for moving Trial/Assess items toward Adopt without overloading the team.",
      prompt:
        buildPreamble(
          "Tech Radar",
          `${data.blips.length} blips: ${byRing.adopt.length} adopt · ${byRing.trial.length} trial · ${byRing.assess.length} assess · ${byRing.hold.length} hold.`
        ) +
        `## Blips\n\n${blipTable}\n\n## Questions\n\n1. Which Trial blips look ready to move to Adopt this quarter? What's the evidence threshold?\n2. Which Assess blips deserve a small spike vs. waiting?\n3. What's the realistic maximum number of new Adopts per quarter for a team this size?\n4. Recommend a 2-quarter adoption sequence with rationale.` +
        wsContext,
    },
    {
      id: "tech-radar-hold",
      title: "Hold-list Rationale Check",
      description:
        "Audit the Hold ring for clear rationale and exit criteria.",
      prompt:
        buildPreamble(
          "Tech Radar",
          `${byRing.hold.length} blip(s) currently on hold.`
        ) +
        `## Blips\n\n${blipTable}\n\n## Questions\n\n1. For each Hold blip, is the reason for the hold clear and current?\n2. Which Holds are passive (\"we don't use it anymore\") vs. active warnings (\"don't pick this up\")?\n3. Suggest 1-2 explicit exit criteria for each Hold so it doesn't linger forever.\n4. Which Adopts deserve a re-evaluation given the current Hold list?` +
        wsContext,
    },
  ];
}
