import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface CapacityData {
  members: { name: string; role: string; availability: number; daysOff: number }[];
  config: { sprintDays: number; ceremonyOverhead: number; focusFactor: number; hoursPerDay: number };
}

export function generateCapacityPrompts(data: CapacityData): PromptDefinition[] {
  if (data.members.length === 0) return [];

  const effHours = (m: { availability: number; daysOff: number }) => {
    const days = (data.config.sprintDays - m.daysOff) * (m.availability / 100);
    return Math.round(days * data.config.hoursPerDay * (1 - data.config.ceremonyOverhead / 100) * data.config.focusFactor * 10) / 10;
  };

  const table = formatTable(
    ["Name", "Role", "Availability %", "Days Off", "Eff. Hours"],
    data.members.map((m) => [m.name, m.role, m.availability, m.daysOff, effHours(m)])
  );

  const totalHours = data.members.reduce((s, m) => s + effHours(m), 0);
  const ctx = [
    `Sprint Length: ${data.config.sprintDays} days`,
    `Ceremony Overhead: ${data.config.ceremonyOverhead}%`,
    `Focus Factor: ${data.config.focusFactor}`,
    `Hours/Day: ${data.config.hoursPerDay}`,
    `Total Effective Hours: ${Math.round(totalHours * 10) / 10}`,
    `Team Size: ${data.members.length}`,
  ].join("\n");

  return [
    {
      id: "capacity-utilization",
      title: "Capacity Utilization Review",
      description: "Identify over/under-allocated team members and optimize sprint capacity.",
      prompt: buildPreamble("Capacity Planner", "It calculates effective sprint hours per team member based on availability, time off, and focus factors.") +
        `## Sprint Configuration\n\n${ctx}\n\n## Team Capacity\n\n${table}\n\n## Questions\n\n1. Are there any team members who appear over-allocated or at risk of burnout?\n2. Is the focus factor realistic? How does ceremony overhead compare to industry norms?\n3. How does the team's role composition affect their sprint capacity and flexibility?\n4. Are there concentration risks — critical skills held by one person with low availability?\n5. What adjustments would optimize this team's capacity without increasing hours?`,
    },
    {
      id: "capacity-commitment",
      title: "Sprint Commitment Advisor",
      description: "Recommend a safe story point commitment based on team capacity.",
      prompt: buildPreamble("Capacity Planner", "Help the team translate capacity hours into a sprint commitment.") +
        `## Sprint Configuration\n\n${ctx}\n\n## Team Capacity\n\n${table}\n\n## Questions\n\nBased on ${Math.round(totalHours)} total effective hours this sprint:\n\n1. What story point range should this team commit to? (Assume a range of velocities per point.)\n2. How should planned absences and partial availability affect the commitment?\n3. What buffer should the team keep for unplanned work, bug fixes, and support?\n4. How can the team balance new feature work with technical debt given this capacity?\n5. Create a "commitment checklist" the team can use at sprint planning.`,
    },
  ];
}
