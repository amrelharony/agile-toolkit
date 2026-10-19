import { exampleId } from "@/components/tool-frame/example-data";
import type { CapacityMember } from "@/lib/stores/workspace-types";

/**
 * A mobile checkout team planning a two-week sprint. With the default
 * settings Mei carries the most hours (54.4). The surprise is QA: Amara's
 * week off leaves her 27.2 hours, the same as the half-time product owner,
 * so testing, not development, limits what the team can finish.
 */
const ROWS: Omit<CapacityMember, "id">[] = [
  {
    name: "Priya",
    role: "Product Owner",
    availability: 50,
    daysOff: 0,
    description: "Split with the loyalty team.",
  },
  {
    name: "Diego",
    role: "iOS Developer",
    availability: 100,
    daysOff: 2,
    description: "At a conference on Thursday and Friday.",
  },
  { name: "Mei", role: "Android Developer", availability: 100, daysOff: 0 },
  {
    name: "Sam",
    role: "Backend Developer",
    availability: 80,
    daysOff: 1,
    description: "On call this sprint.",
  },
  {
    name: "Amara",
    role: "QA Engineer",
    availability: 100,
    daysOff: 5,
    description: "Vacation in week two.",
  },
];

export function buildExampleMembers(): CapacityMember[] {
  return ROWS.map((row, i) => ({ ...row, id: exampleId(`member-${i + 1}`) }));
}
