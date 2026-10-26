import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  ALLOCATION_ROUND_KIND,
  BUY_A_FEATURE_ID,
  BUY_A_FEATURE_KIND,
  type AllocationRound,
  type BuyAFeatureGame,
  type PrioritizationItem,
} from "@/lib/stores/workspace-types";
import { allocationRoundFrom, roundsFor } from "@/lib/hundred-dollar/allocation";
import {
  applyAllocationRound,
  budgetCheck,
  budgetProblem,
  buyAFeatureSheet,
  buyAFeatureVerdict,
  featureLedger,
  nextRound,
  pool,
  purchaseProblem,
  recordPurchase,
  refundUnfunded,
  remaining,
  roundOutcomeText,
  withPrice,
  withRaised,
} from "@/lib/buy-a-feature/game";
import type { AllocationRoundResult } from "@/lib/realtime/vote-room/allocation";
import { registry } from "@/lib/actions/registry";

/**
 * Buy-a-Feature, upgraded: the game has players and a budget each (the
 * pool), checked against the sum of prices; purchases at the table are
 * capped at what a feature still needs and refused above what's left in
 * the pool; refunds and resets have Undo; rounds run through the vote-room
 * kit's allocation kind (paper splits here) with each feature's total
 * capped the same way and kept as totals only; funded features go to the
 * backlog as stories once. The agent actions compute the same numbers
 * through the same library.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
const server = vi.hoisted(() => new Map<string, Map<string, { id: string }>>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const kind = (k: string) => {
    if (!server.has(k)) server.set(k, new Map());
    return server.get(k) as Map<string, { id: string }>;
  };
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, k: string) => Array.from(kind(k).values())),
    serverGetEntity: vi.fn(async (_u: string, k: string, id: string) => kind(k).get(id) ?? null),
    serverUpsertEntity: vi.fn(async (_u: string, k: string, e: { id: string }) => {
      kind(k).set(e.id, e);
    }),
    serverBulkUpsertEntities: vi.fn(async (_u: string, k: string, es: { id: string }[]) => {
      for (const e of es) kind(k).set(e.id, e);
    }),
  };
});

import { BuyAFeatureClient } from "@/app/(tools)/buy-a-feature/buy-a-feature-client";
import { buildExample } from "@/app/(tools)/buy-a-feature/example";
import { toMarkdown } from "@/app/(tools)/buy-a-feature/markdown";
import { validateFeature } from "@/app/(tools)/buy-a-feature/feature-form";
import "@/lib/actions/tools/buy-a-feature";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const feature = (
  id: string,
  title: string,
  price: number | string,
  raised: number | string = 0
): PrioritizationItem => ({
  id,
  framework: "buy-feature",
  title,
  score: Number(raised),
  fields: { price, raised },
  status: "open",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const GAME: BuyAFeatureGame = {
  id: BUY_A_FEATURE_ID,
  players: 5,
  budgetPerPlayer: 30,
  updatedAt: "2026-10-01T09:00:00.000Z",
};

/** Prices $220 in all; 5 × $30 = $150; $10 raised, $140 left (28 each). */
const ROWS = () => [
  feature("a", "Search", 60),
  feature("b", "Exports", 40, 10),
  feature("c", "SSO", 120),
];

const rowsInStore = () =>
  (useWorkspaceStore.getState().prioritizations ?? []).filter((x) => x.framework === "buy-feature");
const raisedOf = (id: string) => {
  const r = rowsInStore().find((x) => x.id === id);
  return r ? featureLedger(r).raised : undefined;
};
const gameInStore = () =>
  (useWorkspaceStore.getState().buyAFeatureGames ?? []).find((g) => g.id === BUY_A_FEATURE_ID);
const roundsInStore = () => useWorkspaceStore.getState().allocationRounds ?? [];

function renderPage() {
  return render(
    <TooltipProvider>
      <BuyAFeatureClient />
    </TooltipProvider>
  );
}

/** A KPI tile's value, by its label (the tiles' labels are the uppercase ones). */
const kpi = (label: string) =>
  screen.getAllByText(label).find((el) => el.className.includes("uppercase"))?.nextSibling
    ?.textContent;

