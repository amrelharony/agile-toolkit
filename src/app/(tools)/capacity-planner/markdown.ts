import type { CapacityConfig, CapacityMember } from "@/lib/stores/workspace-types";

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

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Same formula as the planner. */
function effectiveHours(m: CapacityMember, c: CapacityConfig): number {
  const workingDays = Math.max(c.sprintDays - m.daysOff, 0);
  return (
    workingDays *
    (m.availability / 100) *
    c.hoursPerDay *
    c.focusFactor *
    (1 - c.ceremonyOverhead / 100)
  );
}

/** A member with nothing entered: the blank row a fresh plan starts with. */
const isBlank = (m: CapacityMember) => !m.name.trim() && !m.role.trim() && !m.description?.trim();

/**
 * The capacity plan as Markdown, for a sprint planning page: the settings and
 * total hours, then each member's availability, days off and effective hours.
 */
export function toMarkdown(
  { members, config }: { members: CapacityMember[]; config: CapacityConfig },
  now: Date = new Date()
): string {
  const title = `# Sprint Capacity — ${mdDate(now)}`;
  if (members.every(isBlank)) return `${title}\n\nNo team members yet.\n`;

  const rows = members.map((m) => ({ m, hours: effectiveHours(m, config) }));
  const total = rows.reduce((sum, r) => sum + r.hours, 0);
  const committed = String(config.pointsCommitted ?? "").trim();

  const lines = [
    title,
    "",
    `**Sprint:** ${config.sprintDays} days · ${config.hoursPerDay} h/day · focus factor ${config.focusFactor} · ceremony overhead ${config.ceremonyOverhead}%`,
    "",
    `**Total capacity:** ${round1(total)} hours across ${members.length} member${
      members.length === 1 ? "" : "s"
    }`,
  ];
  if (committed) lines.push("", `**Points committed:** ${cell(committed)}`);
  lines.push(
    "",
    "## Team",
    "",
    "| Member | Role | Availability | Days off | Effective hours | Notes |",
    "|---|---|---:|---:|---:|---|",
    ...rows.map(
      ({ m, hours }) =>
        `| ${cell(m.name) || "(unnamed)"} | ${cell(m.role)} | ${m.availability}% | ${m.daysOff} | ${round1(
          hours
        )} | ${cell(m.description)} |`
    ),
    `| **Total** | | | | **${round1(total)}** | |`
  );
  return `${lines.join("\n")}\n`;
}
