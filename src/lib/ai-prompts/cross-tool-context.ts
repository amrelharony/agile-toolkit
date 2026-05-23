import type { Workspace } from "../stores/workspace-types";
import { selectActiveSprint, selectCompletedSprints, selectActiveImpediments, selectOpenRisks } from "../stores/workspace-store";
import { runAntiPatternRules, sortBySeverity } from "../analytics/anti-patterns";
import { mean } from "../analytics/anomaly";
import { sanitizePromptCell } from "./prompt-utils";

export function buildWorkspaceContext(w: Workspace | undefined | null): string {
  if (!w) return "";
  const parts: string[] = [];

  // Sanitize every user-typed string surface (team name, sprint name,
  // signal title) before interpolating into a markdown block. These
  // are short labels, so the 80-char cap is plenty.
  if (w.teamName) parts.push(`Team: ${sanitizePromptCell(w.teamName, 80)}`);
  if (w.teamMembers.length > 0) parts.push(`Team size: ${w.teamMembers.length}`);

  const completed = selectCompletedSprints(w);
  // Drop non-finite or negative pointsCompleted before averaging — corrupted
  // persisted state or a paste of "—" into the points field shouldn't drag
  // the AI's view of velocity into a NaN-laced or nonsensical number.
  const validVelocities = completed
    .map((s) => s.pointsCompleted ?? 0)
    .filter((v) => Number.isFinite(v) && v >= 0);
  if (validVelocities.length > 0) {
    const avgVelocity = Math.round(mean(validVelocities));
    parts.push(`Avg velocity: ${avgVelocity} pts (last ${validVelocities.length} sprints)`);
  }

  const active = selectActiveSprint(w);
  if (active) {
    const safeName = sanitizePromptCell(active.name ?? "(unnamed)", 80);
    const planned = Number.isFinite(active.pointsPlanned) ? active.pointsPlanned : 0;
    parts.push(`Active sprint: "${safeName}" (${planned} pts planned)`);
  }

  const activeImpediments = selectActiveImpediments(w);
  if (activeImpediments.length > 0) {
    const critical = activeImpediments.filter((i) => i.severity === "critical" || i.severity === "high");
    parts.push(
      `Active impediments: ${activeImpediments.length}${critical.length > 0 ? ` (${critical.length} high/critical)` : ""}`
    );
  }

  const openRisks = selectOpenRisks(w);
  if (openRisks.length > 0) {
    parts.push(`Open risks: ${openRisks.length}`);
  }

  if (w.maturityLevel) {
    parts.push(`Team maturity: Level ${w.maturityLevel}/5`);
  }

  // Surface decision activity from ALL frameworks, not just classic ADRs.
  // 28 tools per-prompt only forward `s.decisions`, missing the DACI /
  // RAPID slices. Roll them up here so cross-tool prompts (retro, post-
  // mortem, ADKAR, etc.) see the full decision-making footprint without
  // each tool having to re-select the additional slices.
  const allDecisions =
    (w.decisions?.length ?? 0) +
    (w.daciDecisions?.length ?? 0) +
    (w.rapidDecisions?.length ?? 0);
  if (allDecisions > 0) {
    const breakdown: string[] = [];
    if (w.decisions?.length) breakdown.push(`${w.decisions.length} ADR`);
    if (w.daciDecisions?.length) breakdown.push(`${w.daciDecisions.length} DACI`);
    if (w.rapidDecisions?.length) breakdown.push(`${w.rapidDecisions.length} RAPID`);
    parts.push(`Decisions captured: ${allDecisions} (${breakdown.join(", ")})`);
  }

  // Canvas / whiteboard surface — counts only. The AI doesn't need every
  // sticky's content here (that gets included by canvas-specific prompts
  // via generateCanvasPrompts); this is a higher-level hint that "the
  // team has 12 boards in active use" or "there's a single 200-sticky
  // brainstorm board pending action." Cross-tool prompts (e.g. retro,
  // story-mapper) can reference this to suggest "import to a board" or
  // "this looks like a brainstorm that could become stories."
  const boards = w.whiteboards ?? [];
  const objects = w.whiteboardObjects ?? [];
  if (boards.length > 0) {
    const totalObjects = objects.length;
    const stickies = objects.filter((o) => o.type === "sticky").length;
    parts.push(
      `Whiteboards: ${boards.length} board${boards.length === 1 ? "" : "s"} ` +
      `(${totalObjects} object${totalObjects === 1 ? "" : "s"}, ${stickies} sticky note${stickies === 1 ? "" : "s"})`,
    );
  }

  try {
    const signals = sortBySeverity(runAntiPatternRules(w));
    if (signals.length > 0 && signals[0]?.title) {
      parts.push(`Top signal: ${sanitizePromptCell(signals[0].title, 120)}`);
    }
  } catch {
    // Anti-pattern rules can throw on malformed workspace data (e.g.
    // a story with no id from a corrupt import). Don't let that abort
    // the entire context — the rest of the parts are still useful.
  }

  if (parts.length === 0) return "";
  return `\n\n## Team Workspace Context\n\n${parts.map((p) => `- ${p}`).join("\n")}\n`;
}

export function maturityAdvice(level: number | undefined): string {
  if (!level) return "";
  const tone = {
    1: "This is a new team. Keep advice simple, focus on basic Scrum mechanics, and avoid advanced metrics.",
    2: "Team is learning the basics. Introduce one new practice at a time. Be concrete.",
    3: "Team is applying practices consistently. Focus on optimization and flow.",
    4: "Team operates autonomously. Focus on business outcomes, not process.",
    5: "Team is self-optimizing. Push for strategic impact and coaching other teams.",
  }[level];
  return tone ? `\n\n> Coaching tone: ${tone}\n` : "";
}
