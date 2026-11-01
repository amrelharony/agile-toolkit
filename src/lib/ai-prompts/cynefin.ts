import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { CynefinItem, Hypothesis, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import {
  DOMAINS,
  DOMAIN_IDS,
  cynefinVerdict,
  groupByDomain,
  hypothesisStateOf,
  normalizeAnswers,
  normalizeDomain,
  planOf,
  senseDomain,
} from "../cynefin/model";

/**
 * The board as the Cynefin page reads it: the items (each in the domain the
 * team confirmed) and the Hypothesis Tracker's hypotheses, for whether a
 * complex item is being tested.
 */
interface CynefinData {
  items: readonly CynefinItem[];
  hypotheses?: readonly Pick<Hypothesis, "id" | "status">[];
}

/** A domain lists this many items. */
const MAX_PER_DOMAIN = 30;

/**
 * Where the item's domain came from: the guided questions only suggest one
 * (senseDomain over the answers it was placed with) and the team confirms
 * it, so a confirmed domain that differs from the suggestion is said.
 */
function sourceText(item: CynefinItem): string {
  const answers = normalizeAnswers(item.answers);
  if (Object.keys(answers).length === 0) return "placed by hand";
  const suggested = senseDomain(answers).domain;
  if (!suggested) return "the questions suggested no domain; the team picked it";
  return suggested === normalizeDomain(item.domain)
    ? "the questions suggested it and the team confirmed it"
    : `the questions suggested ${DOMAINS[suggested].label}; the team confirmed ${DOMAINS[normalizeDomain(item.domain)].label}`;
}

/**
 * The recipe audit prompt over the board as the page shows it: each
 * domain with its recipe, each item's rationale, its own plan when it has
 * one, where its domain came from (suggested and confirmed), whether a
 * complex item is a hypothesis being tested, and the page's verdict.
 */
export function generateCynefinPrompts(
  data: CynefinData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const { items, hypotheses } = data;
  if (items.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const groups = groupByDomain(items);
  const testText = { none: "not yet a hypothesis", testing: "being tested", tested: "tested" };
  // Titles, rationales and plans are user-typed: the whole board is wrapped.
  const sections = DOMAIN_IDS.filter((d) => groups[d].length > 0)
    .map((d) => {
      const list = groups[d];
      const lines = list.slice(0, MAX_PER_DOMAIN).map((it) => {
        const plan = planOf(it);
        const parts = [
          sourceText(it),
          ...(plan.custom ? [`plan: ${sanitizePromptCell(plan.text, 200)}`] : []),
          ...(d === "complex" ? [testText[hypothesisStateOf(it, hypotheses)]] : []),
        ];
        return `- ${sanitizePromptCell(it.title, 120)}: ${sanitizePromptCell(it.rationale?.trim() || "—", 200)} (${parts.join("; ")})`;
      });
      const more =
        list.length > MAX_PER_DOMAIN ? `\n(and ${list.length - MAX_PER_DOMAIN} more)` : "";
      return `### ${DOMAINS[d].label} (${list.length}): ${DOMAINS[d].recipe}\n${lines.join("\n")}${more}`;
    })
    .join("\n\n");
  const body = wrapUserContent(
    `Verdict: ${sanitizePromptCell(cynefinVerdict(items, hypotheses), 400)}\n\n${sections}`
  );
  return [
    {
      id: "cynefin-recipe",
      title: "Domain Recipe Audit",
      description: "Check that each item is in the right domain, and the recipe matches.",
      prompt:
        buildPreamble(
          "Cynefin Decision Picker",
          "It places problems in Cynefin domains (Clear, Complicated, Complex, Chaotic, Confused), each with its recipe. Guided questions only suggest a domain; the team confirms it. A complex item can become a hypothesis to test."
        ) +
        body +
        "\n" +
        context +
        `\n## Questions\n\n` +
        `1. Are any 'Clear' items actually Complicated in disguise (cargo-cult best practice)?\n` +
        `2. For Complex items, what safe-to-fail experiments would you propose, starting with those not yet a hypothesis?\n` +
        `3. Are Chaotic items being given enough rapid-stabilisation attention?\n` +
        `4. Where the team's domain differs from the questions' suggestion, or the rationale looks weak, which domain would you pick and why?\n` +
        `5. What is the biggest organisational risk hiding in the Confused bucket?`,
    },
  ];
}
