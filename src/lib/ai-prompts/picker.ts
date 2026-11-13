import type { PromptDefinition } from "./types";
import { formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";

/**
 * The rotation as the Picker shows it: each role's people, fairest first,
 * with their turns and when they last had it.
 */
export interface PickerPromptData {
  roles: readonly {
    name: string;
    rows: readonly { name: string; turns: number; last: string; away: boolean }[];
  }[];
  shortlist: readonly string[];
}

/** A role lists this many people. */
const MAX_PEOPLE = 40;

/**
 * Copyable prompts over the Picker: a fair rotation plan from the fairness
 * history, and more name ideas in the style of the shortlist. Names and roles
 * are typed by the team, so they go inside the user-content block.
 */
export function generatePickerPrompts(data: PickerPromptData): PromptDefinition[] {
  const prompts: PromptDefinition[] = [];
  const roles = data.roles.filter((r) => r.rows.length > 0);
  if (roles.length > 0) {
    const tables = roles
      .map(
        (role) =>
          `${sanitizePromptCell(role.name, 40)}:\n${formatTable(
            ["Person", "Turns", "Last turn", "Today"],
            role.rows
              .slice(0, MAX_PEOPLE)
              .map((r) => [r.name, r.turns, r.last, r.away ? "away" : "here"])
          )}`
      )
      .join("\n\n");
    prompts.push({
      id: "picker-rotation-plan",
      title: "Plan a fair rotation",
      description: "A rota for the next six ceremonies that evens out who runs them.",
      prompt: `You are an experienced Scrum Master. A team rotates standing roles so the same people don't always run the meetings. Below is each role's fairness history: who has had it, how often and how long ago, fairest first.

${wrapUserContent(tables)}

Propose who takes each role for the next six ceremonies, so turns even out and nobody holds two roles at once. Skip anyone marked away for the first ceremony only. Then give two short tips for making each role easier for someone new to it.`,
    });
  }
  if (data.shortlist.length > 0) {
    const list = data.shortlist.map((n) => `- ${sanitizePromptCell(n, 30)}`).join("\n");
    prompts.push({
      id: "picker-name-ideas",
      title: "More names like the shortlist",
      description: "Ten more team or sprint names in the same spirit as the ones the team liked.",
      prompt: `A team is choosing a name for itself or for its sprints. These are the names it shortlisted:

${wrapUserContent(list)}

Suggest ten more names in the same spirit: short, easy to say, all different, nothing rude, no living people or brands. Give one line on why each fits.`,
    });
  }
  return prompts;
}
