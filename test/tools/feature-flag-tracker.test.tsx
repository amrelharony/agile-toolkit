import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Feature Flag Tracker: KPI tiles (active / stale / retired this quarter /
 * total), the stale callout and its 90-day boundary, the add form, retire,
 * status changes, delete, the oldest-first list, the age-bucket and
 * survival data, the weekly-creation trend chip and the CSV export rows.
 */

interface CsvData {
  headers: string[];
  rows: (string | number)[][];
}
const exported = vi.hoisted(() => ({ csv: undefined as CsvData | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: CsvData }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
// The charts become placeholders that expose their props.
vi.mock("next/dynamic", () => ({
  default: () =>
    function Dynamic(props: object) {
      return <div data-testid="dynamic" data-props={JSON.stringify(props)} />;
    },
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import {
  FeatureFlagTrackerClient,
  weeklyCreationCounts,
} from "@/app/(tools)/feature-flag-tracker/feature-flag-tracker-client";

const KEY = "agile-toolkit:feature-flag-tracker";

interface Flag {
  id: string;
  name: string;
  owner?: string;
  status: "active" | "on" | "off" | "deprecated";
  createdAt: string;
  retiredAt?: string;
  environment: "dev" | "staging" | "prod" | "all";
  purpose: "rollout" | "experiment" | "kill_switch" | "permission";
  description?: string;
}

const flag = (id: string, createdAt: string, over: Partial<Flag> = {}): Flag => ({
  id,
  name: id,
  status: "active",
  createdAt,
  environment: "prod",
  purpose: "rollout",
  ...over,
});

const seed = (flags: Flag[]) => localStorage.setItem(KEY, JSON.stringify(flags));
const saved = (): Flag[] => JSON.parse(localStorage.getItem(KEY) ?? "[]");
const savedById = (id: string) => saved().find((f) => f.id === id)!;

/** The text of the compact StatCard whose label is `label`. */
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement!.textContent;

/** Data of the first dynamic chart whose rows carry `key`. */
const chartData = <T,>(key: string): T[] => {
  for (const el of screen.queryAllByTestId("dynamic")) {
    const props = JSON.parse(el.getAttribute("data-props") ?? "{}") as { data?: T[] };
    if (props.data?.[0] && key in (props.data[0] as object)) return props.data;
  }
  return [];
};

/** Flag names in list order. */
const listed = () =>
  screen
    .getAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")!.replace(/^Remove /, ""));

function choose(trigger: HTMLElement, label: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

/** A flag's card (the grid row holding its name). */
const card = (name: string) =>
  screen.getByRole("button", { name: `Remove ${name}` }).closest("div.grid") as HTMLElement;

const TODAY = "2026-10-23";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 23, 12));
  localStorage.clear();
  exported.csv = undefined;
  history.log.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("weeklyCreationCounts", () => {
  // Friday 23 Oct 2026; its Sunday-start week began on 18 Oct.
  const now = new Date(2026, 9, 23, 12);

  // Bug: the 26-week window was anchored a week too early, so the current
  // week had no bucket and its flags were added to last week's count.
  it("gives the current week its own last bucket", () => {
    const counts = weeklyCreationCounts(
      ["2026-10-18", "2026-10-23", "2026-10-17", "2026-10-11"],
      now
    );
    expect(counts).toHaveLength(26);
    expect(counts.slice(-3)).toEqual([0, 2, 2]);
  });

  it("starts the window 25 weeks before the current week", () => {
    const counts = weeklyCreationCounts(["2026-04-26", "2026-05-02", "2026-04-25"], now);
    expect(counts[0]).toBe(2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("is empty when no flag falls in the window", () => {
    expect(weeklyCreationCounts([], now)).toEqual([]);
    expect(weeklyCreationCounts(["2025-01-01", "not a date"], now)).toEqual([]);
  });
});

describe("Feature flags: empty state", () => {
  it("shows zero KPIs and the empty message", () => {
    render(<FeatureFlagTrackerClient />);
    expect(tile("Active flags")).toBe("Active flags0");
    expect(tile("Stale (>90d)")).toBe("Stale (>90d)0");
    expect(tile("Retired this quarter")).toBe("Retired this quarter0");
    expect(tile("Total tracked")).toBe("Total tracked00 experiment(s)");
    expect(screen.getByText(/No flags tracked yet/)).toBeInTheDocument();
    expect(screen.queryByText(/still active/)).not.toBeInTheDocument();
  });
});

describe("Feature flags: KPIs and staleness", () => {
  it("counts live flags, stale flags, quarter retirements and experiments", () => {
    seed([
      flag("on-flag", "2026-10-01", { status: "on", purpose: "experiment" }),
      flag("off-flag", "2026-01-01", { status: "off" }),
      flag("retired-now", "2026-01-01", { status: "deprecated", retiredAt: "2026-10-01" }),
      flag("retired-before", "2026-01-01", { status: "deprecated", retiredAt: "2026-09-30" }),
      flag("exp", "2026-10-20", { purpose: "experiment" }),
    ]);
    render(<FeatureFlagTrackerClient />);
    expect(tile("Active flags")).toBe("Active flags3");
    // Only off-flag: old and not retired.
    expect(tile("Stale (>90d)")).toBe("Stale (>90d)1");
    expect(tile("Retired this quarter")).toBe("Retired this quarter1");
    expect(tile("Total tracked")).toBe("Total tracked52 experiment(s)");
    expect(screen.getByText(/flag older than 90 days is still active/)).toBeInTheDocument();
  });

  it("treats exactly 90 days as fresh and 91 as stale", () => {
    seed([flag("ninety", "2026-07-25"), flag("ninety-one", "2026-07-24")]);
    render(<FeatureFlagTrackerClient />);
    expect(within(card("ninety")).getByText("90d")).toBeInTheDocument();
    expect(within(card("ninety-one")).getByText("91d")).toBeInTheDocument();
    expect(tile("Stale (>90d)")).toBe("Stale (>90d)1");
  });

  it("pluralises the stale callout", () => {
    seed([flag("a", "2026-01-01"), flag("b", "2026-02-01")]);
    render(<FeatureFlagTrackerClient />);
    expect(screen.getByText(/flags older than 90 days are still active/)).toBeInTheDocument();
  });

  it("does not count a deprecated flag as stale", () => {
    seed([flag("old", "2026-01-01", { status: "deprecated" })]);
    render(<FeatureFlagTrackerClient />);
    expect(tile("Stale (>90d)")).toBe("Stale (>90d)0");
  });

  it("shows a dash, not NaNd, for an unparseable created date", () => {
    seed([flag("weird", "someday")]);
    render(<FeatureFlagTrackerClient />);
    expect(within(card("weird")).getByText("—")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

describe("Feature flags: list", () => {
  it("lists the oldest flag first with owner, environment, purpose and dates", () => {
    seed([
      flag("young", "2026-10-20", {
        owner: "@web",
        environment: "staging",
        purpose: "kill_switch",
      }),
      flag("old", "2026-01-01", { status: "deprecated", retiredAt: "2026-03-01" }),
      flag("mid", "2026-06-01"),
    ]);
    render(<FeatureFlagTrackerClient />);
    expect(listed()).toEqual(["old", "mid", "young"]);
    const young = card("young");
    expect(young).toHaveTextContent("@web · Staging");
    expect(young).toHaveTextContent("Kill switch");
    expect(young).toHaveTextContent("since 2026-10-20");
    expect(within(young).getByText("3d")).toBeInTheDocument();
    expect(within(card("old")).getByText("retired 2026-03-01")).toBeInTheDocument();
    expect(within(card("old")).queryByRole("button", { name: /Retire/ })).not.toBeInTheDocument();
    expect(within(young).getByRole("button", { name: /Retire/ })).toBeInTheDocument();
  });

  it("never reorders the saved flags", () => {
    seed([flag("young", "2026-10-20"), flag("old", "2026-01-01")]);
    render(<FeatureFlagTrackerClient />);
    fireEvent.click(within(card("young")).getByRole("button", { name: /Retire/ }));
    expect(saved().map((f) => f.id)).toEqual(["young", "old"]);
  });
});

describe("Feature flags: add", () => {
  it("adds a trimmed active flag dated today at the front and resets the form", () => {
    seed([flag("existing", "2026-10-01")]);
    render(<FeatureFlagTrackerClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  checkout_v2  " } });
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "   " } });
    choose(screen.getByRole("combobox", { name: "Environment" }), "Staging");
    choose(screen.getByRole("combobox", { name: "Purpose" }), "Experiment");
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  A/B the new checkout  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const [added, existing] = saved();
    expect(added).toMatchObject({
      name: "checkout_v2",
      status: "active",
      createdAt: TODAY,
      environment: "staging",
      purpose: "experiment",
      description: "A/B the new checkout",
    });
    expect(added.owner).toBeUndefined();
    expect(existing.id).toBe("existing");
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Environment" })).toHaveTextContent("Prod");
    expect(screen.getByRole("combobox", { name: "Purpose" })).toHaveTextContent("Rollout");
    expect(history.log).toHaveBeenCalledWith(
      "flag_added",
      expect.objectContaining({
        name: "checkout_v2",
        purpose: "experiment",
        environment: "staging",
      })
    );
  });

  it("ignores a blank name", () => {
    render(<FeatureFlagTrackerClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(saved()).toEqual([]);
  });

  it("caps the name at 200 characters", () => {
    render(<FeatureFlagTrackerClient />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "f".repeat(300) } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(saved()[0].name).toHaveLength(200);
  });
});

describe("Feature flags: retire, status and delete", () => {
  it("retires a flag today and counts it this quarter", () => {
    seed([flag("a", "2026-01-01"), flag("b", "2026-02-01")]);
    render(<FeatureFlagTrackerClient />);
    fireEvent.click(within(card("a")).getByRole("button", { name: /Retire/ }));
    expect(savedById("a")).toMatchObject({ status: "deprecated", retiredAt: TODAY });
    expect(savedById("b").retiredAt).toBeUndefined();
    expect(tile("Retired this quarter")).toBe("Retired this quarter1");
    expect(tile("Active flags")).toBe("Active flags1");
    expect(tile("Stale (>90d)")).toBe("Stale (>90d)1");
    expect(history.log).toHaveBeenCalledWith("flag_retired", { flagId: "a" });
  });

  it("switches between live statuses without a retired date", () => {
    seed([flag("a", "2026-10-01")]);
    render(<FeatureFlagTrackerClient />);
    choose(screen.getByRole("combobox", { name: "Status for a" }), "Off");
    expect(savedById("a")).toMatchObject({ status: "off" });
    expect(savedById("a").retiredAt).toBeUndefined();
    expect(tile("Active flags")).toBe("Active flags1");
    expect(history.log).toHaveBeenCalledWith("flag_updated", { flagId: "a", fields: ["status"] });
  });

  it("does not count a flag retired in an earlier quarter", () => {
    seed([flag("a", "2026-01-01", { status: "deprecated", retiredAt: "2026-02-01" })]);
    render(<FeatureFlagTrackerClient />);
    expect(screen.getByRole("combobox", { name: "Status for a" })).toHaveTextContent("Deprecated");
    expect(tile("Retired this quarter")).toBe("Retired this quarter0");
  });

  it("removes exactly the clicked flag", () => {
    seed([flag("a", "2026-10-01"), flag("b", "2026-10-02"), flag("c", "2026-10-03")]);
    render(<FeatureFlagTrackerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove b" }));
    expect(saved().map((f) => f.id)).toEqual(["a", "c"]);
    expect(history.log).toHaveBeenCalledWith("flag_removed", { flagId: "b", name: "b" });
  });
});

describe("Feature flags: charts, trend and export", () => {
  it("buckets unretired flags by age", () => {
    seed([
      flag("d0", TODAY),
      flag("d30", "2026-09-23"),
      flag("d31", "2026-09-22"),
      flag("d90", "2026-07-25"),
      flag("d91", "2026-07-24"),
      flag("d200", "2026-04-06"),
      flag("retired", "2026-10-01", { status: "deprecated", retiredAt: "2026-10-10" }),
    ]);
    render(<FeatureFlagTrackerClient />);
    expect(chartData("bucket")).toEqual([
      { bucket: "0-30d", count: 2 },
      { bucket: "31-90d", count: 2 },
      { bucket: "91-180d", count: 1 },
      { bucket: ">180d", count: 1 },
    ]);
  });

  it("draws a survival curve once 4 flags are retired", () => {
    seed([
      flag("a", "2026-01-01", { status: "deprecated", retiredAt: "2026-01-11" }),
      flag("b", "2026-01-01", { status: "deprecated", retiredAt: "2026-01-21" }),
      flag("c", "2026-01-01", { status: "deprecated", retiredAt: "2026-01-31" }),
      flag("d", "2026-01-01", { status: "deprecated", retiredAt: "2026-02-10" }),
      flag("live", "2026-01-01"),
    ]);
    render(<FeatureFlagTrackerClient />);
    expect(screen.getByText("Flag retirement survival curve")).toBeInTheDocument();
    expect(screen.getByText(/Kaplan-Meier estimate over 4 retired flags/)).toBeInTheDocument();
    const curve = chartData<{ t: number; survival: number }>("survival");
    expect(curve[0]).toEqual({ t: 0, survival: 1 });
    // Survival only ever falls.
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].survival).toBeLessThanOrEqual(curve[i - 1].survival);
    }
  });

  it("has no survival curve below 4 retired flags", () => {
    seed([flag("a", "2026-01-01", { status: "deprecated", retiredAt: "2026-01-11" })]);
    render(<FeatureFlagTrackerClient />);
    expect(screen.queryByText("Flag retirement survival curve")).not.toBeInTheDocument();
  });

  /** One flag created on each of the last `n` Fridays (today is a Friday). */
  const recentWeeks = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(2026, 9, 23 - i * 7);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      return flag(`w${i}`, iso);
    });

  it("flags a significant rise in weekly flag creation", () => {
    seed(recentWeeks(10));
    render(<FeatureFlagTrackerClient />);
    expect(screen.getByText(/Weekly flag creation trending up significantly/)).toBeInTheDocument();
  });

  it("needs 3 weeks with new flags before showing any trend", () => {
    seed(recentWeeks(2));
    render(<FeatureFlagTrackerClient />);
    expect(screen.queryByText(/Weekly flag creation/)).not.toBeInTheDocument();
  });

  it("exports one CSV row per flag with age and a single-line description", () => {
    seed([
      flag("a", "2026-10-13", {
        owner: "@web",
        description: "line one\nline two",
        status: "deprecated",
        retiredAt: "2026-10-20",
      }),
    ]);
    render(<FeatureFlagTrackerClient />);
    expect(exported.csv?.headers).toEqual([
      "Name",
      "Owner",
      "Status",
      "Environment",
      "Purpose",
      "Created",
      "Retired",
      "Age (days)",
      "Description",
    ]);
    expect(exported.csv?.rows).toEqual([
      [
        "a",
        "@web",
        "deprecated",
        "prod",
        "rollout",
        "2026-10-13",
        "2026-10-20",
        10,
        "line one line two",
      ],
    ]);
  });
});
