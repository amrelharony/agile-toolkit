/**
 * tool.code_review_metrics.* in working hours (Phase 8), on both transports:
 *
 *   1. list_state — medians in working hours from the team calendar and the
 *      log's window, equal to lib/quality/review; P85 from 5; size bands;
 *      the legacy invalid row; the old means kept.
 *   2. add_sample — firstReviewAt, the page's checks naming each field,
 *      wall-clock storage, duplicate PR numbers.
 *   3. remove_sample, set_working_window.
 *   4. the browser and the server give the same answers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  CEREMONY_CADENCE_ID,
  type CeremonyCadenceDoc,
  type CodeReviewLog,
  type PrSample,
} from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";
import {
  CODE_REVIEW_LOG_ID,
  CODE_REVIEW_LOG_KIND,
  reviewSummary,
  reviewVerdict,
  windowMinutes,
} from "@/lib/quality/review";
import { CODE_REVIEW_LOG } from "../stores/phase8-fixtures";

import "@/lib/actions/tools/code-review-metrics";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
type Path = "handler" | "mcpHandler";
const PATHS: Path[] = ["handler", "mcpHandler"];
const run = <T>(path: Path, verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.code_review_metrics.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

/** A team that has Monday 19 October 2026 off. */
const CADENCE = { ...DEFAULT_CADENCE, holidays: ["2026-10-19"] } as CeremonyCadenceDoc;

function seed(path: Path, doc: CodeReviewLog, cadence?: CeremonyCadenceDoc) {
  if (path === "handler") {
    useWorkspaceStore.setState({
      codeReviewLogs: [doc],
      ceremonyCadences: cadence ? [{ ...cadence, id: CEREMONY_CADENCE_ID }] : [],
    });
  } else {
    rows.set(`${CODE_REVIEW_LOG_KIND}/${CODE_REVIEW_LOG_ID}`, doc);
    if (cadence) {
      rows.set(`workspace:ceremonyCadence/${CEREMONY_CADENCE_ID}`, {
        ...cadence,
        id: CEREMONY_CADENCE_ID,
      });
    }
  }
}

function stored(path: Path): CodeReviewLog | undefined {
  return path === "handler"
    ? (useWorkspaceStore.getState().codeReviewLogs ?? []).find((d) => d.id === CODE_REVIEW_LOG_ID)
    : (rows.get(`${CODE_REVIEW_LOG_KIND}/${CODE_REVIEW_LOG_ID}`) as CodeReviewLog | undefined);
}

let k = 0;
/** A merged PR opened Monday 19 Oct 09:00, merged `hours` later the same day. */
const merged = (hours: number, lines = 50): PrSample => ({
  id: `m_${(k += 1)}`,
  author: "Dana",
  openedAt: "2026-10-19T09:00",
  firstReviewAt: "2026-10-19T09:30",
  mergedAt: `2026-10-19T${String(9 + hours).padStart(2, "0")}:00`,
  reviewerCount: 1,
  commentCount: 1,
  linesChanged: lines,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T10:00:00"));
  rows.clear();
  useWorkspaceStore.setState({ codeReviewLogs: [], ceremonyCadences: [] });
});
afterEach(() => vi.useRealTimers());

interface State {
  total: number;
  mergedCount: number;
  openCount: number;
  invalidCount: number;
  medianCycleWorkingHours: number | null;
  medianFirstReviewWorkingHours: number | null;
  medianCycleHours: number | null;
  p85CycleWorkingHours: number | null;
  workingBasis: { label: string; holidays: number; window: { start: string; end: string } | null };
  bySize: { band: string; n: number; medianCycleWorkingHours: number | null }[];
  weekly: { week: string; n: number }[];
  verdict: string;
  avgCycleTimeHours: number | null;
  avgReviewers: number | null;
}