/** Click Undo on the toast labelled `label` (the latest one). */
function undo(label: string) {
  const call = [...toastSpy.mock.calls].reverse().find(([l]) => l === label) as
    | [string, { action: { onClick: () => void } }]
    | undefined;
  expect(call, `toast "${label}"`).toBeDefined();
  call?.[1].action.onClick();
}
const toastOf = (label: string) =>
  [...toastSpy.mock.calls].reverse().find(([l]) => l === label)?.[1] as
    | { description?: string }
    | undefined;

const buy = (title: string, amount: string) => {
  const field = screen.getByLabelText(`Amount to buy of ${title}`);
  fireEvent.change(field, { target: { value: amount } });
  fireEvent.submit(field.closest("form") as HTMLFormElement);
};

const commitSetting = (label: string, value: string) => {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

/** A round's result as the kit hands it over (aggregates only). */
const result = (items: { id: string; text: string; total: number; cap?: number }[]) =>
  ({
    kind: "allocation",
    roundId: "round-1",
    tool: "buy-a-feature",
    sheetId: "buy-a-feature-round-1",
    title: "Buy-a-Feature, round 1",
    budget: 28,
    unit: "$",
    spendAll: false,
    closedAt: "2026-10-20T10:00:00.000Z",
    minN: 3,
    ballots: 5,
    source: "facilitator",
    spreadKnown: true,
    bandEdges: [0, 1, 3, 8, 15],
    items: items.map((x) => ({ ...x, backers: null, bands: null })),
  }) as AllocationRoundResult;

beforeEach(() => {
  toastSpy.mockReset();
  toastSpy.error.mockReset();
  logs.length = 0;
  server.clear();
  useWorkspaceStore.setState({
    prioritizations: [],
    buyAFeatureGames: [],
    allocationRounds: [],
    stories: [],
    teamMembers: [],
  });
});

/* ── The library ────────────────────────────────────────────────────── */

describe("the game's rules (lib/buy-a-feature/game)", () => {
  it("reads a legacy row as capped at its price, or Not priced", () => {
    expect(featureLedger(feature("x", "X", 50, 80))).toMatchObject({
      price: 50,
      raised: 50,
      overStored: 30,
    });
    expect(featureLedger(feature("y", "Y", 0, 30))).toMatchObject({ price: null, raised: 30 });
    expect(featureLedger(feature("z", "Z", 12.5))).toMatchObject({ price: null });
    expect(featureLedger(feature("w", "W", "", ""))).toMatchObject({ price: null, raised: 0 });
  });

  it("caps a purchase at what's left of the price, and says what went back", () => {
    const f = featureLedger(feature("b", "Exports", 40, 10));
    expect(recordPurchase(f, 50)).toEqual({ raised: 40, applied: 30, refunded: 20 });
    expect(recordPurchase(f, 5)).toEqual({ raised: 15, applied: 5, refunded: 0 });
    expect(remaining(f)).toBe(30);
  });

  it("refuses purchases nobody can make, in a sentence", () => {
    const features = ROWS().map(featureLedger);
    const p = pool(GAME, features);
    const [a, , c] = features;
    expect(p).toMatchObject({ pool: 150, spent: 10, left: 140, overspent: 0 });
    expect(purchaseProblem(a, undefined, p, "$")).toBe("Enter an amount.");
    expect(purchaseProblem(a, 2.5, p, "$")).toBe("Enter a whole amount, 1 or more.");
    expect(purchaseProblem(a, 0, p, "$")).toBe("Enter a whole amount, 1 or more.");
    expect(purchaseProblem(a, 10, null, "$")).toMatch(/^Set the players and each one's budget/);
    // SSO needs $120: more than a pool with $100 left.
    expect(purchaseProblem(c, 141, { ...p!, left: 100 }, "$")).toBe("Only $100 left in the pool.");
    expect(purchaseProblem(c, 141, p, "$")).toBeNull();
    // Capped first: 200 on Search applies only its $60.
    expect(purchaseProblem(a, 200, p, "$")).toBeNull();
    const spent = { ...p!, left: 0 };
    expect(purchaseProblem(a, 1, spent, "$")).toBe("The pool is spent.");
    expect(purchaseProblem(featureLedger(feature("f", "F", 10, 10)), 1, p, "$")).toBe(
      "It's already funded."
    );
  });

  it("checks that the pool is below the sum of prices, and suggests about half", () => {
    const ok = budgetCheck([60, 40, 120], 5, 30);
    expect(ok).toMatchObject({ pool: 150, sumOfPrices: 220, ok: true, suggestedBudget: 22 });
    expect(budgetProblem(ok, "$")).toBeNull();
    const all = budgetCheck([60, 40, 120], 5, 50);
    expect(all.ok).toBe(false);
    expect(budgetProblem(all, "$")).toBe(
      "The players could buy everything. Lower the budget below $44 each, or add features."
    );
    expect(budgetCheck([], 5, 30)).toMatchObject({ ok: false, share: null, budgetBelow: null });
    // About half of $40 for 5 is $4: below the smallest budget, so none is offered.
    expect(budgetCheck([40], 5, 10).suggestedBudget).toBeNull();
  });

  it("budgets round 1 per player, and later rounds from the pool's leftover", () => {
    const features = ROWS().map(featureLedger);
    const first = nextRound(features, GAME, []);
    expect(first).toMatchObject({ number: 1, budget: 28, blocked: null });
    expect(first.sheet?.items.map((x) => [x.id, x.cap])).toEqual([
      ["a", 60],
      ["b", 30],
      ["c", 120],
    ]);
    expect(first.sheet).toMatchObject({ budget: 28, spendAll: false, unit: "$" });
    const later = nextRound(features, GAME, [
      { id: "r", tool: "buy-a-feature", date: "2026-10-20", closedAt: "x" } as AllocationRound,
    ]);
    expect(later.number).toBe(2);
    expect(nextRound(features, { ...GAME, budgetPerPlayer: undefined }, []).blocked).toBe(
      "Set the players and each one's budget first."
    );
    expect(nextRound(features, { ...GAME, budgetPerPlayer: 50 }, []).blocked).toMatch(
      /^The players could buy everything/
    );
    const nearlyDone = [feature("a", "A", 1000, 990), feature("b", "B", 1000, 5)].map(
      featureLedger
    );
    expect(nextRound(nearlyDone, { ...GAME, players: 100, budgetPerPlayer: 10 }, []).blocked).toBe(
      "Only $0 is left per player, too little for another round. Buy the last features at the table."
    );
    const oneLeft = [features[0], featureLedger(feature("f", "F", 200, 200))];
    expect(nextRound(oneLeft, GAME, []).blocked).toBe(
      "A round needs at least two priced features that aren't funded yet."
    );
  });

  it("leaves funded and unpriced features out of a round's sheet", () => {
    const features = [
      feature("a", "A", 60, 60),
      feature("b", "B", 0),
      feature("c", "C", 40, 10),
      feature("d", "D", 30),
    ].map(featureLedger);
    const sheet = buyAFeatureSheet(features, 25, "$", 3);
    expect(sheet?.id).toBe("buy-a-feature-round-3");
    expect(sheet?.items).toEqual([
      { id: "c", text: "C", hint: "Priced $40, $10 raised", cap: 30 },
      { id: "d", text: "D", hint: "Priced $30", cap: 30 },
    ]);
    expect(buyAFeatureSheet(features.slice(0, 3), 25, "$", 1)).toBeNull();
  });

  it("caps a round's totals per feature; short pledges stay, the rest goes back", () => {
    const features = ROWS().map(featureLedger);
    const applied = applyAllocationRound(
      features,
      result([
        { id: "a", text: "Search", total: 70 },
        { id: "b", text: "Exports", total: 34 },
        { id: "c", text: "SSO", total: 28 },
        { id: "gone", text: "Gone", total: 5 },
      ])
    );
    expect(Object.fromEntries(applied.next)).toEqual({ a: 60, b: 40, c: 28 });
    expect(applied).toMatchObject({
      funded: ["a", "b"],
      refunded: 19,
      spends: 118,
      short: [{ id: "c", by: 92 }],
      missing: ["gone"],
    });
    expect(roundOutcomeText(applied, features, "$")).toBe(
      "Funded Search and Exports; SSO is $92 short; $19 of over-funding went back to the pool."
    );
  });

  it("copes with huge prices and an empty market", () => {
    const big = [feature("a", "Platform rewrite", 5_000_000), feature("b", "B", 900)].map(
      featureLedger
    );
    const sheet = buyAFeatureSheet(big, 9999, "$", 1);
    // Above the kit's cap the budget binds anyway: no cap on the line.
    expect(sheet?.items[0]).toEqual({
      id: "a",
      text: "Platform rewrite",
      hint: "Priced $5,000,000",
    });
    expect(sheet?.items[1].cap).toBe(900);
    expect(budgetCheck([5_000_000, 900], 100, 9999)).toMatchObject({
      ok: true,
      suggestedBudget: null,
    });
    expect(featureLedger(feature("x", "X", 2_000_000_000)).price).toBeNull();
    expect(pool(GAME, [])).toMatchObject({ spent: 0, left: 150 });
    expect(nextRound([], GAME, []).blocked).toBe(
      "A round needs at least two priced features that aren't funded yet."
    );
  });

  it("refunds only features that fell short", () => {
    const features = [
      feature("a", "A", 60, 60),
      feature("b", "B", 40, 10),
      feature("c", "C", 30),
      feature("d", "D", 0, 5),
    ].map(featureLedger);
    expect(Object.fromEntries(refundUnfunded(features))).toEqual({ b: 0, d: 0 });
  });

  it("gives back what a lower price no longer needs", () => {
    const { row, refunded } = withPrice(feature("a", "A", 60, 50), 40, "now");
    expect(row.fields).toMatchObject({ price: 40, raised: 40 });
    expect(row.status).toBe("decided");
    expect(refunded).toBe(10);
    expect(withRaised(feature("a", "A", 60), 999, "now").fields?.raised).toBe(60);
  });

  it("says in one sentence what the game still needs, or what it funded", () => {
    const f = (rows: PrioritizationItem[]) => rows.map(featureLedger);
    expect(buyAFeatureVerdict([], GAME)).toBe("No features yet.");
    expect(buyAFeatureVerdict(f(ROWS()), null)).toBe(
      "3 features priced at $220 in all: set the players and each one's budget to start."
    );
    expect(buyAFeatureVerdict(f([feature("a", "A", 60), feature("c", "C", 40)]), GAME)).toBe(
      "The players could buy everything. Lower the budget below $20 each, or add features."
    );
    expect(buyAFeatureVerdict(f([feature("a", "A", 60), feature("c", "C", 200)]), GAME)).toBe(
      "5 players × $30 = $150 can buy 58% of the $260 of features; nothing bought yet."
    );
    expect(buyAFeatureVerdict(f(ROWS()), GAME)).toBe(
      "No feature funded yet: $10 pledged, $140 of the $150 pool left."
    );
    expect(buyAFeatureVerdict(f([feature("a", "Search", 60, 60), ...ROWS().slice(1)]), GAME)).toBe(
      "Funded 1 of 3 features (Search), with $80 of the $150 pool left."
    );
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("Buy-a-Feature page: adding features", () => {
  it("refuses a blank or fractional price instead of storing a free feature", () => {
    expect(validateFeature({ title: "SSO", price: "" })).toEqual({
      ok: false,
      errors: { price: "Enter a price." },
    });
    expect(validateFeature({ title: "SSO", price: "2.5" }).ok).toBe(false);
    expect(validateFeature({ title: "", price: "10" }).ok).toBe(false);
    renderPage();
    fireEvent.change(screen.getByLabelText("Feature"), { target: { value: "SSO" } });
    fireEvent.click(screen.getByRole("button", { name: "Add feature" }));
    expect(screen.getByText("Enter a price.")).toBeInTheDocument();
    expect(rowsInStore()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Add feature" }));
    expect(rowsInStore()).toEqual([
      expect.objectContaining({ title: "SSO", fields: { price: 120, raised: 0 } }),
    ]);
  });
});

describe("Buy-a-Feature page: the game", () => {
  beforeEach(() => useWorkspaceStore.setState({ prioritizations: ROWS() }));

  it("leaves players and budget unset until chosen, offering the team's size and half the prices", () => {
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana" },
        { id: "m2", name: "Bo" },
        { id: "m3", name: "Cy" },
        { id: "m4", name: "Di" },
        { id: "m5", name: "Ed" },
      ],
    });
    renderPage();
    expect(kpi("Pool")).toBe("Not set");
    expect(screen.getByLabelText("Players")).toHaveValue(null);
    expect(screen.getByLabelText("Amount to buy of Search")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use the team's 5 people" }));
    expect(gameInStore()?.players).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "About half the prices: $22 each" }));
    expect(gameInStore()?.budgetPerPlayer).toBe(22);
    expect(kpi("Pool")).toBe("$110");
    expect(screen.getByTestId("buy-a-feature-budget")).toHaveTextContent(
      "5 players × $22 = $110 can buy 50% of the $220 of features."
    );
  });

  it("refuses a budget out of range without saving it", () => {
    renderPage();
    commitSetting("Budget per player", "5");
    expect(screen.getByText("Enter a whole number from 10 to 9,999.")).toBeInTheDocument();
    expect(gameInStore()?.budgetPerPlayer).toBeUndefined();
    commitSetting("Budget per player", "30");
    commitSetting("Players", "5");
    expect(gameInStore()).toMatchObject({ budgetPerPlayer: 30, players: 5 });
  });

  it("blocks the round when the players could buy everything", () => {
    useWorkspaceStore.setState({ buyAFeatureGames: [{ ...GAME, budgetPerPlayer: 50 }] });
    renderPage();
    const why =
      "The players could buy everything. Lower the budget below $44 each, or add features.";
    expect(screen.getAllByText(why).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("button", { name: "Add split" })).toBeNull();
  });
});

describe("Buy-a-Feature page: buying at the table", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({ prioritizations: ROWS(), buyAFeatureGames: [GAME] })
  );

  it("caps a purchase at the price, says what went back, and offers Undo", () => {
    renderPage();
    expect(kpi("Left")).toBe("$140");
    buy("Search", "70");
    expect(raisedOf("a")).toBe(60);
    expect(toastOf("Bought $60 of Search")?.description).toBe("$10 went back: it only needed $60.");
    expect(logs.at(-1)).toEqual({
      action: "purchase_recorded",
      payload: { id: "a", amount: 70, applied: 60, refunded: 10 },
    });
    expect(kpi("Left")).toBe("$80");
    undo("Bought $60 of Search");
    expect(raisedOf("a")).toBe(0);
  });

  it("refuses a purchase over what's left in the pool, or a blank one, inline", () => {
    renderPage();
    buy("Search", "60");
    buy("SSO", "100");
    expect(screen.getByText("Only $80 left in the pool.")).toBeInTheDocument();
    expect(raisedOf("c")).toBe(0);
    buy("SSO", "");
    expect(screen.getByText("Enter an amount.")).toBeInTheDocument();
  });

  it("doesn't move a row after a purchase until Re-sort", () => {
    renderPage();
    const order = () =>
      screen
        .getAllByRole("progressbar")
        .map((el) => el.getAttribute("aria-label")?.replace(" funding progress", ""));
    expect(order()).toEqual(["Exports", "Search", "SSO"]);
    buy("SSO", "30");
    expect(order()).toEqual(["Exports", "Search", "SSO"]);
    fireEvent.click(screen.getByRole("button", { name: "Re-sort" }));
    expect(order()).toEqual(["SSO", "Exports", "Search"]);
  });

  it("refunds a feature, and deletes one, each with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Refund $10 from Exports" }));
    expect(raisedOf("b")).toBe(0);
    undo("Refunded $10 from Exports");
    expect(raisedOf("b")).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "Delete SSO" }));
    expect(rowsInStore().map((r) => r.id)).toEqual(["a", "b"]);
    undo("Deleted “SSO”");
    expect(
      rowsInStore()
        .map((r) => r.id)
        .sort()
    ).toEqual(["a", "b", "c"]);
  });

  it("refunds the unfunded features after asking, with Undo", () => {
    useWorkspaceStore.setState({
      prioritizations: [feature("a", "Search", 60, 60), ...ROWS().slice(1)],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Refund unfunded features" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("1 feature gives back $10 to the pool.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Refund them" }));
    expect([raisedOf("a"), raisedOf("b")]).toEqual([60, 0]);
    undo("Refunded 1 unfunded feature");
    expect(raisedOf("b")).toBe(10);
  });

  it("resets the game after asking: money back, budget cleared, rounds gone; Undo restores", () => {
    const round = allocationRoundFrom(
      result([
        { id: "a", text: "Search", total: 40 },
        { id: "c", text: "SSO", total: 20 },
      ]),
      { id: "allocationRound_r1", date: "2026-10-20" }
    );
    useWorkspaceStore.setState({ allocationRounds: [round] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Reset game" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset game" }));
    expect(raisedOf("b")).toBe(0);
    expect(gameInStore()).toMatchObject({ players: 5 });
    expect(gameInStore()?.budgetPerPlayer).toBeUndefined();
    expect(roundsInStore()).toHaveLength(0);
    expect(logs.at(-1)?.action).toBe("game_reset");
    undo("Reset the game");
    expect(raisedOf("b")).toBe(10);
    expect(gameInStore()?.budgetPerPlayer).toBe(30);
    expect(roundsInStore()).toHaveLength(1);
  });

  it("shows a legacy over-funded row at its price, and a price of 0 as Not priced", () => {
    useWorkspaceStore.setState({
      prioritizations: [feature("x", "Old", 50, 80), feature("y", "Free", 0, 0), ...ROWS()],
    });
    renderPage();
    expect(screen.getByText("$50 of $50 (100%)")).toBeInTheDocument();
    expect(
      screen.getByText("It once took $30 more than its price; only the price counts.")
    ).toBeInTheDocument();
    expect(screen.getByText("Not priced")).toBeInTheDocument();
  });
});

