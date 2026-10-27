import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import {
  latestEnough,
  periodSeries,
  summarizeCsat,
  summarizeNps,
  tagCounts,
} from "@/lib/nps/score";
import { isExampleId } from "@/lib/utils/example-id";
import { LEGACY_CSAT, NPS } from "../stores/phase8-fixtures";

/**
 * NPS / CSAT, upgraded (Phase 8): a form whose survey and score start unset
 * (no default 8), CSV and paste import through lib/utils/csv (capped,
 * copies of stored answers skipped and listed, the survey picked for a file
 * with no kind column), calendar weeks or months with n and a warning below
 * the minimum, CSAT as % satisfied, verbatim tags with a filter, delete and
 * clear with Undo, edit in place, an example, Markdown, and the same
 * numbers as tool.nps_csat.list_state for the same data.
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
const sounds = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/sonification/emit", () => ({
  emit: (tool: string, event: string) => sounds.push(`${tool}:${event}`),
}));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown ?? "";
    return null;
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
// Recharts has nothing to measure in jsdom; the chart's text is tested directly.
vi.mock("@/app/(tools)/nps-csat/charts", () => ({ ScoreTrendChart: () => null }));

import { NpsCsatClient, PERIOD_KEY } from "@/app/(tools)/nps-csat/nps-csat-client";
import { buildExample } from "@/app/(tools)/nps-csat/example";
import { toMarkdown, MD_VERBATIMS } from "@/app/(tools)/nps-csat/markdown";
import {
  emptyResponse,
  newResponse,
  responseDraft,
  validateResponse,
  withResponseValues,
} from "@/app/(tools)/nps-csat/form";
import { IMPORT_CAP, previewImport, readKind } from "@/app/(tools)/nps-csat/import";
import { surveyVerdict, thinPeriodWarning } from "@/app/(tools)/nps-csat/verdict";

/** 27 Oct 2026, noon local: only Date is faked, so promises and timers run as usual. */
const NOW = new Date(2026, 9, 27, 12);
const TODAY = "2026-10-27";

let seq = 0;
const resp = (
  kind: "nps" | "csat",
  date: string,
  score: number,
  extra: Partial<NpsResponse> = {}
): NpsResponse => ({ id: `r${++seq}`, kind, date, score, ...extra });
/** `n` answers of one kind on one day: the first `good` promoters (10) or satisfied (5), the rest unhappy (2). */
const many = (kind: "nps" | "csat", date: string, n: number, good: number) =>
  Array.from({ length: n }, (_, i) => resp(kind, date, i < good ? (kind === "nps" ? 10 : 5) : 2));

const stored = () => useWorkspaceStore.getState().npsResponses ?? [];
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () =>
  act(() => (lastToast()[1] as { action: { onClick: () => void } }).action.onClick());