describe("tool.code_review_metrics — registration", () => {
  it("remove_sample and set_working_window write, without confirmation, on both paths", () => {
    for (const verb of ["add_sample", "remove_sample", "set_working_window"]) {
      const action = registry.get(`tool.code_review_metrics.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
      expect(action?.requiresConfirmation, verb).toBe(false);
    }
  });
});

describe.each(PATHS)("tool.code_review_metrics.list_state (%s)", (path) => {
  it("counts the weekend and the team's holiday out of a review", async () => {
    // Fixture pr_1: Friday 16 Oct 16:30 → first review Monday 19 Oct 09:15
    // → merged 14:00, inside a 09:00–17:30 window. With that Monday a
    // holiday, its working time is only Friday's last hour.
    seed(path, CODE_REVIEW_LOG, CADENCE);
    const r = await run<State>(path, "list_state");
    expect(r).toMatchObject({ total: 2, mergedCount: 1, openCount: 0, invalidCount: 1 });
    // One merged PR: too few for a median, overall or for its week.
    expect(r.medianCycleWorkingHours).toBeNull();
    expect(r.weekly).toEqual([{ week: "2026-W43", n: 1, medianCycleWorkingHours: null }]);
    expect(r.workingBasis).toEqual({
      label: "Mon–Fri, holidays excluded, 09:00–17:30",
      workingDays: [1, 2, 3, 4, 5],
      holidays: 1,
      window: { start: "09:00", end: "17:30" },
    });
    // The legacy row merged before it opened: not an elapsed cycle either.
    expect(r.avgCycleTimeHours).toBe(69.5);
    expect(r.avgReviewers).toBe(1.5);
  });

  it("quotes nearest-rank medians in working hours, and P85 from 5", async () => {
    seed(path, {
      id: CODE_REVIEW_LOG_ID,
      samples: [merged(1), merged(2), merged(3), merged(4), merged(8, 900)],
    });
    const r = await run<State>(path, "list_state");
    expect(r.medianCycleWorkingHours).toBe(3);
    expect(r.medianFirstReviewWorkingHours).toBe(0.5);
    expect(r.medianCycleHours).toBe(3);
    expect(r.p85CycleWorkingHours).toBe(8);
    expect(r.bySize.map((b) => [b.band, b.n, b.medianCycleWorkingHours])).toEqual([
      ["small", 4, 2],
      ["medium", 0, null],
      ["large", 1, null],
    ]);
    expect(r.weekly).toEqual([{ week: "2026-W43", n: 5, medianCycleWorkingHours: 3 }]);
    expect(r.workingBasis.label).toBe("Mon–Fri, whole days");
  });

  it("equals the library on the same samples and calendar", async () => {
    seed(path, CODE_REVIEW_LOG, CADENCE);
    const r = await run<State>(path, "list_state");
    const s = reviewSummary(
      CODE_REVIEW_LOG.samples,
      { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-19"] },
      windowMinutes(CODE_REVIEW_LOG.workingWindow)
    );
    expect(r.verdict).toBe(reviewVerdict(s));
    expect(r.invalidCount).toBe(s.invalid);
  });
});

describe.each(PATHS)("tool.code_review_metrics.add_sample (%s)", (path) => {
  const base = {
    author: "@erin",
    openedAt: "2026-10-22T10:00",
    reviewerCount: 2,
    commentCount: 4,
    linesChanged: 230,
  };

  it("stores a first review, the author without '@', times as wall-clock", async () => {
    const r = await run<{ added: boolean; id: string }>(path, "add_sample", {
      ...base,
      prNumber: "501",
      firstReviewAt: "2026-10-22T13:00:00Z",
      mergedAt: "2026-10-23T09:00",
    });
    expect(r.added).toBe(true);
    expect(stored(path)?.samples[0]).toEqual({
      id: r.id,
      author: "erin",
      prNumber: "501",
      openedAt: "2026-10-22T10:00",
      firstReviewAt: "2026-10-22T13:00",
      mergedAt: "2026-10-23T09:00",
      reviewerCount: 2,
      commentCount: 4,
      linesChanged: 230,
    });
  });

  it("refuses dates out of order or unreadable, naming each field", async () => {
    const r = await run<{ added: boolean; reason: string; message: string }>(path, "add_sample", {
      ...base,
      firstReviewAt: "2026-10-22T09:00",
      mergedAt: "2026-10-21T09:00",
    });
    expect(r).toMatchObject({ added: false, reason: "invalid" });
    expect(r.message).toBe(
      "firstReviewAt: The first review can't come before it was opened. mergedAt: It can't be merged before it was opened."
    );
    expect(await run(path, "add_sample", { ...base, openedAt: "last Tuesday" })).toMatchObject({
      message: "openedAt: Enter a date and time as YYYY-MM-DDTHH:MM.",
    });
    expect(await run(path, "add_sample", { ...base, openedAt: "2027-01-01T09:00" })).toMatchObject({
      message: "openedAt: That's in the future.",
    });
    expect(stored(path)).toBeUndefined();
  });

  it("refuses a PR number already logged", async () => {
    seed(path, CODE_REVIEW_LOG);
    expect(await run(path, "add_sample", { ...base, prNumber: "412" })).toEqual({
      added: false,
      reason: "duplicate",
      id: "pr_1",
    });
  });
});

describe.each(PATHS)(
  "tool.code_review_metrics.remove_sample and set_working_window (%s)",
  (path) => {
    it("removes a sample by id", async () => {
      seed(path, CODE_REVIEW_LOG);
      expect(await run(path, "remove_sample", { sampleId: "pr_legacy" })).toEqual({
        removed: true,
      });
      expect(stored(path)?.samples.map((s) => s.id)).toEqual(["pr_1"]);
      expect(stored(path)?.workingWindow).toEqual({ start: "09:00", end: "17:30" });
      expect(await run(path, "remove_sample", { sampleId: "pr_legacy" })).toEqual({
        removed: false,
        reason: "not_found",
      });
    });

    it("sets, refuses and clears the window, keeping the samples", async () => {
      seed(path, CODE_REVIEW_LOG);
      expect(await run(path, "set_working_window", { start: "08:30", end: "16:30" })).toEqual({
        updated: true,
        workingWindow: { start: "08:30", end: "16:30" },
      });
      expect(await run(path, "set_working_window", { start: "17:00", end: "09:00" })).toMatchObject(
        {
          updated: false,
          reason: "invalid_window",
          message: "The window must end after it starts.",
        }
      );
      expect(await run(path, "set_working_window", { start: "09:00" })).toMatchObject({
        reason: "invalid_window",
      });
      expect(await run(path, "set_working_window", {})).toEqual({
        updated: true,
        workingWindow: null,
      });
      expect(stored(path)?.workingWindow).toBeUndefined();
      expect(stored(path)?.samples).toHaveLength(2);
    });
  }
);

describe("tool.code_review_metrics — both transports agree", () => {
  it("list_state reads the same log and calendar the same way", async () => {
    seed("handler", CODE_REVIEW_LOG, CADENCE);
    seed("mcpHandler", CODE_REVIEW_LOG, CADENCE);
    expect(await run("handler", "list_state")).toEqual(await run("mcpHandler", "list_state"));
  });
});
