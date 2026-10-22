import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useLlmStore } from "@/lib/stores/llm-store";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import type { HitlReview } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/**
 * HITL Quality Tracker: KPIs over well-formed reviews, logging and removing
 * reviews, the per-day mean-rating trend, the CSV export, and the BYOK
 * first-pass panel.
 */

type Csv = { headers: string[]; rows: (string | number)[][] };
type TrendPoint = { date: string; mean: number; n: number; sum: number };

const exported = vi.hoisted(() => ({ csv: undefined as Csv | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const chart = vi.hoisted(() => ({ data: undefined as TrendPoint[] | undefined }));

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: Csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/app/(tools)/hitl-quality/charts", () => ({
  HitlMeanRatingChart: ({ data }: { data: TrendPoint[] }) => {
    chart.data = data;
    return <div data-testid="hitl-chart" />;
  },
}));
vi.mock("@/components/shared/ai-run-panel", () => ({
  default: ({ prompt }: { prompt: string }) => <div data-testid="run-panel">{prompt}</div>,
}));

import { HitlQualityClient } from "@/app/(tools)/hitl-quality/hitl-quality-client";

const review = (
  id: string,
  rating: number,
  agreedWithModel: boolean,
  loggedAt: string,
  extra: Partial<HitlReview> = {}
): HitlReview => ({
  id,
  rating: rating as HitlReview["rating"],
  agreedWithModel,
  loggedAt,
  ...extra,
});

const reviews = () => useWorkspaceStore.getState().hitlReviews ?? [];
const kpi = (label: string) => screen.getByText(label).parentElement!;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const logReview = () => fireEvent.click(screen.getByRole("button", { name: "Log" }));

beforeEach(() => {
  exported.csv = undefined;
  chart.data = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ hitlReviews: [] });
  useLlmStore.setState({ activeProvider: null, providers: {} });
  useLlmUiStore.setState({ settingsOpen: false });
});