const actions = () => logs.map((l) => l.action);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  seq = 0;
  logs.length = 0;
  sounds.length = 0;
  toastSpy.mockClear();
  exported.markdown = "";
  localStorage.clear();
  useWorkspaceStore.setState({ npsResponses: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

/* ── The form ───────────────────────────────────────────────────────── */

describe("validateResponse", () => {
  it("starts with no survey and no score, and saves nothing without them", () => {
    const d = emptyResponse(TODAY);
    expect(d).toEqual({
      kind: null,
      score: null,
      date: TODAY,
      respondent: "",
      verbatim: "",
      tags: "",
    });
    const r = validateResponse(d, TODAY);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["kind", "score"]);
  });

  it("takes a whole score on the survey's scale, and 0 is a real NPS", () => {
    expect(validateResponse({ ...emptyResponse(TODAY, "nps"), score: 0 }, TODAY).ok).toBe(true);
    const csat = validateResponse({ ...emptyResponse(TODAY, "csat"), score: 6 }, TODAY);
    expect(!csat.ok && csat.errors.score).toMatch(/CSAT is 1–5/);
    const frac = validateResponse({ ...emptyResponse(TODAY, "nps"), score: 7.5 }, TODAY);
    expect(frac.ok).toBe(false);
    // An edited row from before Phase 8 keeps its fraction unless a new score is picked.
    expect(
      validateResponse({ ...emptyResponse(TODAY, "nps"), score: 7.5 }, TODAY, { keepScore: 7.5 }).ok
    ).toBe(true);
  });

  it("can be backdated, never dated in the future or left undated", () => {
    expect(validateResponse({ ...emptyResponse("2025-01-02", "nps"), score: 9 }, TODAY).ok).toBe(
      true
    );
    const future = validateResponse({ ...emptyResponse("2026-10-28", "nps"), score: 9 }, TODAY);
    expect(!future.ok && future.errors.date).toMatch(/future/);
    const blank = validateResponse({ ...emptyResponse("", "nps"), score: 9 }, TODAY);
    expect(!blank.ok && blank.errors.date).toMatch(/day/);
  });

  it("stores tags lower-case and once, and refuses tags it would have to cut", () => {
    const ok = validateResponse(
      { ...emptyResponse(TODAY, "nps"), score: 4, tags: " Checkout, PRICING ,checkout," },
      TODAY
    );
    expect(ok.ok && ok.values.tags).toEqual(["checkout", "pricing"]);
    const tooMany = validateResponse(
      {
        ...emptyResponse(TODAY, "nps"),
        score: 4,
        tags: Array.from({ length: 11 }, (_, i) => `t${i}`).join(","),
      },
      TODAY
    );
    expect(!tooMany.ok && tooMany.errors.tags).toMatch(/At most 10 tags/);
    const long = validateResponse(
      { ...emptyResponse(TODAY, "nps"), score: 4, tags: "x".repeat(41) },
      TODAY
    );
    expect(!long.ok && long.errors.tags).toMatch(/longer than 40/);
  });

  it("writes no empty fields, and an edit removes the ones emptied", () => {
    const r = newResponse({ kind: "csat", score: 4, date: TODAY, tags: [] });
    expect(r).toEqual({ id: expect.stringMatching(/^nps_/), kind: "csat", score: 4, date: TODAY });
    const before = { ...NPS };
    const next = withResponseValues(before, {
      kind: "nps",
      score: 6,
      date: "2026-10-20",
      tags: [],
    });
    expect(next).toEqual({ id: NPS.id, kind: "nps", score: 6, date: "2026-10-20" });
  });

  it("reads a stored row for editing; a score off the scale reads as unset", () => {
    expect(responseDraft(NPS)).toMatchObject({ kind: "nps", score: 9, tags: "pricing, board" });
    expect(responseDraft({ ...NPS, score: 11 }).score).toBeNull();
    expect(responseDraft({ ...NPS, date: "2026-10-20T09:00:00Z" }).date).toBe("2026-10-20");
  });
});

/* ── Import ─────────────────────────────────────────────────────────── */

describe("previewImport", () => {
  const opts = (kind: "nps" | "csat" | null = null, existing: NpsResponse[] = []) => ({
    kind,
    today: TODAY,
    existing,
  });

  it("reads a CSV with a header: quoted commas and line breaks, CRLF and a BOM", () => {
    const csv =
      "﻿Date,Kind,Score,Respondent,Comment,Tags\r\n" +
      '2026-10-01,NPS,9,ana@x.io,"Fast, friendly",delivery\r\n' +
      '2026-10-02,csat,2,,"Charged twice\nfor one order","checkout, billing"\r\n';
    const p = previewImport(csv, opts());
    expect(p.problem).toBeNull();
    expect(p.needsKind).toBe(false);
    expect(p.ready.map((r) => r.response)).toEqual([
      {
        kind: "nps",
        date: "2026-10-01",
        score: 9,
        respondent: "ana@x.io",
        verbatim: "Fast, friendly",
        tags: ["delivery"],
      },
      {
        kind: "csat",
        date: "2026-10-02",
        score: 2,
        verbatim: "Charged twice\nfor one order",
        tags: ["checkout", "billing"],
      },
    ]);
    expect(p.ready.map((r) => r.line)).toEqual([2, 3]);
  });

  it("reads a spreadsheet paste (tabs), and asks for the survey when there's no kind column", () => {
    const tsv = "date\tscore\tfeedback\n2026-10-03\t10\tLove it\n2026-10-04\t3\t";
    const waiting = previewImport(tsv, opts(null));
    expect(waiting).toMatchObject({ needsKind: true, rows: 2, ready: [] });
    const nps = previewImport(tsv, opts("nps"));
    expect(nps.ready.map((r) => [r.response.kind, r.response.score, r.response.verbatim])).toEqual([
      ["nps", 10, "Love it"],
      ["nps", 3, undefined],
    ]);
    // The same 10 can't be a CSAT score.
    const csat = previewImport(tsv, opts("csat"));
    expect(csat.ready).toHaveLength(1);
    expect(csat.skipped).toEqual([
      { line: 2, reason: "the score “10” isn't a whole number from 1 to 5 (CSAT)" },
    ]);
  });

  it("says why each refused row can't be read, by line", () => {
    const csv = [
      "date,kind,score,tags",
      "03/10/2026,nps,9,",
      "2026-10-28,nps,9,",
      "2026-10-05,nps,7.5,",
      "2026-10-05,nps,,",
      "2026-10-05,ces,4,",
      `2026-10-05,nps,4,"${Array.from({ length: 11 }, (_, i) => `t${i}`).join(",")}"`,
      "2026-10-05T14:20:00Z,NPS,8,",
    ].join("\n");
    const p = previewImport(csv, opts());
    expect(p.skipped).toEqual([
      { line: 2, reason: "the date “03/10/2026” isn't YYYY-MM-DD" },
      { line: 3, reason: "2026-10-28 is in the future" },
      { line: 4, reason: "the score “7.5” isn't a whole number from 0 to 10 (NPS)" },
      { line: 5, reason: "no score" },
      { line: 6, reason: "the kind “ces” isn't NPS or CSAT" },
      { line: 7, reason: "At most 10 tags on a response (11 given)." },
    ]);
    // A timestamp reads as its day, as the workspace stores it.
    expect(p.ready.map((r) => r.response.date)).toEqual(["2026-10-05"]);
  });

  it("skips exact copies of stored responses and lists them, one stored copy per row", () => {
    const existing = [
      resp("nps", "2026-10-01", 9),
      resp("nps", "2026-10-01", 9, { tags: ["delivery"] }),
      resp("nps", "2026-10-01", 4, { verbatim: "Slow" }),
    ];
    const csv =
      "date,kind,score,verbatim\n2026-10-01,nps,9,\n2026-10-01,nps,9,\n2026-10-01,nps,9,\n2026-10-01,nps,4,Slow\n2026-10-01,nps,4,Slower";
    const p = previewImport(csv, opts(null, existing));
    expect(p.duplicates.map((d) => d.line)).toEqual([2, 3, 5]);
    expect(p.ready.map((r) => r.line)).toEqual([4, 6]);
    // Importing the same file twice adds nothing the second time.
    const again = previewImport(
      csv,
      opts(null, [...existing, ...p.ready.map((r, i) => ({ id: `x${i}`, ...r.response }))])
    );
    expect(again.ready).toEqual([]);
  });

  it("reads at most 1000 rows and says how many were left out", () => {
    const rows = Array.from({ length: IMPORT_CAP + 5 }, () => "2026-10-01,9");
    const p = previewImport(`date,score\n${rows.join("\n")}`, opts("nps"));
    expect(p).toMatchObject({ rows: IMPORT_CAP, overCap: 5 });
    expect(p.ready).toHaveLength(IMPORT_CAP);
  });

  it("names the columns it needs when the header lacks them", () => {
    expect(previewImport("when,rating\n2026-10-01,9", opts("nps")).problem).toMatch(
      /No date column/
    );
    expect(previewImport("date,stars\n2026-10-01,9", opts("nps")).problem).toMatch(
      /No score column/
    );
    expect(previewImport("   \n", opts("nps")).rows).toBe(0);
  });

  it("knows the survey's names", () => {
    expect(readKind("Net Promoter Score")).toBe("nps");
    expect(readKind("CSAT")).toBe("csat");
    expect(readKind("Satisfaction")).toBe("csat");
    expect(readKind("CES")).toBeNull();
  });
});

/* ── Verdict, warning, Markdown, example ────────────────────────────── */

describe("surveyVerdict and the small-sample warning", () => {
  it("leads with the latest period with enough answers, against the one before", () => {
    const rs = [
      ...many("nps", "2026-08-10", 10, 4),
      ...many("nps", "2026-09-10", 10, 6),
      ...many("nps", "2026-10-10", 3, 3),
      ...many("csat", "2026-09-12", 10, 8),
    ];
    const { points } = periodSeries(rs, "month", { through: TODAY });
    expect(surveyVerdict(points, { nps: summarizeNps(rs), csat: summarizeCsat(rs) })).toBe(
      "Sep 2026: NPS +20 from 10 responses, up from -20 in Aug 2026; CSAT 80% satisfied in Sep 2026 (10 responses)."
    );
    expect(thinPeriodWarning(points[points.length - 1])).toBe(
      "Oct 2026: only 3 NPS responses: one answer moves NPS by 33 points. Read it with care until 10 are in."
    );
    expect(thinPeriodWarning(points[1])).toBeNull();
  });

  it("reads all-time with the swing when no period has enough, and says nothing without answers", () => {
    const rs = many("nps", "2026-10-10", 4, 1);
    const { points } = periodSeries(rs, "month");
    expect(surveyVerdict(points, { nps: summarizeNps(rs), csat: summarizeCsat(rs) })).toBe(
      "NPS -50 from 4 responses all told (no period has 10 yet; one answer moves it by 25 points)."
    );
    expect(surveyVerdict([], { nps: summarizeNps([]), csat: summarizeCsat([]) })).toBe(
      "No responses yet."
    );
  });
});

describe("toMarkdown", () => {
  it("gives the verdict, NPS and CSAT with n, the periods, the themes and unhappy verbatims", () => {
    const rs = [
      ...many("nps", "2026-09-10", 10, 6),
      resp("nps", "2026-10-02", 3, { verbatim: "Card | declined\ntwice", tags: ["checkout"] }),
      resp("csat", "2026-10-03", 1, { verbatim: "Charged twice", tags: ["checkout"] }),
      resp("csat", "", 5),
    ];
    const md = toMarkdown(rs, "month", { now: NOW, today: TODAY });
    const lines = md.split("\n");
    expect(lines[0]).toBe("# NPS / CSAT — 27 Oct 2026");
    expect(lines).toContain("- NPS: +9 from 11 (6 promoters, 0 passives, 5 detractors)");
    expect(lines).toContain("- CSAT: 50% satisfied from 2 (average 3 of 5)");
    expect(lines).toContain("- 1 response has no valid date: counted, in no period.");
    expect(lines).toContain("| Month | NPS | NPS responses | CSAT % satisfied | CSAT responses |");
    expect(lines).toContain("| Sep 2026 | +20 | 10 | — | 0 |");
    expect(lines).toContain("| Oct 2026 | -100 | 1 (below 10) | 0% | 1 (below 10) |");
    // A tag's own score shows from 10 responses, as on the page.
    expect(lines).toContain("| checkout | 2 | 2 | — (n 1) | — (n 1) |");
    expect(lines).toContain("- 2026-10-03, CSAT 1 [checkout]: “Charged twice”");
    expect(lines).toContain("- 2026-10-02, NPS 3 [checkout]: “Card \\| declined twice”");
  });

  it("lists at most 20 unhappy verbatims, newest first, and says when empty", () => {
    const rs = Array.from({ length: 25 }, (_, i) =>
      resp("nps", `2026-09-${String(i + 1).padStart(2, "0")}`, 1, { verbatim: `v${i + 1}` })
    );
    const md = toMarkdown(rs, "week", { now: NOW, today: TODAY });
    const quoted = md.split("\n").filter((l) => l.includes("“v"));
    expect(quoted).toHaveLength(MD_VERBATIMS);
    expect(quoted[0]).toContain("“v25”");
    expect(toMarkdown([], "month", { now: NOW, today: TODAY })).toBe(
      "# NPS / CSAT — 27 Oct 2026\n\nNo responses yet.\n"
    );
  });
});

describe("the example", () => {
  it("is deterministic, example ids only, never after today, with a thin current month", () => {
    const a = buildExample(NOW);
    expect(buildExample(NOW)).toEqual(a);
    expect(a.every((r) => isExampleId(r.id) && r.date <= TODAY)).toBe(true);
    const { points } = periodSeries(a, "month", { through: TODAY });
    expect(points.map((p) => p.period)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(points.slice(0, 2).every((p) => p.enoughNps && p.enoughCsat)).toBe(true);
    expect(points[2].enoughNps).toBe(false);
    // The theme the Next step points at: 3+ unhappy answers about checkout.
    expect(tagCounts(a)[0]).toMatchObject({ tag: "checkout" });
    expect(tagCounts(a)[0].unhappy).toBeGreaterThanOrEqual(3);
  });

  it("keeps this month's answers on or before today early in a month", () => {
    const early = new Date(2026, 10, 1, 9);
    expect(buildExample(early).every((r) => r.date <= "2026-11-01")).toBe(true);
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

const renderPage = () => render(<NpsCsatClient />);
const addForm = () =>
  within(screen.getByRole("button", { name: "Add response" }).closest("form") as HTMLElement);

describe("adding a response", () => {
  it("saves nothing until a survey and a score are picked: no default 8", () => {
    renderPage();
    const form = addForm();
    expect(form.queryByRole("radio", { checked: true })).toBeNull();
    fireEvent.click(form.getByRole("button", { name: "Add response" }));
    expect(stored()).toHaveLength(0);
    expect(form.getByText("Pick NPS or CSAT.")).toBeInTheDocument();

    fireEvent.click(form.getByRole("radio", { name: "NPS (0–10)" }));
    expect(form.queryByRole("radio", { checked: true, name: "8" })).toBeNull();
    fireEvent.click(form.getByRole("radio", { name: "9" }));
    fireEvent.change(form.getByLabelText("Tags"), { target: { value: "Delivery" } });
    fireEvent.submit(form.getByLabelText("Tags").closest("form") as HTMLFormElement);

    expect(stored()).toEqual([
      {
        id: expect.stringMatching(/^nps_/),
        kind: "nps",
        score: 9,
        date: TODAY,
        tags: ["delivery"],
      },
    ]);
    expect(actions()).toEqual(["survey_added"]);
    expect(sounds).toEqual(["nps-csat:score-promoter"]);
    // The next answer starts on the same survey and day, its score unset.
    expect(addForm().getByRole("radio", { name: "NPS (0–10)" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(addForm().queryByRole("radio", { name: "9", checked: true })).toBeNull();
  });

  it("clears a score that isn't on the new survey's scale instead of squeezing it in", () => {
    renderPage();
    const form = addForm();
    fireEvent.click(form.getByRole("radio", { name: "NPS (0–10)" }));
    fireEvent.click(form.getByRole("radio", { name: "8" }));
    fireEvent.click(form.getByRole("radio", { name: "CSAT (1–5)" }));
    expect(form.queryByRole("radio", { checked: true, name: "5" })).toBeNull();
    fireEvent.click(form.getByRole("button", { name: "Add response" }));
    expect(stored()).toHaveLength(0);
    expect(form.getByText("Pick the score the customer gave.")).toBeInTheDocument();
  });
});

describe("the readings", () => {
  const data = () => [
    ...many("nps", "2026-09-10", 10, 6),
    ...many("csat", "2026-09-11", 10, 8),
    ...many("nps", "2026-10-10", 4, 1),
  ];

  it("heads with the latest month with enough answers, all-time in the hint, and warns on a thin one", () => {
    useWorkspaceStore.setState({ npsResponses: data() });
    renderPage();
    expect(
      screen.getByText(/^Sep 2026: NPS \+20 from 10 responses; CSAT 80% satisfied/)
    ).toBeInTheDocument();
    expect(screen.getByText("Sep 2026, 10 responses. All-time 0 from 14.")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(
      screen.getByText(/Oct 2026: only 4 NPS responses: one answer moves NPS by 25 points/)
    ).toBeInTheDocument();
    // The per-response z-score "Anomalies" card is gone.
    expect(screen.queryByText("Anomalies")).toBeNull();
  });

  it("groups by month by default and remembers week for this viewer", () => {
    useWorkspaceStore.setState({ npsResponses: data() });
    renderPage();
    expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Week" }));
    expect(screen.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem(PERIOD_KEY) ?? "null")).toBe("week");
    expect(exported.markdown).toContain("## By week");
  });

  it("asks for a second period before drawing a trend", () => {
    useWorkspaceStore.setState({ npsResponses: many("nps", TODAY, 3, 2) });
    renderPage();
    expect(
      screen.getByText("Collect 1 more month of answers to see the trend.")
    ).toBeInTheDocument();
  });

  it("filters the list, the cards and the export by a tag", () => {
    useWorkspaceStore.setState({
      npsResponses: [
        resp("nps", "2026-10-01", 2, { tags: ["checkout"], verbatim: "Card failed" }),
        resp("nps", "2026-10-02", 10, { tags: ["delivery"], verbatim: "Fast" }),
      ],
    });
    renderPage();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Filter by tag" })).getByRole("button", {
        name: /checkout/,
      })
    );
    expect(screen.getByText("“Card failed”")).toBeInTheDocument();
    expect(screen.queryByText("“Fast”")).toBeNull();
    expect(
      screen.getByRole("heading", { name: /Responses tagged “checkout”/ })
    ).toBeInTheDocument();
    expect(exported.markdown.split("\n")[0]).toBe("# NPS / CSAT — “checkout” — 27 Oct 2026");
    fireEvent.click(screen.getByRole("button", { name: "Show every response" }));
    expect(screen.getByText("“Fast”")).toBeInTheDocument();
  });

  it("shows both the respondent and the whole verbatim", () => {
    useWorkspaceStore.setState({ npsResponses: [NPS] });
    renderPage();
    expect(screen.getByText("acme-admin")).toBeInTheDocument();
    expect(screen.getByText("“Love the board, pricing is steep”")).toBeInTheDocument();
  });
});

describe("changes with Undo", () => {
  it("deletes a response with Undo, back in its place", () => {
    useWorkspaceStore.setState({ npsResponses: [NPS, LEGACY_CSAT] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Remove NPS response from 2026-10-20" }));
    expect(stored().map((r) => r.id)).toEqual([LEGACY_CSAT.id]);
    expect(lastToast()[0]).toBe("Deleted the NPS 9 of 2026-10-20");
    expect(actions()).toEqual(["survey_removed"]);
    undoLast();
    expect(stored().map((r) => r.id)).toEqual([NPS.id, LEGACY_CSAT.id]);
  });

  it("clears every response after a confirm, with Undo", () => {
    useWorkspaceStore.setState({ npsResponses: [NPS, LEGACY_CSAT] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear responses" }));
    expect(stored()).toEqual([]);
    expect(actions()).toEqual(["survey_reset"]);
    undoLast();
    expect(stored()).toEqual([NPS, LEGACY_CSAT]);
  });

  it("edits a response in place, keeping a legacy score it didn't change", () => {
    const legacy = { ...LEGACY_CSAT, score: 3.5 };
    useWorkspaceStore.setState({ npsResponses: [legacy] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit the CSAT response of 2026-08-02" }));
    const tags = screen.getAllByLabelText("Tags").find((el) => el.closest("li"))!;
    fireEvent.change(tags, { target: { value: "support" } });
    fireEvent.click(screen.getByRole("button", { name: "Save response" }));
    expect(stored()).toEqual([{ ...legacy, tags: ["support"] }]);
    expect(actions()).toEqual(["response_updated"]);
    expect(logs[0].payload).toEqual({ responseId: legacy.id, fields: ["tags"] });
  });

  it("imports pasted rows after the survey is picked, skipping saved copies, with Undo", () => {
    useWorkspaceStore.setState({ npsResponses: [resp("nps", "2026-10-01", 9)] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    fireEvent.change(screen.getByLabelText("Or paste rows"), {
      target: { value: "date\tscore\n2026-10-01\t9\n2026-10-02\t3\n2026-10-03\t11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(stored()).toHaveLength(1);
    expect(screen.getByText("Pick NPS or CSAT for the whole file.")).toBeInTheDocument();

    const pick = within(screen.getByRole("radiogroup", { name: "Every row is" }));
    fireEvent.click(pick.getByRole("radio", { name: "NPS (0–10)" }));
    expect(screen.getByText("1 ready to import")).toBeInTheDocument();
    expect(
      screen.getByText(/1 already saved \(skipped\), 1 row can't be read/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 response" }));

    expect(stored().map((r) => [r.date, r.score])).toEqual([
      ["2026-10-01", 9],
      ["2026-10-02", 3],
    ]);
    expect(logs).toEqual([{ action: "responses_imported", payload: { added: 1, skipped: 1 } }]);
    undoLast();
    expect(stored()).toHaveLength(1);
  });
});

describe("the example on the page", () => {
  it("loads without logging, offers import too, and Clear example removes only its rows", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Import a CSV" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored().length).toBe(buildExample(NOW).length);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(logs).toEqual([]);
    useWorkspaceStore.getState().upsertNpsResponse(NPS);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored()).toEqual([NPS]);
  });
});

/* ── The page and the agent read the same numbers ───────────────────── */

describe("page and agent parity", () => {
  it("list_state's totals and headline are the page's, examples left out", async () => {
    await import("@/lib/actions/tools/nps-csat");
    const { registry } = await import("@/lib/actions/registry");
    const real = [...many("nps", "2026-09-10", 10, 6), ...many("csat", "2026-10-11", 12, 9)];
    useWorkspaceStore.setState({ npsResponses: real });
    const action = registry.get("tool.nps_csat.list_state")!;
    const state = (await action.handler!(action.paramsSchema.parse({}), {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    })) as {
      nps: { score: number | null };
      csat: { satisfiedPct: number | null };
      headline: { nps: { score: number } | null; csat: { satisfiedPct: number } | null };
    };
    const { points } = periodSeries(real, "month", { through: TODAY });
    expect(state.nps.score).toBe(summarizeNps(real).score);
    expect(state.csat.satisfiedPct).toBe(summarizeCsat(real).satisfiedPct);
    expect(state.headline.nps?.score).toBe(latestEnough(points, "nps")?.nps.score);
    expect(state.headline.csat?.satisfiedPct).toBe(75);

    renderPage();
    expect(screen.getByText("+20")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();

    // With the example loaded the page previews it; the agent still reads the team's own.
    act(() => useWorkspaceStore.setState({ npsResponses: [...real, ...buildExample(NOW)] }));
    const again = (await action.handler!(action.paramsSchema.parse({}), {
      userId: "u",
      source: "agent",
      squadProfileIds: [],
    })) as { total: number };
    expect(again.total).toBe(real.length);
  });
});
