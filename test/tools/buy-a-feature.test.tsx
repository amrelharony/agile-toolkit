import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem } from "@/lib/stores/workspace-types";

/**
 * Buy-a-Feature: add a priced feature, buy into it, the marketplace order
 * and funding bars, the total, delete, and the CSV export.
 */

interface Exported {
  csvData?: { headers: string[]; rows: unknown[][] };
  jsonData?: unknown;
}
const h = vi.hoisted(() => ({ log: vi.fn(), exported: {} as Exported }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: Exported) => {
    h.exported.csvData = props.csvData;
    h.exported.jsonData = props.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));

import { BuyAFeatureClient } from "@/app/(tools)/buy-a-feature/buy-a-feature-client";

const feat = (id: string, title: string, price: number, raised = 0): PrioritizationItem => ({
  id,
  framework: "buy-feature",
  title,
  score: raised,
  fields: { price, raised },
  status: "open",
  updatedAt: "2026-10-01T09:00:00.000Z",
});

const other: PrioritizationItem = {
  id: "ice1",
  framework: "ice",
  title: "ICE row",
  score: 100,
  fields: { raised: 999 },
  updatedAt: "2026-10-01T09:00:00.000Z",
};

const all = () => useWorkspaceStore.getState().prioritizations ?? [];
const features = () => all().filter((p) => p.framework === "buy-feature");
const byId = (id: string) => all().find((p) => p.id === id)!;

const totalRaised = () => screen.getByText("Total raised").nextElementSibling!.textContent;
const row = (title: string) =>
  screen.getByText(title, { selector: "span.truncate" }).closest("li")! as HTMLElement;
const marketTitles = () =>
  Array.from(document.querySelectorAll("li span.truncate")).map((s) => s.textContent);

function buy(title: string, amount?: string) {
  const r = row(title);
  if (amount !== undefined) {
    fireEvent.change(within(r).getByLabelText("Purchase amount"), { target: { value: amount } });
  }
  fireEvent.click(within(r).getByRole("button", { name: "Buy" }));
}

