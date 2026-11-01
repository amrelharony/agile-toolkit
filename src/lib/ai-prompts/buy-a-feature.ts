import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { BuyAFeatureGame, PrioritizationItem, Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
import { allocationAmount } from "../realtime/vote-room/allocation";
import {
  budgetText,
  buyAFeatureVerdict,
  featureLedger,
  featureRows,
  fundedShare,
  gameCheck,
  isFunded,
  pool,
  remaining,
  unitOf,
  type FeatureLedger,
} from "../buy-a-feature/game";

/**
 * The game as the Buy-a-Feature page reads it: the feature rows (any order;
 * rows of other tools are left out) and the game document with the players,
 * each one's budget and the unit (null until they are set).
 */
interface BuyAFeatureData {
  items: readonly PrioritizationItem[];
  game?: BuyAFeatureGame | null;
}

/** Most raised first, as the market sorts. */
const byRaised = (a: FeatureLedger, b: FeatureLedger) => b.raised - a.raised;

/**
 * The debrief prompt over the game's numbers, from lib/buy-a-feature: what
 * each feature raised is capped at its price and % funded at 100 (an old
 * row that once took more counts at its price), a legacy price of 0 or a
 * fraction reads "Not priced", and amounts carry the game's unit.
 */
export function generateBuyAFeaturePrompts(
  data: BuyAFeatureData,
  workspace?: Workspace | null
): PromptDefinition[] {
  const features = featureRows(data.items).map(featureLedger).sort(byRaised);
  if (features.length === 0) return [];
  const context = workspace ? buildWorkspaceContext(workspace) : "";
  const unit = unitOf(data.game);
  const money = (n: number) => allocationAmount(n, unit);

  const table = formatTable(
    ["Feature", "Price", "Raised", "Funded", "Status"],
    features.map((f) => {
      const share = fundedShare(f);
      return [
        f.title,
        f.price === null ? "Not priced" : money(f.price),
        money(f.raised),
        share === null ? "—" : `${Math.round(share * 100)}%`,
        f.price === null
          ? "Not priced"
          : isFunded(f)
            ? "Funded"
            : f.raised > 0
              ? `Pledged, ${money(remaining(f))} to go`
              : `Open, ${money(remaining(f))} to go`,
      ];
    })
  );

  const p = pool(data.game, features);
  const check = gameCheck(data.game, features);
  const game =
    p && check
      ? `${budgetText(check, p, unit)} Spent: ${money(p.spent)}; left in the pool: ${money(p.left)}.`
      : "The players and their budget aren't set yet.";
  // The verdict names features and the unit is typed: both go inside the untrusted block.
  const verdict = `Verdict: ${sanitizePromptCell(buyAFeatureVerdict(features, data.game), 400)}`;

  return [
    {
      id: "buy-feature-debrief",
      title: "Game Debrief",
      description: "Read the signal from purchase patterns.",
      prompt:
        buildPreamble(
          "Buy-a-Feature",
          "Players share a pool of play money (budget per player × players) that can't buy every feature, so they have to choose. A purchase is capped at what a feature still needs; a feature that falls short keeps its pledges until the game ends."
        ) +
        `${wrapUserContent(`${verdict}\n\n${sanitizePromptCell(game, 400)}\n\n${table}`)}\n` +
        context +
        `\n## Questions\n\n` +
        `1. Which features got disproportionate buy-in vs price?\n` +
        `2. Which features were ignored — was the price wrong, or the value unclear?\n` +
        `3. Did stakeholders coalesce or scatter? What does that imply about alignment?\n` +
        `4. Recommend three features to take forward into the roadmap.\n` +
        `5. What should the next round's price points be?`,
    },
  ];
}
