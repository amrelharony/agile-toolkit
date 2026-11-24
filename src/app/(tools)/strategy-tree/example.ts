/**
 * Strategy Tree's example: the same meal-kit product as the Impact Map's,
 * one tree in each shape (DIBB, Lean Value Tree, Hoshin Kanri), in our own
 * words. Every id is an example id, so "Clear example" removes exactly
 * these three trees.
 */

import type {
  StrategyMap,
  StrategyMapNode,
  StrategyNodeStatus,
} from "@/lib/stores/workspace-types";
import { exampleId } from "@/lib/utils/example-id";
import type { TreeFormat } from "@/lib/strategy-map/formats";

type Part = [
  key: string,
  parent: string | null,
  level: 0 | 1 | 2 | 3,
  text: string,
  extra?: Partial<StrategyMapNode>,
];

function tree(format: TreeFormat, title: string, parts: readonly Part[], at: string): StrategyMap {
  const id = (k: string) => exampleId(`st-${format}-${k}`);
  return {
    id: exampleId(`strategy-tree-${format}`),
    format,
    title,
    nodes: parts.map(([k, parent, level, text, extra]) => ({
      id: id(k),
      parentId: parent === null ? null : id(parent),
      level,
      text,
      status: "proposed" as StrategyNodeStatus,
      ...extra,
    })),
    createdAt: at,
    updatedAt: at,
  };
}

/** The three example trees, newest (DIBB) first. */
export function buildExamples(now = new Date()): StrategyMap[] {
  const at = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const agreed = { status: "agreed" as const };
  return [
    tree(
      "dibb",
      "Why people cancel after a price change",
      [
        ["data", null, 0, "4 in 10 cancellations come in the week after a price change", agreed],
        [
          "insight",
          "data",
          1,
          "People cancel when the price surprises them, not because of the food",
          agreed,
        ],
        ["belief", "insight", 2, "Warning people ahead keeps more of them", agreed],
        [
          "bet",
          "belief",
          3,
          "Email two weeks before a price change, with an offer to skip a week",
          { measure: "Cancellations in the week after the change" },
        ],
        ["insight2", "data", 1, "Most who cancel had skipped no week before"],
        ["belief2", "insight2", 2, "People don't know they can skip"],
        [
          "bet2",
          "belief2",
          3,
          "Show “Skip a week” on the cancel page",
          {
            status: "questioned",
            note: "Will it look like we hide the cancel button?",
            measure: "Share who skip instead of cancel",
          },
        ],
      ],
      at(1)
    ),
    tree(
      "lean-value-tree",
      "Good dinners without the planning",
      [
        ["vision", null, 0, "Good dinners without the planning", agreed],
        [
          "goal",
          "vision",
          1,
          "Customers order again within a month",
          { ...agreed, measure: "Share who order again within 30 days" },
        ],
        [
          "bet",
          "goal",
          2,
          "A favourites list makes reordering easy",
          { measure: "Reorders from favourites a week" },
        ],
        [
          "init",
          "bet",
          3,
          "Favourites on the home screen",
          { measure: "Taps on favourites", owner: "App team" },
        ],
        ["goal2", "vision", 1, "Fewer boxes arrive late", { measure: "Late deliveries a week" }],
        ["bet2", "goal2", 2, "Fewer stops per route means fewer late boxes"],
      ],
      at(2)
    ),
    tree(
      "hoshin",
      "Half of all orders from repeat customers",
      [
        [
          "aim",
          null,
          0,
          "Half of all orders come from repeat customers within three years",
          agreed,
        ],
        [
          "annual",
          "aim",
          1,
          "A third of orders are repeats by December",
          { ...agreed, measure: "Repeat orders as a share of all orders" },
        ],
        [
          "priority",
          "annual",
          2,
          "Make skipping easier than cancelling",
          { owner: "Product team" },
        ],
        [
          "target",
          "priority",
          3,
          "Fewer than 1 in 10 who open the cancel page leave",
          { measure: "Cancel page exits", owner: "Product team" },
        ],
        [
          "priority2",
          "annual",
          2,
          "Win back customers who left",
          { status: "questioned", note: "Who owns win-back emails this year?" },
        ],
      ],
      at(3)
    ),
  ];
}
