import type { CapacityConfig, CapacityMember } from "@/lib/stores/workspace-types";
import { planCapacity } from "@/lib/sprints/capacity";
import { capacityVerdict, fmt, forecastSentence, hoursBreakdown, isBlankMember } from "./model";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The capacity plan as Markdown, for a sprint planning page: the sprint and
 * settings, the total hours and where the rest went, the points forecast,
 * then each member's availability, days off and effective hours. The hours
 * are `planCapacity`'s, so they match the planner and Sprint Planning.
 */
export function toMarkdown(
  {
    members,
    config,
    sprintName,
    velocity,
  }: {
    members: CapacityMember[];
    config: CapacityConfig;
    /** The sprint the plan is for; absent for the general plan. */
    sprintName?: string;
    /** Recent velocity, for the points forecast (absent or null: no forecast line). */
    velocity?: number | null;
  },
  now: Date = new Date()
): string {
  const title = `# Sprint Capacity — ${mdDate(now)}`;
  if (members.every(isBlankMember)) return `${title}\n\nNo team members yet.\n`;

  const plan = { members, config };
  const summary = planCapacity(plan);
  const b = hoursBreakdown(plan);
  const committed = String(config.pointsCommitted ?? "").trim();

  const lines = [title, ""];
  if (sprintName) lines.push(`**For:** ${cell(sprintName)}`, "");
  lines.push(
    `**Sprint:** ${config.sprintDays} days · ${config.hoursPerDay} h/day · focus factor ${config.focusFactor} · ceremony overhead ${config.ceremonyOverhead}%`,
    "",
    `**Total capacity:** ${summary.totalHours} hours across ${members.length} member${
      members.length === 1 ? "" : "s"
    }`,
    "",
    capacityVerdict(b)
  );
  if (typeof velocity === "number") {
    lines.push("", `**Points forecast:** ${forecastSentence(plan, velocity)}`);
  }
  if (committed) lines.push("", `**Points committed:** ${cell(committed)}`);
  lines.push(
    "",
    "## Where the hours go",
    "",
    "| | Hours |",
    "|---|---:|",
    `| Full time (${b.people} × ${fmt(b.sprintDays)} days × ${fmt(b.hoursPerDay)} h) | ${fmt(b.fullTime)} |`,
    `| Days off (${fmt(b.daysOff)} days) | −${fmt(b.daysOffHours)} |`,
    `| Time away from the team (availability) | −${fmt(b.availabilityHours)} |`,
    `| Scrum events (${config.ceremonyOverhead}%) | −${fmt(b.ceremonyHours)} |`,
    `| Other interruptions (focus factor ${config.focusFactor}) | −${fmt(b.interruptionHours)} |`,
    `| **Capacity** | **${fmt(b.capacity)}** |`,
    "",
    "## Team",
    "",
    "| Member | Role | Availability | Days off | Effective hours | Notes |",
    "|---|---|---:|---:|---:|---|",
    ...members.map(
      (m, i) =>
        `| ${cell(m.name) || "(unnamed)"} | ${cell(m.role)} | ${m.availability}% | ${m.daysOff} | ${
          summary.perMember[i].effectiveHours
        } | ${cell(m.description)} |`
    ),
    `| **Total** | | | | **${summary.totalHours}** | |`
  );
  return `${lines.join("\n")}\n`;
}
