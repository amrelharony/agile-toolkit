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
const prompted = vi.hoisted(() => ({ prompts: [] as { id: string; prompt: string }[] }));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { id: string; prompt: string }[] } }) => {
    prompted.prompts = config.prompts;
    return null;
  },
}));
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
import { npsCsatPrompts, promptHeadline } from "@/app/(tools)/nps-csat/prompt";
import { responseName } from "@/app/(tools)/nps-csat/response-row";
import { hypothesisTag, recentResponses } from "@/app/(tools)/nps-csat/tags";

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
  prompted.prompts = [];
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
      validateResponse({ ...emptyResponse(TODAY, "nps"), score: 7.5 }, TODAY, {
        keepScore: 7.5,
        keepKind: "nps",
      }).ok
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
    // Shown above the headline and beside the list heading alike.
    expect(screen.getAllByRole("button", { name: "Show every response" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Show every response" })[1]);
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
    fireEvent.click(screen.getByRole("button", { name: "Remove NPS 9 of 2026-10-20, acme-admin" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Edit CSAT 3.5 of 2026-08-02" }));
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

/* ── Review fixes ───────────────────────────────────────────────────── */

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const editForm = () =>
  within(screen.getByRole("button", { name: "Save response" }).closest("form") as HTMLElement);

describe("a stored score stays on its own survey", () => {
  it("is kept only on the survey it was given for", () => {
    const asCsat = validateResponse({ ...emptyResponse(TODAY, "csat"), score: 8 }, TODAY, {
      keepScore: 8,
      keepKind: "nps",
    });
    expect(!asCsat.ok && asCsat.errors.score).toMatch(/CSAT is 1–5/);
    // Without its survey a kept score is never waved through.
    expect(
      validateResponse({ ...emptyResponse(TODAY, "nps"), score: 7.5 }, TODAY, { keepScore: 7.5 }).ok
    ).toBe(false);
  });

  it("isn't offered as a custom CSAT score when an NPS 8 is switched to CSAT", () => {
    useWorkspaceStore.setState({
      npsResponses: [resp("nps", "2026-10-20", 8, { respondent: "ana" })],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit NPS 8 of 2026-10-20, ana" }));
    fireEvent.click(editForm().getByRole("radio", { name: "CSAT (1–5)" }));
    expect(editForm().queryByRole("radio", { name: /Custom/ })).toBeNull();
    fireEvent.click(editForm().getByRole("button", { name: "Save response" }));
    expect(stored()[0]).toMatchObject({ kind: "nps", score: 8 });
    expect(editForm().getByText("Pick the score the customer gave.")).toBeInTheDocument();
  });

  it("offers a legacy fraction again back on its own survey, and saves it there", () => {
    useWorkspaceStore.setState({ npsResponses: [resp("nps", "2026-10-20", 7.5)] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit NPS 7.5 of 2026-10-20" }));
    expect(editForm().getByRole("radio", { name: "Custom: 7.5" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.click(editForm().getByRole("radio", { name: "CSAT (1–5)" }));
    expect(editForm().queryByRole("radio", { name: /Custom/ })).toBeNull();
    fireEvent.click(editForm().getByRole("radio", { name: "NPS (0–10)" }));
    fireEvent.click(editForm().getByRole("radio", { name: "Custom: 7.5" }));
    fireEvent.click(editForm().getByRole("button", { name: "Save response" }));
    expect(stored()[0]).toMatchObject({ kind: "nps", score: 7.5 });
  });
});

describe("the import checks each row as its edit form would", () => {
  const opts = (kind: "nps" | "csat" | null = null) => ({ kind, today: TODAY, existing: [] });

  it("refuses a row wider than its header instead of shifting its cells", () => {
    const csv = [
      "date,score,verbatim,tags",
      "2026-10-01,9,Fast delivery, but pricey,pricing",
      "2026-10-02,9,ok,,",
      '2026-10-03,9,"Fast delivery, but pricey",pricing',
    ].join("\n");
    const p = previewImport(csv, opts("nps"));
    expect(p.skipped).toEqual([
      {
        line: 2,
        reason: "it has 5 cells but the header names 4: put text that contains commas in quotes",
      },
    ]);
    // Trailing blank cells are fine; a quoted comma stays in its cell.
    expect(p.ready.map((r) => [r.line, r.response.verbatim, r.response.tags])).toEqual([
      [3, "ok", undefined],
      [4, "Fast delivery, but pricey", ["pricing"]],
    ]);
    const tsv = previewImport("date\tscore\n2026-10-01\t9\tstray", opts("nps"));
    expect(tsv.skipped[0].reason).toBe(
      "it has 3 cells but the header names 2: put text that contains tabs in quotes"
    );
  });

  it("reads a timestamp written with a space as its day", () => {
    const p = previewImport(
      "date,score\n2026-10-03 14:20:00,9\n2026-10-04 14:20,8\n2026-10-05 25:00,7",
      opts("nps")
    );
    expect(p.ready.map((r) => r.response.date)).toEqual(["2026-10-03", "2026-10-04"]);
    expect(p.skipped).toEqual([
      { line: 4, reason: "the date “2026-10-05 25:00” isn't YYYY-MM-DD" },
    ]);
  });

  it("refuses a respondent or a verbatim longer than the form saves", () => {
    const csv = [
      "date,score,respondent,verbatim",
      `2026-10-01,9,${"r".repeat(121)},`,
      `2026-10-01,9,,${"v".repeat(4001)}`,
      `2026-10-01,9,${"r".repeat(120)},${"v".repeat(4000)}`,
    ].join("\n");
    const p = previewImport(csv, opts("nps"));
    expect(p.skipped).toEqual([
      { line: 2, reason: "the respondent is longer than 120 characters" },
      { line: 3, reason: "the verbatim is longer than 4000 characters" },
    ]);
    // What is imported can be edited and saved as it is.
    const [row] = p.ready;
    expect(validateResponse(responseDraft({ id: "x", ...row.response }), TODAY).ok).toBe(true);
  });
});

describe("the import panel", () => {
  const openImport = () => fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
  const kindGroup = () => within(screen.getByRole("radiogroup", { name: "Every row is" }));
  const picked = () => kindGroup().queryByRole("radio", { checked: true });
  const pickNps = () => fireEvent.click(kindGroup().getByRole("radio", { name: "NPS (0–10)" }));

  it("asks for the survey again for each new file, pasted text or cleared text", async () => {
    renderPage();
    openImport();
    const paste = screen.getByLabelText("Or paste rows") as HTMLTextAreaElement;
    fireEvent.change(paste, { target: { value: "date\tscore\n2026-10-01\t9" } });
    pickNps();
    expect(picked()).not.toBeNull();
    // Typing on keeps the pick.
    fireEvent.change(paste, { target: { value: `${paste.value}\n2026-10-02\t8` } });
    expect(picked()).not.toBeNull();
    // Pasted over the whole text: another file.
    paste.setSelectionRange(0, paste.value.length);
    fireEvent.paste(paste);
    fireEvent.change(paste, { target: { value: "date\tscore\n2026-10-03\t4" } });
    expect(picked()).toBeNull();
    // Cleared, then new rows: picked afresh.
    pickNps();
    fireEvent.change(paste, { target: { value: "" } });
    fireEvent.change(paste, { target: { value: "date\tscore\n2026-10-04\t4" } });
    expect(picked()).toBeNull();
    // A file chosen next is picked afresh too.
    pickNps();
    const file = new File(["date,score\n2026-10-05,4"], "csat.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
    await vi.waitFor(() => expect(paste.value).toContain("2026-10-05"));
    expect(picked()).toBeNull();
  });

  it("hands focus back to Import CSV when it closes", async () => {
    renderPage();
    openImport();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(screen.getByRole("button", { name: "Import CSV" })).toHaveFocus();
    expect(screen.queryByLabelText("Or paste rows")).toBeNull();
  });
});

describe("the Hypothesis Tracker pointer", () => {
  const unhappy = (date: string, n: number) =>
    Array.from({ length: n }, () => resp("nps", date, 2, { tags: ["checkout"] }));

  it("reads the last 90 days only", () => {
    expect(
      recentResponses(
        [resp("nps", "2026-07-30", 9), resp("nps", "2026-07-29", 9), resp("nps", "", 9)],
        TODAY
      ).map((r) => r.date)
    ).toEqual(["2026-07-30"]);
    expect(hypothesisTag(unhappy("2026-07-01", 5), TODAY)).toBeNull();
    expect(
      hypothesisTag([...unhappy("2026-07-01", 5), ...unhappy("2026-10-01", 2)], TODAY)
    ).toBeNull();
    expect(hypothesisTag(unhappy("2026-10-01", 3), TODAY)).toMatchObject({
      tag: "checkout",
      unhappy: 3,
    });
  });

  it("shows on the page for recent complaints, not for old ones", () => {
    useWorkspaceStore.setState({ npsResponses: unhappy("2026-06-01", 4) });
    const { unmount } = renderPage();
    expect(screen.queryByRole("link", { name: "test a fix in the Hypothesis Tracker" })).toBeNull();
    unmount();
    useWorkspaceStore.setState({ npsResponses: unhappy("2026-10-01", 3) });
    renderPage();
    expect(
      screen.getByText(/In the last 90 days, most unhappy answers mention “checkout” \(3\)/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "test a fix in the Hypothesis Tracker" })
    ).toHaveAttribute("href", "/hypothesis-tracker");
  });
});

describe("the AI prompt", () => {
  it("never reads a survey with no answers as 0, and quotes CSAT as % satisfied", () => {
    const csatOnly = [
      resp("csat", "2026-10-01", 5, { verbatim: "Great" }),
      resp("csat", "2026-10-02", 2),
    ];
    const themes = npsCsatPrompts(csatOnly, summarizeNps(csatOnly), summarizeCsat(csatOnly)).find(
      (p) => p.id === "nps-themes"
    )!.prompt;
    expect(themes).toContain("No NPS responses. CSAT 50% satisfied (4–5) from 2 responses.");
    expect(themes).not.toMatch(/Current NPS|CSAT avg/);
    expect(promptHeadline(summarizeNps([]), summarizeCsat([]))).toBe(
      "No NPS responses. No CSAT responses."
    );
    expect(npsCsatPrompts([], summarizeNps([]), summarizeCsat([]))).toEqual([]);
  });

  it("gets the numbers the page shows", () => {
    useWorkspaceStore.setState({ npsResponses: many("nps", "2026-10-10", 10, 6) });
    renderPage();
    const themes = prompted.prompts.find((p) => p.id === "nps-themes")!.prompt;
    expect(themes).toContain("NPS +20 from 10 responses. No CSAT responses.");
  });
});

describe("a page left open past midnight", () => {
  it("moves the forms on to the new day", () => {
    renderPage();
    const day = () => addForm().getByLabelText(/^Day/);
    expect(day()).toHaveAttribute("max", TODAY);
    vi.setSystemTime(new Date(2026, 9, 28, 0, 5));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(day()).toHaveAttribute("max", "2026-10-28");
  });
});

describe("row buttons", () => {
  it("name each response apart, even many on one day", () => {
    expect(responseName(resp("nps", "2026-10-03", 9, { respondent: "ana@x.io" }))).toBe(
      "NPS 9 of 2026-10-03, ana@x.io"
    );
    expect(
      responseName(
        resp("csat", "2026-10-03", 2, {
          verbatim: "Charged twice for one order, and nobody answered",
        })
      )
    ).toBe("CSAT 2 of 2026-10-03, “Charged twice for one order, an…”");
    expect(responseName(resp("nps", "", 4))).toBe("NPS 4 of no date");
  });
});

describe("focus", () => {
  it("an edit form takes focus when it opens and gives it back when it closes", () => {
    useWorkspaceStore.setState({ npsResponses: [NPS] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit NPS 9 of 2026-10-20, acme-admin" }));
    expect(editForm().getByRole("radio", { name: "NPS (0–10)" })).toHaveFocus();
    fireEvent.click(editForm().getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Edit NPS 9 of 2026-10-20, acme-admin" })
    ).toHaveFocus();
  });

  it("a delete moves focus to the next row, then to the add form when none is left", async () => {
    useWorkspaceStore.setState({
      npsResponses: [
        resp("nps", "2026-10-03", 9, { respondent: "ana" }),
        resp("nps", "2026-10-02", 4, { respondent: "bo" }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Remove NPS 9 of 2026-10-03, ana" }));
    await settle();
    const next = screen.getByRole("button", { name: "Remove NPS 4 of 2026-10-02, bo" });
    expect(next).toHaveFocus();
    fireEvent.click(next);
    await settle();
    expect(addForm().getByRole("radio", { name: "NPS (0–10)" })).toHaveFocus();
  });
});

describe("a tag filter on the headline", () => {
  it("says above the cards that every number is the tag's", () => {
    useWorkspaceStore.setState({
      npsResponses: [
        resp("nps", "2026-10-01", 2, { tags: ["checkout"] }),
        resp("nps", "2026-10-02", 10, { tags: ["delivery"] }),
      ],
    });
    renderPage();
    expect(screen.queryByText(/Showing only responses tagged/)).toBeNull();
    fireEvent.click(
      within(screen.getByRole("group", { name: "Filter by tag" })).getByRole("button", {
        name: /checkout/,
      })
    );
    expect(
      screen.getByText(
        /Showing only responses tagged “checkout”: every number below reads them alone/
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/^Tagged “checkout”: NPS -100 from 1 response/)).toBeInTheDocument();
    expect(
      screen.getByText("“checkout” only. All-time, 1 response: no month has 10 yet.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Show every response" })[0]);
    expect(screen.queryByText(/Showing only responses tagged/)).toBeNull();
  });
});

describe("the hollow-dot note", () => {
  it("shows only under a drawn chart", () => {
    useWorkspaceStore.setState({ npsResponses: many("nps", TODAY, 3, 2) });
    const { unmount } = renderPage();
    expect(screen.queryByText(/A hollow dot is a month/)).toBeNull();
    unmount();
    useWorkspaceStore.setState({
      npsResponses: [...many("nps", "2026-09-10", 3, 2), ...many("nps", TODAY, 3, 2)],
    });
    renderPage();
    expect(screen.getByText(/A hollow dot is a month/)).toBeInTheDocument();
  });
});