describe("Buy-a-Feature page: rounds", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({ prioritizations: ROWS(), buyAFeatureGames: [GAME] })
  );

  /** Paper splits through the kit's count entry (live rooms are off in tests). */
  function enterSplits(splits: number[][]) {
    const titles = ["Search", "Exports", "SSO"];
    for (const s of splits) {
      s.forEach((n, i) =>
        fireEvent.change(screen.getByLabelText(`${i + 1}. ${titles[i]}`), {
          target: { value: String(n) },
        })
      );
      fireEvent.click(screen.getByRole("button", { name: "Add split" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
  }

  const SPLITS = [
    [20, 8, 0],
    [20, 8, 0],
    [20, 8, 0],
    [10, 10, 8],
    [0, 0, 20],
  ];

  it("splits what's left per player, caps each total, saves totals only, and Undo restores", () => {
    renderPage();
    expect(screen.getByText(/round 1: \$28 each/)).toBeInTheDocument();
    enterSplits(SPLITS);
    expect(
      screen.getByText(
        "Saving it: Funded Search and Exports; SSO is $92 short; $14 of over-funding went back to the pool."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect([raisedOf("a"), raisedOf("b"), raisedOf("c")]).toEqual([60, 40, 28]);
    const [saved] = roundsInStore();
    expect(saved).toMatchObject({ tool: "buy-a-feature", ballots: 5, budget: 28, spendAll: false });
    expect(saved.items.map((x) => [x.itemId, x.total, x.cap])).toEqual([
      ["a", 70, 60],
      ["b", 34, 30],
      ["c", 28, 120],
    ]);
    for (const item of saved.items) {
      expect(Object.keys(item).sort()).toEqual([
        "backers",
        "bands",
        "cap",
        "itemId",
        "text",
        "total",
      ]);
    }
    expect(
      screen.getByText(
        "Last round: Funded Search and Exports; SSO is $92 short; $14 of over-funding went back to the pool."
      )
    ).toBeInTheDocument();
    undo("Saved the round");
    expect([raisedOf("a"), raisedOf("b"), raisedOf("c")]).toEqual([0, 10, 0]);
    expect(roundsInStore()).toHaveLength(0);
  });

  it("pushes funded features to the backlog as stories, once, with Undo", () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Search", 60, 60),
        feature("b", "Exports", 40, 40),
        ...ROWS().slice(2),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add 2 funded features to the backlog" }));
    const stories = useWorkspaceStore.getState().stories;
    expect(stories.map((s) => [s.title, s.status, s.sourceRef])).toEqual([
      ["Search", "backlog", { tool: "buy-a-feature", id: "a" }],
      ["Exports", "backlog", { tool: "buy-a-feature", id: "b" }],
    ]);
    expect(rowsInStore().find((r) => r.id === "a")?.sentTo?.[0]).toMatchObject({
      route: "backlog-story",
      targetId: stories[0].id,
    });
    expect(screen.queryByRole("button", { name: /funded features? to the backlog/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: "In the backlog · Open" })).toHaveLength(2);
    undo("Added 2 funded features to the backlog");
    expect(useWorkspaceStore.getState().stories).toHaveLength(0);
    expect(rowsInStore().find((r) => r.id === "a")?.sentTo).toEqual([]);
  });
});

describe("Buy-a-Feature page: first run and the example", () => {
  it("shows an empty state with an example that never reaches the workspace", () => {
    renderPage();
    expect(screen.getByText(/No features yet\. Add each one with a price/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(kpi("Pool")).toBe("$500");
    expect(kpi("Left")).toBe("$200");
    expect(kpi("Funded")).toBe("1 of 6");
    expect(
      screen.getByText("Clear the example to run a round with your team.")
    ).toBeInTheDocument();
    expect(rowsInStore()).toHaveLength(0);
    expect(gameInStore()).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No features yet\. Add each one with a price/)).toBeInTheDocument();
  });

  it("builds an example whose round explains what was raised", () => {
    const ex = buildExample(new Date("2026-10-26T12:00:00"));
    const features = ex.rows.map(featureLedger);
    expect(
      budgetCheck(
        features.map((f) => f.price as number),
        5,
        100
      ).ok
    ).toBe(true);
    const [round] = ex.rounds;
    expect(round.date).toBe("2026-10-25");
    for (const item of round.items) {
      const f = features.find((x) => x.id === item.itemId);
      expect(f?.raised, item.text).toBe(Math.min(item.total, item.cap ?? Infinity));
      expect(item.bands?.reduce((a, b) => a + b, 0)).toBe(round.ballots);
    }
  });
});

describe("Buy-a-Feature: Markdown", () => {
  it("exports the verdict, the pool, each feature and the latest round", () => {
    const rows = [feature("a", "Search", 60, 60), ...ROWS().slice(1)];
    const round = allocationRoundFrom(
      result([
        { id: "a", text: "Search", total: 60, cap: 60 },
        { id: "c", text: "SSO", total: 20, cap: 120 },
      ]),
      { id: "allocationRound_r1", date: "2026-10-20" }
    );
    const md = toMarkdown(rows, GAME, [round], {
      inBacklog: (id) => id === "a",
      now: new Date("2026-10-26T12:00:00"),
    });
    expect(md).toContain("# Buy-a-Feature — 26 Oct 2026");
    expect(md).toContain("> Funded 1 of 3 features (Search), with $80 of the $150 pool left.");
    expect(md).toContain("- 5 players × $30 = $150 can buy 68% of the $220 of features.");
    expect(md).toContain("| Search | $60 | $60 | $0 | Funded, in the backlog |");
    expect(md).toContain("| Exports | $40 | $10 | $30 | Pledged |");
    expect(md).toContain("## Latest round: Buy-a-Feature, round 1");
    expect(toMarkdown([], null, [])).toContain("No features yet.");
  });
});

/* ── Agent actions ──────────────────────────────────────────────────── */

describe("tool.buy_a_feature", () => {
  const call = (verb: string, params: Record<string, unknown> = {}) =>
    registry.get(`tool.buy_a_feature.${verb}`)?.handler(params, ctx()) as Promise<
      Record<string, unknown>
    >;
  const callServer = (verb: string, params: Record<string, unknown> = {}) =>
    registry.get(`tool.buy_a_feature.${verb}`)?.mcpHandler?.(params, ctx()) as Promise<
      Record<string, unknown>
    >;

  it("registers a read and write verbs, each with a server handler", () => {
    expect(registry.get("tool.buy_a_feature.list_state")?.category).toBe("read");
    for (const verb of [
      "add_feature",
      "set_game",
      "record_purchase",
      "refund",
      "refund_unfunded",
      "record_round",
    ]) {
      const action = registry.get(`tool.buy_a_feature.${verb}`);
      expect(action?.category).toBe("write");
      expect(action?.mcpHandler).toBeTypeOf("function");
      expect(action?.requiresConfirmation).toBe(verb === "refund_unfunded");
    }
  });

  it("plays a game the way the page does", async () => {
    const a = await call("add_feature", { title: "Search", price: 60 });
    await call("add_feature", { title: "SSO", price: 120 });
    expect(await call("record_purchase", { id: a.id, amount: 10 })).toMatchObject({
      recorded: false,
      reason: "Set the players and each one's budget first: purchases come out of the pool.",
    });
    expect(await call("set_game", { players: 5, budgetPerPlayer: 50 })).toMatchObject({
      set: true,
      pool: 250,
      problem:
        "The players could buy everything. Lower the budget below $36 each, or add features.",
    });
    await call("set_game", { budgetPerPlayer: 30 });
    expect(await call("record_purchase", { id: a.id, amount: 70 })).toEqual({
      recorded: true,
      applied: 60,
      refunded: 10,
      raised: 60,
      remaining: 0,
      funded: true,
    });
    expect(await call("set_game", { unit: null, players: null })).toMatchObject({
      game: { players: null, budgetPerPlayer: 30, unit: null },
    });
  });

  it("records a round's typed totals, capped, and refuses what can't be one", async () => {
    useWorkspaceStore.setState({ prioritizations: ROWS(), buyAFeatureGames: [GAME] });
    expect(await call("record_round", { totals: { a: 70, zz: 5 }, players: 5 })).toMatchObject({
      saved: false,
      reason: expect.stringContaining("zz"),
    });
    expect(
      await call("record_round", { totals: { a: 141, b: 0, c: 0 }, players: 5 })
    ).toMatchObject({ saved: false });
    const saved = await call("record_round", { totals: { a: 70, b: 34, c: 28 }, players: 5 });
    expect(saved).toMatchObject({
      saved: true,
      round: 1,
      budgetPerPlayer: 28,
      spent: 118,
      refunded: 14,
      funded: [
        { id: "a", title: "Search" },
        { id: "b", title: "Exports" },
      ],
      short: [{ id: "c", title: "SSO", by: 92 }],
    });
    expect([raisedOf("a"), raisedOf("b"), raisedOf("c")]).toEqual([60, 40, 28]);
    const [round] = roundsFor(roundsInStore(), "buy-a-feature");
    expect(round.items.every((x) => x.bands === null && x.backers === null)).toBe(true);
    const state = (await call("list_state")) as {
      nextRound: { number: number; budgetPerPlayer: number };
    };
    // Round 2: the $22 left in the pool, split between 5: $4 each, too little.
    expect(state.nextRound).toMatchObject({ number: 2, budgetPerPlayer: 4 });
  });

  it("refunds one feature and the short ones", async () => {
    useWorkspaceStore.setState({
      prioritizations: [
        feature("a", "Search", 60, 60),
        ...ROWS().slice(1),
        feature("d", "D", 30, 5),
      ],
      buyAFeatureGames: [GAME],
    });
    expect(await call("refund_unfunded")).toEqual({ refunded: 2, amount: 15, ids: ["b", "d"] });
    expect(raisedOf("a")).toBe(60);
    expect(await call("refund", { id: "a" })).toEqual({ refunded: true, amount: 60 });
    expect(await call("refund", { id: "a" })).toMatchObject({ refunded: false });
  });

  it("gives the page's numbers for the same data", async () => {
    const rows = [feature("a", "Search", 60, 60), ...ROWS().slice(1)];
    useWorkspaceStore.setState({ prioritizations: rows, buyAFeatureGames: [GAME] });
    renderPage();
    const state = (await call("list_state")) as {
      pool: { pool: number; spent: number; left: number };
      verdict: string;
      features: { id: string; title: string; remaining: number | null; funded: boolean }[];
      counts: { funded: number; priced: number };
    };
    expect(kpi("Pool")).toBe(`$${state.pool.pool}`);
    expect(kpi("Spent")).toBe(`$${state.pool.spent}`);
    expect(kpi("Left")).toBe(`$${state.pool.left}`);
    expect(kpi("Funded")).toBe(`${state.counts.funded} of ${state.counts.priced}`);
    expect(screen.getByTestId("buy-a-feature-verdict")).toHaveTextContent(state.verdict);
    for (const f of state.features.filter((x) => !x.funded)) {
      expect(screen.getByText(`$${f.remaining} to go`)).toBeInTheDocument();
    }
  });

  it("reads and writes the user's rows on the server the same way", async () => {
    const rows = ROWS();
    useWorkspaceStore.setState({ prioritizations: rows, buyAFeatureGames: [GAME] });
    const browser = await call("list_state");
    server.set("workspace:prioritization", new Map(rows.map((r) => [r.id, r])));
    server.set(BUY_A_FEATURE_KIND, new Map([[GAME.id, GAME]]));
    expect(await callServer("list_state")).toEqual(browser);
    expect(await callServer("record_purchase", { id: "a", amount: 20 })).toMatchObject({
      recorded: true,
      applied: 20,
    });
    const stored = server.get("workspace:prioritization")?.get("a") as PrioritizationItem;
    expect(featureLedger(stored).raised).toBe(20);
    const saved = await callServer("record_round", { totals: { a: 30, b: 10, c: 0 }, players: 3 });
    expect(saved).toMatchObject({ saved: true });
    expect(server.get(ALLOCATION_ROUND_KIND)?.size).toBe(1);
  });
});