describe("HITL Quality: empty state", () => {
  it("shows zeroed KPIs and no reviews list or trend", () => {
    render(<HitlQualityClient />);
    expect(kpi("Reviews")).toHaveTextContent("0");
    expect(kpi("Mean rating")).toHaveTextContent("0.00");
    expect(kpi("Reviewer–model agreement")).toHaveTextContent("0%");
    expect(screen.queryByText(/^Reviews \(/)).toBeNull();
    expect(screen.queryByText("Mean rating over time")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove review" })).toBeNull();
  });

  it("points at AI settings when no BYOK provider is configured", () => {
    render(<HitlQualityClient />);
    expect(screen.getByText("No BYOK provider configured yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Prompt under review")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(useLlmUiStore.getState().settingsOpen).toBe(true);
  });
});

describe("HITL Quality: KPIs and the reviews list", () => {
  it("computes the mean rating and the share that agreed with the model", () => {
    useWorkspaceStore.setState({
      hitlReviews: [
        review("r1", 5, true, "2026-10-01T09:00:00.000Z"),
        review("r2", 4, true, "2026-10-01T10:00:00.000Z"),
        review("r3", 2, false, "2026-10-01T11:00:00.000Z"),
      ],
    });
    render(<HitlQualityClient />);
    expect(kpi("Reviews")).toHaveTextContent("3");
    expect(kpi("Mean rating")).toHaveTextContent("3.67");
    // 2 of 3 agreed → 67%, under the 80% "healthy" bar.
    const agreement = kpi("Reviewer–model agreement");
    expect(agreement).toHaveTextContent("67%");
    expect(within(agreement).getByText("67%")).not.toHaveClass("text-success");
    expect(screen.getByText("Reviews (3)")).toBeInTheDocument();
  });

  it("marks agreement above 80% as healthy", () => {
    useWorkspaceStore.setState({
      hitlReviews: Array.from({ length: 5 }, (_, i) =>
        review(`r${i}`, 4, true, "2026-10-01T09:00:00.000Z")
      ),
    });
    render(<HitlQualityClient />);
    expect(within(kpi("Reviewer–model agreement")).getByText("100%")).toHaveClass("text-success");
  });

  it("leaves malformed reviews out of the KPIs, the list and the CSV, and says so", () => {
    useWorkspaceStore.setState({
      hitlReviews: [
        review("ok1", 4, true, "2026-10-01T09:00:00.000Z", { feature: "Summaries" }),
        review("ok2", 2, false, "2026-10-02T09:00:00.000Z", { feature: "Search" }),
        review("bad-high", 6, true, "2026-10-03T09:00:00.000Z", { feature: "Too high" }),
        review("bad-zero", 0, true, "2026-10-03T09:00:00.000Z", { feature: "Zero" }),
        {
          ...review("bad-date", 5, true, "x", { feature: "No date" }),
          loggedAt: 12345 as unknown as string,
        },
      ],
    });
    render(<HitlQualityClient />);
    expect(kpi("Reviews")).toHaveTextContent("2 / 5");
    expect(kpi("Mean rating")).toHaveTextContent("3.00");
    expect(kpi("Reviewer–model agreement")).toHaveTextContent("50%");
    expect(screen.getAllByRole("button", { name: "Remove review" })).toHaveLength(2);
    expect(screen.queryByText("Too high")).toBeNull();
    expect(screen.queryByText("No date")).toBeNull();
    expect(exported.csv?.rows.map((r) => r[1])).toEqual(["Summaries", "Search"]);
  });

  it("lists reviews newest first with rating, feature, reviewer and agreement", () => {
    useWorkspaceStore.setState({
      hitlReviews: [
        review("old", 2, false, "2026-10-01T09:00:00.000Z", { feature: "Old", reviewer: "Ana" }),
        review("new", 5, true, "2026-10-05T09:00:00.000Z", { feature: "New" }),
      ],
    });
    render(<HitlQualityClient />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("New");
    expect(items[0]).toHaveTextContent("5");
    expect(items[0]).toHaveTextContent("agreed");
    expect(items[0]).not.toHaveTextContent("—");
    expect(items[1]).toHaveTextContent("Old");
    expect(items[1]).toHaveTextContent("— Ana");
    expect(items[1]).toHaveTextContent("disagreed");
  });

  it("removes the review whose bin was clicked", () => {
    useWorkspaceStore.setState({
      hitlReviews: [
        review("old", 2, false, "2026-10-01T09:00:00.000Z", { feature: "Old" }),
        review("new", 5, true, "2026-10-05T09:00:00.000Z", { feature: "New" }),
      ],
    });
    render(<HitlQualityClient />);
    const oldRow = screen.getByText("Old").closest("li")!;
    fireEvent.click(within(oldRow).getByRole("button", { name: "Remove review" }));
    expect(reviews().map((r) => r.id)).toEqual(["new"]);
    expect(history.log).toHaveBeenCalledWith("review_removed", { id: "old" });
    expect(screen.queryByText("Old")).toBeNull();
  });

  // Bug: the list silently stopped at 50 rows while its title counted them all.
  it("says when the list shows only the latest 50 reviews", () => {
    useWorkspaceStore.setState({
      hitlReviews: Array.from({ length: 55 }, (_, i) =>
        review(`r${i}`, 4, true, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), {
          feature: `Feature ${i}`,
        })
      ),
    });
    render(<HitlQualityClient />);
    expect(screen.getAllByRole("button", { name: "Remove review" })).toHaveLength(50);
    expect(screen.getByText(/Showing the latest 50 of 55 reviews/)).toBeInTheDocument();
    expect(screen.getByText("Feature 54")).toBeInTheDocument();
    expect(screen.queryByText("Feature 0")).toBeNull();
  });

  it("says nothing about truncation when every review fits", () => {
    useWorkspaceStore.setState({
      hitlReviews: [review("r1", 4, true, "2026-10-01T09:00:00.000Z", { feature: "A" })],
    });
    render(<HitlQualityClient />);
    expect(screen.queryByText(/Showing the latest/)).toBeNull();
  });
});

describe("HITL Quality: logging a review", () => {
  it("does nothing until a feature, reviewer or reason is given", () => {
    render(<HitlQualityClient />);
    logReview();
    type("Feature", "   ");
    type("Reason or notes (optional)", "  ");
    logReview();
    expect(reviews()).toEqual([]);
    expect(history.log).not.toHaveBeenCalled();
  });

  it("logs with the defaults (rating 3, agreed) and only the fields given", () => {
    render(<HitlQualityClient />);
    type("Reviewer", "  Ana  ");
    logReview();
    const [r] = reviews();
    expect(r).toMatchObject({ reviewer: "Ana", rating: 3, agreedWithModel: true });
    expect(r.feature).toBeUndefined();
    expect(r.reason).toBeUndefined();
    expect(Number.isNaN(Date.parse(r.loggedAt))).toBe(false);
    expect(history.log).toHaveBeenCalledWith("review_logged", { rating: 3, agreed: true });
  });

  it("logs the chosen rating, disagreement and reason, then resets the form", () => {
    render(<HitlQualityClient />);
    type("Feature", "Summaries");
    type("Reviewer", "Ben");
    fireEvent.change(screen.getByLabelText("Reviewer rating, 1 to 5"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /agreed with the model output/ }));
    type("Reason or notes (optional)", "  Missed the key point.  ");
    logReview();

    expect(reviews()[0]).toMatchObject({
      feature: "Summaries",
      reviewer: "Ben",
      rating: 1,
      agreedWithModel: false,
      reason: "Missed the key point.",
    });
    expect(screen.getByLabelText("Feature")).toHaveValue("");
    expect(screen.getByLabelText("Reviewer")).toHaveValue("");
    expect(screen.getByLabelText("Reason or notes (optional)")).toHaveValue("");
    expect(screen.getByLabelText("Reviewer rating, 1 to 5")).toHaveValue("3");
    expect(screen.getByRole("checkbox", { name: /agreed with the model output/ })).toBeChecked();
    // The new review shows up in the list and the KPIs.
    expect(kpi("Mean rating")).toHaveTextContent("1.00");
    expect(kpi("Reviewer–model agreement")).toHaveTextContent("0%");
    expect(screen.getByText("Summaries")).toBeInTheDocument();
  });

  it("caps a very long reason at 4000 characters", () => {
    render(<HitlQualityClient />);
    type("Reason or notes (optional)", "x".repeat(5000));
    logReview();
    expect(reviews()[0].reason).toHaveLength(4000);
  });
});

describe("HITL Quality: mean rating over time", () => {
  it("needs reviews on at least two days", () => {
    useWorkspaceStore.setState({
      hitlReviews: [
        review("a", 4, true, new Date(2026, 9, 1, 9).toISOString()),
        review("b", 2, true, new Date(2026, 9, 1, 15).toISOString()),
      ],
    });
    render(<HitlQualityClient />);
    expect(screen.queryByText("Mean rating over time")).toBeNull();
  });

  it("averages each day's ratings, oldest day first", async () => {
    useWorkspaceStore.setState({
      hitlReviews: [
        review("c", 5, true, new Date(2026, 9, 3, 12).toISOString()),
        review("a", 4, true, new Date(2026, 9, 1, 9).toISOString()),
        review("b", 2, true, new Date(2026, 9, 1, 15).toISOString()),
        review("bad", 9, true, new Date(2026, 9, 2, 12).toISOString()),
      ],
    });
    render(<HitlQualityClient />);
    expect(screen.getByText("Mean rating over time")).toBeInTheDocument();
    await screen.findByTestId("hitl-chart");
    expect(chart.data?.map((d) => [d.date, d.mean, d.n])).toEqual([
      ["2026-10-01", 3, 2],
      ["2026-10-03", 5, 1],
    ]);
  });

  // Bug: days were cut from the UTC timestamp, so a review logged just after
  // local midnight (or late in the evening west of UTC) showed, charted and
  // exported under the wrong day.
  it("uses the reviewer's local calendar day in the list, the trend and the CSV", async () => {
    const earlyMorning = new Date(2026, 9, 18, 0, 30);
    const lateEvening = new Date(2026, 9, 18, 23, 30);
    useWorkspaceStore.setState({
      hitlReviews: [
        review("early", 4, true, earlyMorning.toISOString(), { feature: "Early" }),
        review("late", 2, true, lateEvening.toISOString(), { feature: "Late" }),
        review("before", 5, true, new Date(2026, 9, 16, 12).toISOString(), { feature: "Before" }),
      ],
    });
    render(<HitlQualityClient />);
    const day = todayLocalISO(earlyMorning);
    expect(day).toBe("2026-10-18");
    expect(screen.getByText("Early").closest("li")).toHaveTextContent(day);
    expect(screen.getByText("Late").closest("li")).toHaveTextContent(day);
    await screen.findByTestId("hitl-chart");
    expect(chart.data?.map((d) => [d.date, d.mean])).toEqual([
      ["2026-10-16", 5],
      ["2026-10-18", 3],
    ]);
    expect(exported.csv?.rows.map((r) => r[0]).sort()).toEqual([
      "2026-10-16",
      "2026-10-18",
      "2026-10-18",
    ]);
  });
});

describe("HITL Quality: CSV export", () => {
  it("writes one row per valid review with yes/no agreement", () => {
    useWorkspaceStore.setState({
      hitlReviews: [
        review("r1", 4, false, new Date(2026, 9, 1, 12).toISOString(), {
          feature: "Summaries",
          reviewer: "Ana",
          reason: "Too long",
        }),
      ],
    });
    render(<HitlQualityClient />);
    expect(exported.csv?.headers).toEqual([
      "Date",
      "Feature",
      "Reviewer",
      "Rating",
      "Agreed with model",
      "Reason",
    ]);
    expect(exported.csv?.rows).toEqual([["2026-10-01", "Summaries", "Ana", 4, "no", "Too long"]]);
  });
});

describe("HITL Quality: BYOK first pass", () => {
  it("runs the typed prompt once a provider is configured", async () => {
    useLlmStore.setState({
      activeProvider: "anthropic",
      providers: { anthropic: { apiKey: "test-key", model: "claude-sonnet-4-6" } },
    });
    render(<HitlQualityClient />);
    expect(screen.queryByText("No BYOK provider configured yet.")).toBeNull();
    expect(screen.queryByTestId("run-panel")).toBeNull();
    type("Prompt under review", "   ");
    expect(screen.queryByTestId("run-panel")).toBeNull();
    type("Prompt under review", "Summarise this ticket");
    expect(await screen.findByTestId("run-panel")).toHaveTextContent("Summarise this ticket");
    // The prompt is scaffolding only; nothing is logged.
    expect(reviews()).toEqual([]);
  });
});
