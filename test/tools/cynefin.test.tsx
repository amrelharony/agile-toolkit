import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CynefinItem } from "@/lib/stores/workspace-types";

/**
 * Cynefin Decision Picker: classifying a problem into a domain (with that
 * domain's recipe), the five domain buckets, reclassifying, removing, and the
 * CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: (string | number)[][] },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { csvData?: { headers: string[]; rows: (string | number)[][] } }) => {
    exported.csv = p.csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { CynefinClient } from "@/app/(tools)/cynefin/cynefin-client";

const RECIPES = {
  clear: "Sense → Categorise → Respond. Apply best practice.",
  complicated: "Sense → Analyse → Respond. Bring in experts.",
  complex: "Probe → Sense → Respond. Run safe-to-fail experiments.",
  chaotic: "Act → Sense → Respond. Stabilise first, then learn.",
  confused: "Break the problem into smaller domain-tagged pieces.",
};

const item = (id: string, title: string, domain: CynefinItem["domain"]): CynefinItem => ({
  id,
  title,
  domain,
  recommendedAction: RECIPES[domain],
  loggedAt: "2026-10-01T09:00:00.000Z",
});

const items = () => useWorkspaceStore.getState().cynefinItems ?? [];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const classify = () => fireEvent.click(screen.getByRole("button", { name: "Classify" }));

function choose(trigger: HTMLElement, label: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

/** A domain bucket's heading: the bold uppercase label. */
function bucketHeading(label: string): HTMLElement {
  const heading = screen
    .getAllByText(label)
    .find((el) => el.tagName === "SPAN" && el.classList.contains("uppercase"));
  if (!heading) throw new Error(`no bucket ${label}`);
  return heading;
}
const bucket = (label: string) => bucketHeading(label).parentElement!.parentElement!;
const bucketCount = (label: string) => bucketHeading(label).nextElementSibling?.textContent;
const bucketTitles = (label: string) =>
  within(bucket(label))
    .queryAllByRole("listitem")
    .map((li) => li.querySelector("span.truncate")?.textContent);

beforeEach(() => {
  exported.csv = undefined;
  useWorkspaceStore.setState({ cynefinItems: [] });
});

describe("Cynefin: empty state", () => {
  it("shows all five domains with their recipes and no items", () => {
    render(<CynefinClient />);
    expect(screen.getByText("Items (0)")).toBeInTheDocument();
    for (const label of ["Clear", "Complicated", "Complex", "Chaotic", "Confused"]) {
      expect(bucketCount(label)).toBe("0");
    }
    expect(within(bucket("Chaotic")).getByText(RECIPES.chaotic)).toBeInTheDocument();
    // The form defaults to Complex and shows its recipe.
    expect(screen.getByRole("combobox", { name: "Cynefin domain" })).toHaveTextContent("Complex");
    expect(screen.getAllByText(RECIPES.complex)).toHaveLength(2);
  });
});