function addFeature(title: string, price: string) {
  fireEvent.change(screen.getByLabelText("Feature title"), { target: { value: title } });
  fireEvent.change(screen.getByLabelText("Feature price"), { target: { value: price } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

beforeEach(() => {
  h.log.mockClear();
  h.exported.csvData = undefined;
  h.exported.jsonData = undefined;
  useWorkspaceStore.setState({ prioritizations: [] });
});

describe("Buy-a-Feature — empty state", () => {
  it("shows $0 raised and no marketplace", () => {
    render(<BuyAFeatureClient />);
    expect(totalRaised()).toBe("$0");
    expect(screen.queryByText("Marketplace")).not.toBeInTheDocument();
  });

  it("ignores Add with a blank title", () => {
    render(<BuyAFeatureClient />);
    addFeature("   ", "50");
    expect(all()).toEqual([]);
    expect(h.log).not.toHaveBeenCalled();
  });
});

describe("Buy-a-Feature — adding", () => {
  it("adds a trimmed, priced, unfunded feature and clears the form", () => {
    render(<BuyAFeatureClient />);
    addFeature("  Dark mode  ", "120");
    const [f] = features();
    expect(f).toMatchObject({
      framework: "buy-feature",
      title: "Dark mode",
      score: 0,
      fields: { price: 120, raised: 0 },
      status: "open",
    });
    expect(screen.getByLabelText("Feature title")).toHaveValue("");
    expect(screen.getByLabelText("Feature price")).toHaveValue(null);
    expect(h.log).toHaveBeenCalledWith("feature_added", { title: "Dark mode", price: 120 });
    expect(within(row("Dark mode")).getByText("$0/$120 (0%)")).toBeInTheDocument();
  });

  it("sanitises the price: negative or blank → 0, huge → 1,000,000,000", () => {
    render(<BuyAFeatureClient />);
    addFeature("Negative", "-50");
    addFeature("Blank", "");
    addFeature("Huge", "5e12");
    const price = (title: string) => features().find((f) => f.title === title)!.fields!.price;
    expect(price("Negative")).toBe(0);
    expect(price("Blank")).toBe(0);
    expect(price("Huge")).toBe(1_000_000_000);
  });

  it("caps the title at 200 characters", () => {
    render(<BuyAFeatureClient />);
    addFeature("t".repeat(250), "10");
    expect(features()[0].title).toHaveLength(200);
  });
});

describe("Buy-a-Feature — marketplace", () => {
  it("lists only buy-feature rows, most funded first, without reordering the store", () => {
    useWorkspaceStore.setState({
      prioritizations: [feat("a", "Alpha", 100, 10), other, feat("b", "Beta", 100, 60)],
    });
    render(<BuyAFeatureClient />);
    expect(marketTitles()).toEqual(["Beta", "Alpha"]);
    expect(totalRaised()).toBe("$70");
    expect(all().map((p) => p.id)).toEqual(["a", "ice1", "b"]);
  });

  it("records a purchase of the default 10 and updates the bar, total and order", () => {
    useWorkspaceStore.setState({
      prioritizations: [feat("a", "Alpha", 40, 0), feat("b", "Beta", 100, 5)],
    });
    render(<BuyAFeatureClient />);
    expect(marketTitles()).toEqual(["Beta", "Alpha"]);
    buy("Alpha");
    expect(byId("a")).toMatchObject({ score: 10, fields: { price: 40, raised: 10 } });
    expect(within(row("Alpha")).getByText("$10/$40 (25%)")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Alpha funding progress" })).toHaveAttribute(
      "aria-valuenow",
      "25"
    );
    expect(totalRaised()).toBe("$15");
    expect(marketTitles()).toEqual(["Alpha", "Beta"]);
    expect(h.log).toHaveBeenCalledWith("purchase_recorded", { id: "a", amount: 10 });
  });

  it("caps the funding bar at 100% when over-funded", () => {
    useWorkspaceStore.setState({ prioritizations: [feat("a", "Alpha", 40, 10)] });
    render(<BuyAFeatureClient />);
    buy("Alpha", "35");
    expect(byId("a").fields?.raised).toBe(45);
    expect(within(row("Alpha")).getByText("$45/$40 (100%)")).toBeInTheDocument();
    expect(h.exported.csvData?.rows).toEqual([["Alpha", 40, 45, "113%"]]);
  });

  it("ignores zero, negative, blank and non-numeric purchase amounts", () => {
    useWorkspaceStore.setState({ prioritizations: [feat("a", "Alpha", 40, 10)] });
    render(<BuyAFeatureClient />);
    for (const amount of ["0", "-5", "", "abc"]) buy("Alpha", amount);
    expect(byId("a").fields?.raised).toBe(10);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("caps a single purchase at 1,000,000", () => {
    useWorkspaceStore.setState({ prioritizations: [feat("a", "Alpha", 40, 0)] });
    render(<BuyAFeatureClient />);
    buy("Alpha", "5000000");
    expect(byId("a").fields?.raised).toBe(1_000_000);
    expect(byId("a").score).toBe(1_000_000);
  });

  // Bug: fractional buys accumulated float noise, e.g. "$0.30000000000000004/$1".
  it("keeps fractional purchases to whole cents", () => {
    useWorkspaceStore.setState({ prioritizations: [feat("a", "Alpha", 1, 0)] });
    render(<BuyAFeatureClient />);
    buy("Alpha", "0.1");
    buy("Alpha", "0.2");
    expect(byId("a").fields?.raised).toBe(0.3);
    expect(byId("a").score).toBe(0.3);
    expect(within(row("Alpha")).getByText("$0.3/$1 (30%)")).toBeInTheDocument();
  });

  it("shows 0% for a free feature and a dash in the CSV", () => {
    useWorkspaceStore.setState({ prioritizations: [feat("a", "Free", 0, 0)] });
    render(<BuyAFeatureClient />);
    buy("Free");
    expect(within(row("Free")).getByText("$10/$0 (0%)")).toBeInTheDocument();
    expect(h.exported.csvData?.rows).toEqual([["Free", 0, 10, "—"]]);
  });

  it("removes exactly the clicked feature and leaves other frameworks alone", () => {
    useWorkspaceStore.setState({
      prioritizations: [feat("a", "Alpha", 100, 10), other, feat("b", "Beta", 100, 60)],
    });
    render(<BuyAFeatureClient />);
    fireEvent.click(within(row("Alpha")).getByRole("button", { name: "Remove feature" }));
    expect(all().map((p) => p.id)).toEqual(["ice1", "b"]);
    expect(h.log).toHaveBeenCalledWith("feature_removed", { id: "a" });
    expect(totalRaised()).toBe("$60");
  });

  it("hides the marketplace again once the last feature is removed", () => {
    useWorkspaceStore.setState({ prioritizations: [feat("a", "Alpha", 100, 10)] });
    render(<BuyAFeatureClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove feature" }));
    expect(screen.queryByText("Marketplace")).not.toBeInTheDocument();
    expect(totalRaised()).toBe("$0");
  });
});

describe("Buy-a-Feature — export", () => {
  it("exports each buy-feature row with its funding percentage", () => {
    useWorkspaceStore.setState({
      prioritizations: [feat("a", "Alpha", 200, 50), other, feat("b", "Beta", 30, 10)],
    });
    render(<BuyAFeatureClient />);
    expect(h.exported.csvData?.headers).toEqual(["Title", "Price", "Raised", "% funded"]);
    expect(h.exported.csvData?.rows).toEqual([
      ["Alpha", 200, 50, "25%"],
      ["Beta", 30, 10, "33%"],
    ]);
    expect(h.exported.jsonData).toEqual(features());
  });
});
