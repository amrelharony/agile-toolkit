import { exampleId } from "@/components/tool-frame/example-data";
import type { RaciLetter, RaciMatrix, TeamMember } from "@/lib/stores/workspace-types";
import { RACI_ID } from "@/lib/raci/model";

/** What the example shows: its own matrix and the team its people come from. Nothing is saved. */
export interface RaciExample {
  doc: RaciMatrix;
  /** The example team: its columns are these people, not the workspace roster's. */
  roster: TeamMember[];
}

const member = (key: string, name: string): TeamMember => ({
  id: exampleId(`raci-member-${key}`),
  name,
});

/**
 * A product team's matrix with each thing the checks look for: Priya, the
 * product owner, is Accountable for five of eight activities; architecture
 * decisions consult four roles; nobody is Accountable for incident
 * response. Two people are Accountable and Responsible at once (A/R):
 * Priya for the roadmap, Alex for architecture. Three columns are people
 * on the example team; "Dev Team" and "Stakeholders" are group roles.
 *
 * Every id is an `example-` id, and it all stays in the page's memory.
 */
export function buildExample(): RaciExample {
  const priya = member("priya", "Priya");
  const sam = member("sam", "Sam");
  const alex = member("alex", "Alex");
  const role = (key: string, name: string, m: TeamMember | null, description: string) => ({
    id: exampleId(`raci-role-${key}`),
    name,
    description,
    ...(m ? { memberId: m.id } : {}),
  });
  const roles = [
    role("po", "Priya", priya, "Product owner"),
    role("sm", "Sam", sam, "Scrum master"),
    role("lead", "Alex", alex, "Tech lead"),
    role("dev", "Dev Team", null, "Everyone building the product"),
    role("stake", "Stakeholders", null, "Sales, support and leadership"),
  ];
  const [po, sm, lead, dev, stake] = roles.map((r) => r.id);
  const activity = (key: string, name: string) => ({ id: exampleId(`raci-act-${key}`), name });
  const activities = [
    activity("refine", "Backlog refinement"),
    activity("plan", "Sprint planning"),
    activity("standup", "Daily standup"),
    activity("review", "Sprint review"),
    activity("roadmap", "Roadmap"),
    activity("release", "Release"),
    activity("arch", "Architecture decisions"),
    activity("incident", "Incident response"),
  ];
  const [refine, plan, standup, review, roadmap, release, arch, incident] = activities.map(
    (a) => a.id
  );
  const A: RaciLetter[] = ["A"];
  const R: RaciLetter[] = ["R"];
  const AR: RaciLetter[] = ["A", "R"];
  const C: RaciLetter[] = ["C"];
  const I: RaciLetter[] = ["I"];
  const cells: Record<string, Record<string, RaciLetter[]>> = {
    [refine]: { [po]: A, [dev]: R, [lead]: C },
    [plan]: { [po]: A, [dev]: R, [sm]: C },
    [standup]: { [sm]: A, [dev]: R },
    [review]: { [po]: A, [dev]: R, [stake]: I },
    [roadmap]: { [po]: AR, [stake]: C, [lead]: C },
    [release]: { [po]: A, [lead]: R, [stake]: I },
    [arch]: { [lead]: AR, [po]: C, [dev]: C, [sm]: C, [stake]: C },
    [incident]: { [lead]: R, [dev]: R, [sm]: I },
  };
  return {
    doc: { id: RACI_ID, roles, activities, cells },
    roster: [priya, sam, alex],
  };
}