describe("Cynefin: classifying", () => {
  it("adds the problem to the chosen domain with that domain's recipe", () => {
    render(<CynefinClient />);
    type("Problem or decision title", "  Outage in checkout  ");
    type("Rationale", "  Customers can't pay right now.  ");
    choose(screen.getByRole("combobox", { name: "Cynefin domain" }), "Chaotic");
    classify();

    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({
      title: "Outage in checkout",
      domain: "chaotic",
      rationale: "Customers can't pay right now.",
      recommendedAction: RECIPES.chaotic,
    });
    expect(Number.isNaN(Date.parse(items()[0].loggedAt))).toBe(false);
    expect(bucketTitles("Chaotic")).toEqual(["Outage in checkout"]);
    expect(bucketCount("Chaotic")).toBe("1");
    expect(screen.getByText("Items (1)")).toBeInTheDocument();
    // Title and rationale clear; the domain stays for the next problem.
    expect(screen.getByLabelText("Problem or decision title")).toHaveValue("");
    expect(screen.getByLabelText("Rationale")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Cynefin domain" })).toHaveTextContent("Chaotic");
  });

  it("shows the chosen domain's recipe next to the picker", () => {
    render(<CynefinClient />);
    choose(screen.getByRole("combobox", { name: "Cynefin domain" }), "Clear");
    // Once in the form, once in the Clear bucket.
    expect(screen.getAllByText(RECIPES.clear)).toHaveLength(2);
    expect(screen.getAllByText(RECIPES.complex)).toHaveLength(1);
  });

  it("stores a blank rationale as undefined", () => {
    render(<CynefinClient />);
    type("Problem or decision title", "Pick a database");
    type("Rationale", "   ");
    classify();
    expect(items()[0].rationale).toBeUndefined();
    expect(items()[0].domain).toBe("complex");
  });

  it("does nothing without a title", () => {
    render(<CynefinClient />);
    classify();
    type("Problem or decision title", "   ");
    type("Rationale", "Kept");
    classify();
    expect(items()).toEqual([]);
    expect(screen.getByLabelText("Rationale")).toHaveValue("Kept");
  });
});

describe("Cynefin: the buckets", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      cynefinItems: [
        item("a", "Rotate TLS certs", "clear"),
        item("b", "Tune the query planner", "complicated"),
        item("c", "New pricing page", "complex"),
        item("d", "Second complex", "complex"),
      ],
    });
  });

  it("groups items under their domain, with counts", () => {
    render(<CynefinClient />);
    expect(screen.getByText("Items (4)")).toBeInTheDocument();
    expect(bucketTitles("Clear")).toEqual(["Rotate TLS certs"]);
    expect(bucketTitles("Complicated")).toEqual(["Tune the query planner"]);
    expect(bucketTitles("Complex")).toEqual(["New pricing page", "Second complex"]);
    expect(bucketCount("Complex")).toBe("2");
    expect(bucketCount("Chaotic")).toBe("0");
  });

  it("reclassifying moves the item and swaps in the new domain's recipe", () => {
    render(<CynefinClient />);
    choose(
      screen.getByRole("combobox", { name: "Cynefin domain for New pricing page" }),
      "Complicated"
    );
    const moved = items().find((x) => x.id === "c")!;
    expect(moved.domain).toBe("complicated");
    expect(moved.recommendedAction).toBe(RECIPES.complicated);
    expect(bucketTitles("Complicated")).toEqual(["Tune the query planner", "New pricing page"]);
    expect(bucketTitles("Complex")).toEqual(["Second complex"]);
    // Nothing else changed.
    expect(items().map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("removes exactly the clicked item", () => {
    render(<CynefinClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove New pricing page" }));
    expect(items().map((x) => x.id)).toEqual(["a", "b", "d"]);
    expect(bucketTitles("Complex")).toEqual(["Second complex"]);
  });

  it("puts a legacy 'simple' (pre-2014) domain under Confused instead of crashing", () => {
    useWorkspaceStore.setState({
      cynefinItems: [
        { ...item("old", "Legacy item", "clear"), domain: "simple" as CynefinItem["domain"] },
      ],
    });
    render(<CynefinClient />);
    expect(bucketTitles("Confused")).toEqual(["Legacy item"]);
    expect(bucketCount("Confused")).toBe("1");
  });

  it("exports title, domain, rationale and recipe to CSV", () => {
    useWorkspaceStore.setState({
      cynefinItems: [
        { ...item("a", "Rotate TLS certs", "clear"), rationale: "Runbook exists" },
        { ...item("b", "No recipe", "chaotic"), recommendedAction: undefined },
      ],
    });
    render(<CynefinClient />);
    expect(exported.csv?.headers).toEqual(["Title", "Domain", "Rationale", "Recommended action"]);
    expect(exported.csv?.rows).toEqual([
      ["Rotate TLS certs", "clear", "Runbook exists", RECIPES.clear],
      ["No recipe", "chaotic", "", ""],
    ]);
  });
});
