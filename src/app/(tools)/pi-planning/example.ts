import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import { dayFrom } from "../dependency-map/format";
import type { PiItem, PiItemKind, PiObjective, PiState, PiTeam } from "./store";

const id = (key: string) => exampleId(`pi-${key}`);

/** Example map ids start with this, so "Clear example" removes only the board's own edges. */
export const EXAMPLE_MAP_PREFIX = id("");

type Row = [key: string, title: string, iteration: number, kind: PiItemKind, points?: number];

const team = (key: string, name: string, velocity: number, description: string): PiTeam => ({
  id: id(key),
  name,
  velocity,
  description,
});

/** A dependency item's other side and due date, linked onto the map when the example loads. */
export interface ExampleLink {
  itemId: string;
  team: string;
  dependsOn: string;
  due: string;
}

/**
 * A five-iteration PI for an online shop (four iterations plus innovation
 * and planning). Checkout is over capacity in iteration 2 and waits on
 * Payments' refund API; Mobile waits on Checkout's guest endpoint, which is
 * already late. Payments still has a feature to size, and one objective is
 * waiting for its business value.
 */
export function buildExample(now: Date = new Date()): { state: PiState; links: ExampleLink[] } {
  const teams = [
    team("checkout", "Checkout", 30, "Web checkout and the basket"),
    team("payments", "Payments", 25, "Payment methods, refunds and payouts"),
    team("mobile", "Mobile", 20, "iOS and Android apps"),
  ];
  const rows: Record<string, Row[]> = {
    checkout: [
      ["c1", "Guest checkout", 0, "feature", 13],
      ["c2", "Address autocomplete", 0, "feature", 8],
      ["c3", "One-page checkout", 1, "feature", 20],
      ["c4", "Saved cards", 1, "feature", 13],
      ["c5", "Refund API", 1, "dependency"],
      ["c6", "Checkout analytics", 2, "feature", 8],
      ["c7", "PCI audit could slip the release", 2, "risk"],
    ],
    payments: [
      ["p1", "Refund API", 0, "feature", 13],
      ["p2", "Webhooks v2", 0, "feature", 8],
      ["p3", "Payouts dashboard", 1, "feature", 13],
      ["p4", "Fraud rules", 2, "feature", 8],
      ["p5", "Multi-currency prices", 3, "feature"],
    ],
    mobile: [
      ["m1", "Push notifications", 0, "feature", 8],
      ["m2", "Guest checkout endpoint", 0, "dependency"],
      ["m3", "Mobile checkout", 1, "feature", 13],
      ["m4", "Order tracking", 2, "feature", 8],
    ],
  };
  const items: PiItem[] = Object.entries(rows).flatMap(([teamKey, list]) =>
    list.map(([key, title, iteration, kind, points]) => ({
      id: id(key),
      title,
      teamId: id(teamKey),
      iteration,
      kind,
      ...(points !== undefined ? { points } : {}),
    }))
  );
  const objective = (
    key: string,
    teamKey: string,
    title: string,
    committed: boolean,
    businessValue?: number
  ): PiObjective => ({
    id: id(key),
    teamId: id(teamKey),
    title,
    committed,
    ...(businessValue !== undefined ? { businessValue } : {}),
  });
  const objectives = [
    objective("o1", "checkout", "Customers can check out as guests", true, 9),
    objective("o2", "checkout", "Checkout fits on one page", true, 7),
    objective("o3", "checkout", "Returning customers pay with a saved card", false, 5),
    objective("o4", "payments", "Customers refund an order themselves", true, 8),
    objective("o5", "payments", "Finance sees payouts without a spreadsheet", true),
    objective("o6", "mobile", "Order updates arrive as push notifications", true, 6),
  ];
  const links: ExampleLink[] = [
    { itemId: id("c5"), team: "Checkout", dependsOn: "Payments", due: dayFrom(now, 10) },
    { itemId: id("m2"), team: "Mobile", dependsOn: "Checkout", due: dayFrom(now, -2) },
  ];
  for (const link of links) {
    const item = items.find((i) => i.id === link.itemId);
    if (item) item.dependsOn = link.dependsOn;
  }
  return { state: { teams, items, iterations: 5, objectives }, links };
}

/**
 * The board without the example's teams, items and objectives, and
 * anything the user added to an example team (it would have no team left).
 * Nothing else is touched.
 */
export function withoutExample(state: PiState): PiState {
  const keep = (x: { id: string; teamId: string }) => !isExampleId(x.id) && !isExampleId(x.teamId);
  return {
    ...state,
    teams: state.teams.filter((t) => !isExampleId(t.id)),
    items: state.items.filter(keep),
    objectives: (state.objectives ?? []).filter(keep),
  };
}
