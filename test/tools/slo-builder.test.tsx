import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SloBurn, SloDefinition } from "@/lib/stores/workspace-types";

/**
 * SLO builder core: adding / removing SLOs, logging burns, the rolling
 * error-budget window, the snapshot's derived numbers, the alert banner,
 * the burn-trend analytics, the CSV export rows and the smart-default chip.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
  json: undefined as unknown,
}));
const smart = vi.hoisted(() => ({ budget: 43.2 }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    csvData,
    jsonData,
  }: {
    csvData?: { headers: string[]; rows: (string | number)[][] };
    jsonData?: unknown;
  }) => {
    exported.csv = csvData;
    exported.json = jsonData;
    return null;
  },
}));
vi.mock("@/components/shared/smart-input", () => ({
  SmartInput: ({ onAccept }: { onAccept: (v: number) => void }) => (
    <button type="button" onClick={() => onAccept(smart.budget)}>
      Accept suggested budget
    </button>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { SloBuilderClient } from "@/app/(tools)/slo-builder/slo-builder-client";

const SB_ID = "sloBuilder:current";
// Sunday 18 Oct 2026, 10:00 local.
const NOW = new Date(2026, 9, 18, 10, 0, 0);

const slo = (
  id: string,
  name: string,
  target = 0.999,
  windowDays = 30,
  extra: Partial<SloDefinition> = {}
): SloDefinition => ({ id, name, sliDescription: "2xx on /api", target, windowDays, ...extra });

const burn = (id: string, sloId: string, date: string, errorMinutes: number): SloBurn => ({
  id,
  sloId,
  date,
  errorMinutes,
});

function seed(slos: SloDefinition[], burns: SloBurn[] = []) {
  useWorkspaceStore.setState({ sloBuilders: [{ id: SB_ID, slos, burns }] });
}

const doc = () => (useWorkspaceStore.getState().sloBuilders ?? []).find((d) => d.id === SB_ID);

/** NumericField commits on blur, like a real user tabbing out. */
function typeNumber(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

/** The snapshot card for one SLO (found through its Remove button). */
const card = (name: string, index = 0) =>
  screen
    .getAllByRole("button", { name: `Remove ${name}` })
    [index].closest(".rounded-lg") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  exported.csv = undefined;
  exported.json = undefined;
  smart.budget = 43.2;
  useWorkspaceStore.setState({ sloBuilders: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SLO builder — empty state", () => {
  it("asks for an SLO before burns can be logged and shows no snapshot", () => {
    render(<SloBuilderClient />);
    expect(
      screen.getByText("Define an SLO first to start logging burn events.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Log burn/ })).toBeNull();
    expect(screen.queryByText("SLO snapshot")).toBeNull();
    expect(screen.queryByText(/Error budget alert/)).toBeNull();
    expect(exported.csv?.rows).toEqual([]);
  });

  it("starts the draft at 99.9 % over 30 days", () => {
    render(<SloBuilderClient />);
    expect(screen.getByLabelText("Target (%)")).toHaveValue("99.9");
    expect(screen.getByLabelText("Window (days)")).toHaveValue("30");
  });
});

describe("SLO builder — adding an SLO", () => {
  it("stores a trimmed SLO with target / 100 and a whole-day window, then resets the form", () => {
    render(<SloBuilderClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  checkout  " } });
    fireEvent.change(screen.getByLabelText("SLI description"), {
      target: { value: " 2xx on /checkout " },
    });
    typeNumber("Target (%)", "99.5");
    typeNumber("Window (days)", "7.9");
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "  Owned by payments  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));

    const slos = doc()?.slos ?? [];
    expect(slos).toHaveLength(1);
    expect(slos[0]).toMatchObject({
      name: "checkout",
      sliDescription: "2xx on /checkout",
      windowDays: 7,
      description: "Owned by payments",
    });
    expect(slos[0].target).toBeCloseTo(0.995, 10);

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("SLI description")).toHaveValue("");
    expect(screen.getByLabelText("Target (%)")).toHaveValue("99.9");
    expect(screen.getByLabelText("Window (days)")).toHaveValue("30");
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("");
  });

  it("leaves a blank description undefined", () => {
    render(<SloBuilderClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.change(screen.getByLabelText("SLI description"), { target: { value: "2xx" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));
    expect(doc()?.slos[0].description).toBeUndefined();
  });

  it.each([
    ["above 100", "100.5"],
    ["negative", "-1"],
    ["not a number", "abc"],
  ])("rejects a target that is %s", (_label, value) => {
    render(<SloBuilderClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.change(screen.getByLabelText("SLI description"), { target: { value: "2xx" } });
    typeNumber("Target (%)", value);
    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Target must be a percentage from 0 to 100, e.g. 99.9."
    );
    expect(doc()?.slos ?? []).toHaveLength(0);
  });

  it("accepts the 0 % and 100 % edges", () => {
    render(<SloBuilderClient />);
    for (const [name, pct] of [
      ["zero", "0"],
      ["full", "100"],
    ]) {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
      fireEvent.change(screen.getByLabelText("SLI description"), { target: { value: "2xx" } });
      typeNumber("Target (%)", pct);
      fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));
    }
    expect(doc()?.slos.map((s) => s.target)).toEqual([0, 1]);
  });

  it("rejects a non-numeric window", () => {
    render(<SloBuilderClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.change(screen.getByLabelText("SLI description"), { target: { value: "2xx" } });
    typeNumber("Window (days)", "a week");
    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Window must be at least 1 day.");
    expect(screen.getByRole("button", { name: /Add SLO/ })).toHaveAttribute(
      "aria-describedby",
      "slo-errors"
    );
  });

  it("commits a numeric field on Enter", () => {
    render(<SloBuilderClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.change(screen.getByLabelText("SLI description"), { target: { value: "2xx" } });
    const target = screen.getByLabelText("Target (%)");
    fireEvent.focus(target);
    fireEvent.change(target, { target: { value: "99" } });
    fireEvent.keyDown(target, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: /Add SLO/ }));
    expect(doc()?.slos[0].target).toBeCloseTo(0.99, 10);
  });
});

describe("SLO builder — suggested budget chip", () => {
  it("derives the target from the suggested budget over a 30-day default window", () => {
    render(<SloBuilderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Accept suggested budget" }));
    // 43.2 min of 43 200 = 0.1 % → 99.9 %
    expect(screen.getByLabelText("Target (%)")).toHaveValue("99.9");
    expect(screen.getByLabelText("Window (days)")).toHaveValue("30");
  });

  it("keeps the user's typed window and back-derives the target against it", () => {
    smart.budget = 100.8;
    render(<SloBuilderClient />);
    typeNumber("Window (days)", "7");
    fireEvent.click(screen.getByRole("button", { name: "Accept suggested budget" }));
    // 100.8 min of 7 × 1440 = 10 080 → 1 % → 99 %
    expect(screen.getByLabelText("Window (days)")).toHaveValue("7");
    expect(screen.getByLabelText("Target (%)")).toHaveValue("99");
  });

  it("falls back to 30 days when the typed window is blank", () => {
    render(<SloBuilderClient />);
    typeNumber("Window (days)", "");
    fireEvent.click(screen.getByRole("button", { name: "Accept suggested budget" }));
    expect(screen.getByLabelText("Window (days)")).toHaveValue("30");
    expect(screen.getByLabelText("Target (%)")).toHaveValue("99.9");
  });
});

describe("SLO builder — logging burns", () => {
  it("logs a burn against the first SLO, dated today (local), and clears the minutes", () => {
    seed([slo("s1", "api"), slo("s2", "web")]);
    render(<SloBuilderClient />);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-18");

    typeNumber("Error minutes", "4.5");
    fireEvent.click(screen.getByRole("button", { name: /Log burn/ }));

    expect(doc()?.burns).toHaveLength(1);
    expect(doc()?.burns[0]).toMatchObject({ sloId: "s1", date: "2026-10-18", errorMinutes: 4.5 });
    expect(screen.getByLabelText("Error minutes")).toHaveValue("");
  });

  it("logs against the SLO picked in the dropdown and the date typed", () => {
    seed([slo("s1", "api"), slo("s2", "web")]);
    render(<SloBuilderClient />);

    const trigger = screen.getByRole("combobox", { name: "SLO" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "web" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-15" } });
    typeNumber("Error minutes", "0");
    fireEvent.click(screen.getByRole("button", { name: /Log burn/ }));

    expect(doc()?.burns[0]).toMatchObject({ sloId: "s2", date: "2026-10-15", errorMinutes: 0 });
  });

  it("refuses a burn with no date", () => {
    seed([slo("s1", "api")]);
    render(<SloBuilderClient />);
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "" } });
    typeNumber("Error minutes", "2");
    fireEvent.click(screen.getByRole("button", { name: /Log burn/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a date.");
    expect(doc()?.burns).toHaveLength(0);
  });

  it("re-points the burn draft at a remaining SLO when the selected one is removed", () => {
    seed([slo("s1", "api"), slo("s2", "web")]);
    render(<SloBuilderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove api" }));
    typeNumber("Error minutes", "1");
    fireEvent.click(screen.getByRole("button", { name: /Log burn/ }));
    expect(doc()?.burns).toEqual([expect.objectContaining({ sloId: "s2" })]);
  });
});

describe("SLO builder — removing an SLO", () => {
  it("drops the SLO and cascades its burns, leaving the others untouched", () => {
    seed(
      [slo("s1", "api"), slo("s2", "web")],
      [burn("b1", "s1", "2026-10-17", 3), burn("b2", "s2", "2026-10-17", 4)]
    );
    render(<SloBuilderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove api" }));
    expect(doc()?.slos.map((s) => s.id)).toEqual(["s2"]);
    expect(doc()?.burns.map((b) => b.id)).toEqual(["b2"]);
  });

  it("removes the right one of two SLOs that share a name", () => {
    seed([slo("s1", "api"), slo("s2", "api", 0.99)]);
    render(<SloBuilderClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove api" })[1]);
    expect(doc()?.slos.map((s) => s.id)).toEqual(["s1"]);
  });

  it("goes back to the empty state after the last SLO is removed", () => {
    seed([slo("s1", "api")]);
    render(<SloBuilderClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove api" }));
    expect(
      screen.getByText("Define an SLO first to start logging burn events.")
    ).toBeInTheDocument();
    expect(screen.queryByText("SLO snapshot")).toBeNull();
  });
});

describe("SLO builder — snapshot numbers", () => {
  it("shows target, window, 43.2-minute budget and a healthy remainder", () => {
    seed([slo("s1", "api")], [burn("b1", "s1", "2026-10-18", 10.8)]);
    render(<SloBuilderClient />);
    const c = card("api");
    expect(c).toHaveTextContent("SLI: 2xx on /api");
    expect(c).toHaveTextContent("99.90%");
    expect(c).toHaveTextContent("30-day window");
    expect(c).toHaveTextContent("43.2 min");
    expect(c).toHaveTextContent("10.8 consumed");
    expect(c).toHaveTextContent("75.0%");
    expect(c).toHaveTextContent("Healthy");
    expect(screen.queryByText(/Error budget alert/)).toBeNull();
  });

  it("flags an SLO under half its budget as at risk, in the alert banner too", () => {
    seed([slo("s1", "api")], [burn("b1", "s1", "2026-10-18", 30.24)]);
    render(<SloBuilderClient />);
    expect(card("api")).toHaveTextContent("30.0%");
    expect(card("api")).toHaveTextContent("At risk");
    expect(screen.getByText(/Error budget alert/).closest('[role="alert"]')).toHaveTextContent(
      "api (30% remaining)"
    );
  });

  it("calls an over-spent budget BURNED and floors the remainder at 0 %", () => {
    seed(
      [slo("s1", "api"), slo("s2", "web")],
      [burn("b1", "s1", "2026-10-18", 50), burn("b2", "s2", "2026-10-18", 40)]
    );
    render(<SloBuilderClient />);
    expect(card("api")).toHaveTextContent("0.0%");
    expect(card("api")).toHaveTextContent("Budget burned");
    expect(card("web")).toHaveTextContent("At risk");
    const banner = screen.getByText(/Error budget alert/).closest('[role="alert"]');
    expect(banner).toHaveTextContent("api (BURNED), web (7% remaining)");
  });

  it("puts the description under the SLI when there is one", () => {
    seed([slo("s1", "api", 0.999, 30, { description: "Paged by payments" })]);
    render(<SloBuilderClient />);
    expect(card("api")).toHaveTextContent("Paged by payments");
  });

  // Bug: a 100 % SLO has a zero budget, so any logged error minute breaks it —
  // but the snapshot showed "Healthy" (burned required budget > 0).
  it("calls a 100 % SLO with logged errors burned, not healthy", () => {
    seed([slo("s1", "strict", 1)], [burn("b1", "s1", "2026-10-18", 5)]);
    render(<SloBuilderClient />);
    expect(card("strict")).toHaveTextContent("0.0 min");
    expect(card("strict")).toHaveTextContent("Budget burned");
    expect(screen.getByText(/Error budget alert/).closest('[role="alert"]')).toHaveTextContent(
      "strict (BURNED)"
    );
  });

  it("calls a 100 % SLO with no errors healthy with its whole (zero) budget left", () => {
    seed([slo("s1", "strict", 1)]);
    render(<SloBuilderClient />);
    expect(card("strict")).toHaveTextContent("100.0%");
    expect(card("strict")).toHaveTextContent("Healthy");
    expect(screen.queryByText(/Error budget alert/)).toBeNull();
  });

  it("gives a stored SLO with a broken target or window a zero budget, not NaN", () => {
    seed(
      [slo("s1", "bad-target", Number.NaN), slo("s2", "bad-window", 0.999, -5)],
      [burn("b1", "s1", "2026-10-18", 1)]
    );
    render(<SloBuilderClient />);
    expect(card("bad-target")).toHaveTextContent(/Budget\s*0\.0 min/);
    expect(card("bad-target")).toHaveTextContent(/Remaining\s*0\.0%/);
    expect(card("bad-window")).toHaveTextContent(/Budget\s*0\.0 min/);
    expect(card("bad-window")).toHaveTextContent(/Remaining\s*100\.0%/);
  });
});

describe("SLO builder — rolling window", () => {
  it("counts exactly windowDays calendar days ending today", () => {
    // 7-day window on 18 Oct = 12..18 Oct inclusive.
    seed(
      [slo("s1", "api", 0.99, 7)],
      [
        burn("in-first", "s1", "2026-10-12", 1),
        burn("in-today", "s1", "2026-10-18", 2),
        burn("out-before", "s1", "2026-10-11", 100),
      ]
    );
    render(<SloBuilderClient />);
    // 7 × 1440 × 1 % = 100.8 min
    expect(card("api")).toHaveTextContent("100.8 min");
    expect(card("api")).toHaveTextContent("3.0 consumed");
  });

  it("tolerates a burn dated tomorrow but ignores anything further ahead", () => {
    seed(
      [slo("s1", "api")],
      [burn("tomorrow", "s1", "2026-10-19", 1), burn("later", "s1", "2026-10-20", 40)]
    );
    render(<SloBuilderClient />);
    expect(card("api")).toHaveTextContent("1.0 consumed");
  });

  it("treats a one-day window as today only", () => {
    seed(
      [slo("s1", "api", 0.99, 1)],
      [burn("y", "s1", "2026-10-17", 5), burn("t", "s1", "2026-10-18", 2)]
    );
    render(<SloBuilderClient />);
    expect(card("api")).toHaveTextContent("2.0 consumed");
  });

  it("ignores burns with an unparsable date and burns of other SLOs", () => {
    seed(
      [slo("s1", "api"), slo("s2", "web")],
      [
        burn("junk", "s1", "not-a-date", 9),
        burn("mine", "s1", "2026-10-18", 1),
        burn("theirs", "s2", "2026-10-18", 7),
      ]
    );
    render(<SloBuilderClient />);
    expect(card("api")).toHaveTextContent("1.0 consumed");
    expect(card("web")).toHaveTextContent("7.0 consumed");
  });
});

describe("SLO builder — burn analytics", () => {
  // Ten daily burns 9..18 Oct (Mann-Kendall needs n ≥ 10 to call a trend).
  const series = (minutes: number[]) =>
    minutes.map((m, i) => burn(`b${i}`, "s1", `2026-10-${String(9 + i).padStart(2, "0")}`, m));
  const rising = series([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);

  it("needs four burns before it shows the trend chip", () => {
    seed([slo("s1", "api")], rising.slice(0, 3));
    render(<SloBuilderClient />);
    expect(screen.queryByText(/burn flat|significant/)).toBeNull();
  });

  it("calls a steadily rising burn a significant upward trend and projects the remainder", () => {
    seed([slo("s1", "api")], rising);
    render(<SloBuilderClient />);
    expect(screen.getByText(/api burn/)).toHaveTextContent("api burn ↗ significant");

    const projection = screen.getByText(/Projected end-of-window remaining \(api\):/)
      .parentElement as HTMLElement;
    // First burn 9 Oct, now 18 Oct 10:00 → 9 days elapsed of 30.
    expect(projection).toHaveTextContent("21d horizon");
    const [remaining, low, high] = (projection.textContent ?? "")
      .match(/(\d+\.\d) min.*CI (\d+\.\d)–(\d+\.\d)/)!
      .slice(1)
      .map(Number);
    expect(low).toBeLessThanOrEqual(remaining);
    expect(remaining).toBeLessThanOrEqual(high);
    // Budget 43.2 − 5.5 consumed bounds every projection from above.
    expect(high).toBeLessThanOrEqual(37.7);
  });

  it("calls a steadily falling burn a significant downward trend", () => {
    seed([slo("s1", "api")], series([1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]));
    render(<SloBuilderClient />);
    expect(screen.getByText(/api burn/)).toHaveTextContent("api burn ↘ significant");
  });

  it("calls an unchanging burn flat", () => {
    seed(
      [slo("s1", "api")],
      [0, 1, 2, 3, 4].map((i) => burn(`f${i}`, "s1", `2026-10-1${4 + i}`, 2))
    );
    render(<SloBuilderClient />);
    expect(screen.getByText(/api burn/)).toHaveTextContent("api burn flat");
  });

  it("skips the projection once the window has already elapsed", () => {
    seed(
      [slo("s1", "api", 0.999, 7)],
      [1, 2, 3, 4].map((m, i) => burn(`o${i}`, "s1", `2026-10-0${1 + i}`, m))
    );
    render(<SloBuilderClient />);
    expect(screen.getByText(/api burn/)).toBeInTheDocument();
    expect(screen.queryByText(/Projected end-of-window remaining/)).toBeNull();
  });
});

describe("SLO builder — export", () => {
  it("exports one CSV row per SLO with the derived budget numbers", () => {
    seed(
      [slo("s1", "api", 0.999, 30, { description: "core" }), slo("s2", "web", 0.99, 7)],
      [burn("b1", "s1", "2026-10-18", 10.8)]
    );
    render(<SloBuilderClient />);
    expect(exported.csv?.headers).toEqual([
      "SLO",
      "Target",
      "Window (days)",
      "SLI",
      "Budget (min)",
      "Consumed (min)",
      "Remaining %",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      ["api", 0.999, 30, "2xx on /api", "43.20", "10.80", "75.00", "core"],
      ["web", 0.99, 7, "2xx on /api", "100.80", "0.00", "100.00", ""],
    ]);
    expect(exported.json).toEqual({
      slos: doc()?.slos,
      burns: doc()?.burns,
    });
  });
});
