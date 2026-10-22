import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Stakeholder Map: the add form (sliders, sentiment, trimming, reset), the
 * Interest × Authority quadrants and their boundaries, the KPIs, the matrix
 * dots and tooltip, editing a stakeholder in place, removal and the CSV.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as undefined | { headers: string[]; rows: unknown[][] },
}));
const logs = vi.hoisted(() => [] as { action: string; payload: Record<string, unknown> }[]);

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: { headers: string[]; rows: unknown[][] } }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));

beforeAll(() => {
  // Radix Slider measures itself; Radix Select calls these pointer APIs.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { StakeholderMapClient } from "@/app/(tools)/stakeholder-map/stakeholder-map-client";

const KEY = "agile-toolkit:stakeholder-map";

type Sentiment = "champion" | "supporter" | "neutral" | "skeptic" | "blocker";
interface Stakeholder {
  id: string;
  name: string;
  role?: string;
  interest: number;
  authority: number;
  sentiment: Sentiment;
  strategy?: string;
  description?: string;
}

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as Stakeholder[];
const seed = (list: Stakeholder[]) => localStorage.setItem(KEY, JSON.stringify(list));
const sh = (
  id: string,
  name: string,
  interest: number,
  authority: number,
  extra: Partial<Stakeholder> = {}
): Stakeholder => ({ id, name, interest, authority, sentiment: "neutral", ...extra });

/** The compact KPI tile's value for `label` (the label also names a quadrant). */
const kpi = (label: string) => {
  const span = screen.getAllByText(label).find((el) => el.classList.contains("truncate"))!;
  return span.parentElement!.nextElementSibling!.textContent;
};
/** The strategy card for a quadrant (the matrix cell of the same name has no count). */
const quadrantCard = (label: string) =>
  screen
    .getAllByText(label)
    .map((el) => el.parentElement!)
    .find((card) => /\d+ stakeholders?/.test(card.textContent ?? ""))!;

function choose(trigger: HTMLElement, option: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

beforeEach(() => {
  localStorage.clear();
  logs.length = 0;
  exported.csv = undefined;
});

describe("Stakeholder Map: empty", () => {
  it("shows the empty state and zero KPIs, with no matrix", () => {
    render(<StakeholderMapClient />);
    expect(screen.getByText(/No stakeholders mapped yet/)).toBeInTheDocument();
    expect(kpi("Total")).toBe("0");
    expect(kpi("Manage Closely")).toBe("0");
    expect(kpi("Blockers")).toBe("0");
    expect(kpi("Champions")).toBe("0");
    expect(screen.queryByText("Interest × Authority")).toBeNull();
  });
});

describe("Stakeholder Map: adding", () => {
  it("adds a trimmed stakeholder with the default 5/5 neutral, then resets the form", () => {
    render(<StakeholderMapClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Priya  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "Role" }), {
      target: { value: " CFO " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Engagement strategy" }), {
      target: { value: " Monthly 1:1 " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: " Owns the budget " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add stakeholder" }));

    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({
      name: "Priya",
      role: "CFO",
      interest: 5,
      authority: 5,
      sentiment: "neutral",
      strategy: "Monthly 1:1",
      description: "Owns the budget",
    });
    expect(logs[0]).toMatchObject({
      action: "stakeholder_added",
      payload: { name: "Priya", sentiment: "neutral" },
    });
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Role" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Engagement strategy" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
    expect(kpi("Total")).toBe("1");
    expect(kpi("Manage Closely")).toBe("1");
  });

  it("stores no role, strategy or description when they are blank", () => {
    render(<StakeholderMapClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ola" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Role" }), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add stakeholder" }));
    expect(stored()[0].role).toBeUndefined();
    expect(stored()[0].strategy).toBeUndefined();
    expect(stored()[0].description).toBeUndefined();
  });

  it("ignores a blank name", () => {
    render(<StakeholderMapClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add stakeholder" }));
    expect(stored()).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("takes interest, authority and sentiment from the form, and resets them after", () => {
    render(<StakeholderMapClient />);
    const interest = screen.getByRole("slider", { name: "Interest level" });
    const authority = screen.getByRole("slider", { name: "Authority level" });
    fireEvent.keyDown(interest, { key: "ArrowRight" });
    fireEvent.keyDown(interest, { key: "ArrowRight" });
    fireEvent.keyDown(authority, { key: "Home" });
    expect(interest).toHaveAttribute("aria-valuetext", "7 of 10");
    expect(authority).toHaveAttribute("aria-valuetext", "0 of 10");
    choose(screen.getByRole("combobox", { name: "Sentiment" }), "Blocker");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add stakeholder" }));

    expect(stored()[0]).toMatchObject({ interest: 7, authority: 0, sentiment: "blocker" });
    expect(kpi("Blockers")).toBe("1");
    expect(within(quadrantCard("Keep Informed")).getByText("Bo")).toBeInTheDocument();
    // The form is back to 5 / 5 / Neutral.
    expect(screen.getByRole("slider", { name: "Interest level" })).toHaveAttribute(
      "aria-valuenow",
      "5"
    );
    expect(screen.getByRole("slider", { name: "Authority level" })).toHaveAttribute(
      "aria-valuenow",
      "5"
    );
    expect(screen.getByRole("combobox", { name: "Sentiment" })).toHaveTextContent("Neutral");
  });

  it("puts the newest stakeholder first", () => {
    seed([sh("a", "Ann", 5, 5)]);
    render(<StakeholderMapClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ben" } });
    fireEvent.click(screen.getByRole("button", { name: "Add stakeholder" }));
    expect(stored().map((s) => s.name)).toEqual(["Ben", "Ann"]);
  });
});

describe("Stakeholder Map: quadrants and KPIs", () => {
  beforeEach(() =>
    seed([
      sh("a", "Ann", 5, 5, { sentiment: "champion" }), // both exactly 5 → high
      sh("b", "Ben", 4, 5, { sentiment: "blocker" }),
      sh("c", "Cat", 5, 4, { sentiment: "champion" }),
      sh("d", "Dan", 4, 4),
      sh("e", "Eve", 0, 0, { sentiment: "blocker" }),
      sh("f", "Fay", 10, 10, { sentiment: "skeptic" }),
    ])
  );

  it("treats 5 as high on both axes", () => {
    render(<StakeholderMapClient />);
    expect(quadrantCard("Manage Closely")).toHaveTextContent("2 stakeholders");
    expect(quadrantCard("Manage Closely")).toHaveTextContent("Ann, Fay");
    expect(quadrantCard("Keep Satisfied")).toHaveTextContent("1 stakeholder");
    expect(quadrantCard("Keep Satisfied")).toHaveTextContent("Ben");
    expect(quadrantCard("Keep Informed")).toHaveTextContent("Cat");
    expect(quadrantCard("Monitor")).toHaveTextContent("2 stakeholders");
    expect(quadrantCard("Monitor")).toHaveTextContent("Dan, Eve");
  });

  it("counts the total, manage-closely, blockers and champions", () => {
    render(<StakeholderMapClient />);
    expect(kpi("Total")).toBe("6");
    expect(kpi("Manage Closely")).toBe("2");
    expect(kpi("Blockers")).toBe("2");
    expect(kpi("Champions")).toBe("2");
  });

  it("exports each stakeholder with its quadrant", () => {
    render(<StakeholderMapClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Role",
      "Interest",
      "Authority",
      "Sentiment",
      "Quadrant",
      "Strategy",
      "Description",
    ]);
    expect(exported.csv?.rows.map((r) => [r[0], r[5]])).toEqual([
      ["Ann", "Manage Closely"],
      ["Ben", "Keep Satisfied"],
      ["Cat", "Keep Informed"],
      ["Dan", "Monitor"],
      ["Eve", "Monitor"],
      ["Fay", "Manage Closely"],
    ]);
  });
});

describe("Stakeholder Map: matrix", () => {
  it("places each dot by interest (x) and authority (y), kept off the edges", () => {
    seed([
      sh("a", "Ann", 5, 5, { role: "CTO" }),
      sh("e", "Eve", 0, 0),
      sh("f", "Fay", 10, 10),
      sh("g", "Gus", 2, 8),
    ]);
    render(<StakeholderMapClient />);
    const dot = (name: string) => screen.getByRole("button", { name });
    expect(dot("Ann, CTO").style.left).toBe("50%");
    expect(dot("Ann, CTO").style.top).toBe("50%");
    expect(dot("Eve").style.left).toBe("4%");
    expect(dot("Eve").style.top).toBe("96%");
    expect(dot("Fay").style.left).toBe("96%");
    expect(dot("Fay").style.top).toBe("4%");
    expect(dot("Gus").style.left).toBe("20%");
    expect(parseFloat(dot("Gus").style.top)).toBeCloseTo(20, 5);
  });

  it("shows a tooltip on hover or focus and hides it on leave, blur or Escape", () => {
    seed([sh("a", "Ann", 7, 3, { role: "CTO", sentiment: "supporter" })]);
    render(<StakeholderMapClient />);
    const dot = screen.getByRole("button", { name: "Ann, CTO" });
    fireEvent.mouseEnter(dot);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Ann");
    expect(tip).toHaveTextContent("CTO");
    expect(tip).toHaveTextContent("Int 7 · Auth 3 · Supporter");
    fireEvent.mouseLeave(dot);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(dot);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(dot);
    fireEvent.blur(dot);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("drops the tooltip when its stakeholder is removed", () => {
    seed([sh("a", "Ann", 7, 3), sh("b", "Ben", 2, 2)]);
    render(<StakeholderMapClient />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Ann" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Ann" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(stored().map((s) => s.id)).toEqual(["b"]);
    expect(logs.at(-1)).toMatchObject({ action: "stakeholder_removed", payload: { name: "Ann" } });
  });
});

describe("Stakeholder Map: editing in place", () => {
  beforeEach(() =>
    seed([sh("a", "Ann", 7, 7, { role: "CTO", strategy: "Weekly sync", description: "Sponsor" })])
  );

  it("renames on blur, with one logged update", () => {
    render(<StakeholderMapClient />);
    const name = screen.getAllByRole("textbox", { name: "Stakeholder name" })[1];
    expect(name).toHaveValue("Ann");
    fireEvent.change(name, { target: { value: "Annie" } });
    expect(stored()[0].name).toBe("Ann");
    fireEvent.blur(name);
    expect(stored()[0].name).toBe("Annie");
    expect(logs.filter((l) => l.action === "stakeholder_updated")).toHaveLength(1);
    expect(logs.at(-1)?.payload).toMatchObject({ stakeholderId: "a", fields: ["name"] });
  });

  it("clears the role when it is blanked", () => {
    render(<StakeholderMapClient />);
    const role = screen.getByRole("textbox", { name: "Role for Ann" });
    fireEvent.change(role, { target: { value: "   " } });
    fireEvent.blur(role);
    expect(stored()[0].role).toBeUndefined();
    expect(screen.getByRole("button", { name: "Ann" })).toBeInTheDocument();
  });

  it("saves the strategy and description trimmed, and clears them when blank", () => {
    render(<StakeholderMapClient />);
    const strategy = screen.getByRole("textbox", { name: "Engagement strategy for Ann" });
    fireEvent.change(strategy, { target: { value: "  Fortnightly demo " } });
    fireEvent.blur(strategy);
    expect(stored()[0].strategy).toBe("Fortnightly demo");

    const description = screen.getByRole("textbox", { name: "Description for Ann" });
    fireEvent.change(description, { target: { value: "  Exec sponsor  " } });
    fireEvent.blur(description);
    expect(stored()[0].description).toBe("Exec sponsor");
    expect(description).toHaveValue("Exec sponsor");

    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.blur(description);
    expect(stored()[0].description).toBeUndefined();
    expect(description).toHaveValue("");
  });

  it("changes the sentiment from the row's dropdown", () => {
    render(<StakeholderMapClient />);
    choose(screen.getByRole("combobox", { name: "Sentiment for Ann" }), "Champion");
    expect(stored()[0].sentiment).toBe("champion");
    expect(kpi("Champions")).toBe("1");
  });

  it("moves a stakeholder across quadrants with the row sliders", () => {
    render(<StakeholderMapClient />);
    const interest = screen.getByRole("slider", { name: "Interest for Ann" });
    fireEvent.keyDown(interest, { key: "Home" });
    expect(stored()[0].interest).toBe(0);
    expect(interest).toHaveAttribute("aria-valuetext", "0 of 10");
    expect(within(quadrantCard("Keep Satisfied")).getByText("Ann")).toBeInTheDocument();

    const authority = screen.getByRole("slider", { name: "Authority for Ann" });
    fireEvent.keyDown(authority, { key: "ArrowLeft" });
    fireEvent.keyDown(authority, { key: "ArrowLeft" });
    expect(stored()[0].authority).toBe(5);
    fireEvent.keyDown(authority, { key: "ArrowLeft" });
    expect(stored()[0].authority).toBe(4);
    expect(within(quadrantCard("Monitor")).getByText("Ann")).toBeInTheDocument();
  });
});
