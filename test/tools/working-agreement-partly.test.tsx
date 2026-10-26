import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Working Agreement: a check-in can find a rule partly working (kept some
 * of the time, or by some of the team). It counts as half in adherence, on
 * the page, in the export and for agents; the CRUD schema keeps it; a rule
 * partly working in a row is flagged like one not working, and says which.
 */

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});
vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/app/(tools)/working-agreement/charts", () => ({ AdherenceChart: () => null }));

import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  WORKING_AGREEMENT_ID,
  type CharterCheckIn,
  type CharterRule,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import {
  WA_ID,
  WA_KIND,
  adherenceCount,
  adherencePhrase,
  agreementVerdict,
  checkInAdherence,
  checkInTrend,
  draftCheckIn,
  draftCount,
  emptyAgreement,
  markOfResult,
  normalizeAgreement,
  notWorkingStreak,
  resultOfMark,
  slippingRun,
  withoutDraft,
} from "@/lib/working-agreement/model";
import { agreementMarkdown } from "@/app/(tools)/working-agreement/markdown";
import { adherenceChartText, adherencePoints } from "@/app/(tools)/working-agreement/trend";
import { WorkingAgreementClient } from "@/app/(tools)/working-agreement/working-agreement-client";
import "@/lib/actions/workspace";
import "@/lib/actions/tools/working-agreement";

const PUBLISHED = "2026-09-12T10:00:00.000Z";

const rule = (id: string, text: string, extra: Partial<CharterRule> = {}): CharterRule => ({
  id,
  category: "work",
  text,
  agreedBy: [],
  ...extra,
});
const round = (id: string, date: string, results: CharterCheckIn["results"]): CharterCheckIn => ({
  id,
  date,
  version: 1,
  results,
});

const ws = () => useWorkspaceStore.getState();
const stored = () => normalizeAgreement((ws().workingAgreements ?? []).find((d) => d.id === WA_ID));
const seed = (doc: Partial<WorkingAgreement>) =>
  useWorkspaceStore.setState({
    workingAgreements: [{ ...emptyAgreement(), ...doc } as WorkingAgreement],
    teamMembers: [],
    sprints: [],
    retroBoards: [],
  });

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = <T,>(path: "handler" | "mcpHandler", verb: string, params = {}) => {
  const action = registry.get(`tool.working_agreement.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx()) as Promise<T>;
};

beforeEach(() => {
  rows.clear();
  ws().resetWorkspace();
});

describe("the model counts partly as half", () => {
  it("scores a round with partly rules at half a rule each", () => {
    const a = checkInAdherence({
      results: { a: "working", b: "working", c: "partly", d: "not_working" },
    });
    // (2 + 0.5) of 4 = 62.5%, rounded.
    expect(a).toEqual({ checked: 4, working: 2, partly: 1, pct: 63 });
    expect(checkInAdherence({ results: { a: "partly", b: "partly" } }).pct).toBe(50);
    expect(adherencePhrase(a)).toBe("2 of 4 working, 1 partly");
    expect(adherenceCount(a)).toBe("2 of 4, 1 partly");
    expect(adherencePhrase(checkInAdherence({ results: { a: "working" } }))).toBe("1 of 1 working");
  });

  it("maps the draft mark and the saved result both ways", () => {
    expect([true, "partly", false].map((m) => resultOfMark(m as boolean | "partly"))).toEqual([
      "working",
      "partly",
      "not_working",
    ]);
    expect(markOfResult("partly")).toBe("partly");
    expect(markOfResult("working")).toBe(true);
    expect(markOfResult("not_working")).toBe(false);
  });

  it("keeps a partly mark and a partly result when reading a stored doc, and drops junk", () => {
    const doc = normalizeAgreement({
      id: WA_ID,
      meta: { version: 1 },
      rules: [
        { id: "r1", category: "work", text: "One", agreedBy: [], stillWorking: "partly" },
        { id: "r2", category: "work", text: "Two", agreedBy: [], stillWorking: "maybe" },
      ],
      checkIns: [{ id: "c1", date: "2026-10-01", version: 1, results: { r1: "partly", r2: "x" } }],
    });
    expect(doc.rules.map((r) => r.stillWorking)).toEqual(["partly", undefined]);
    expect(doc.checkIns?.[0].results).toEqual({ r1: "partly" });
  });

  it("saves a partly mark into the round and clears it with the draft", () => {
    const doc: WorkingAgreement = {
      ...emptyAgreement(),
      meta: { version: 1 },
      rules: [rule("r1", "One", { stillWorking: "partly" }), rule("r2", "Two")],
    };
    expect(draftCount(doc)).toBe(1);
    expect(draftCheckIn(doc, { id: "c1", date: "2026-10-01" })?.results).toEqual({
      r1: "partly",
    });
    expect(withoutDraft(doc).rules.map((r) => r.stillWorking)).toEqual([undefined, undefined]);
  });

  it("runs a slipping streak through partly rounds, broken only by a working one", () => {
    const doc = {
      checkIns: [
        round("c1", "2026-08-01", { r1: "working", r2: "partly" }),
        round("c2", "2026-09-01", { r1: "not_working", r2: "partly" }),
        round("c3", "2026-10-01", { r1: "partly" }),
      ],
    };
    expect(slippingRun(doc, "r1")).toEqual(["partly", "not_working"]);
    expect(notWorkingStreak(doc, "r1")).toBe(2);
    expect(slippingRun(doc, "r2")).toEqual(["partly", "partly"]);
  });

  it("says how many were partly in the verdict, the chart's table and the export", () => {
    const doc: WorkingAgreement = {
      ...emptyAgreement(),
      meta: { version: 1, publishedAt: PUBLISHED },
      rules: [rule("r1", "One"), rule("r2", "Two"), rule("r3", "Three")],
      checkIns: [
        round("c1", "2026-09-01", { r1: "working", r2: "working" }),
        round("c2", "2026-10-01", { r1: "working", r2: "partly", r3: "not_working" }),
      ],
    };
    expect(agreementVerdict(doc, [])).toContain("found 1 of 3 working, 1 partly.");
    const trend = checkInTrend(doc);
    const table = adherenceChartText(trend, () => undefined).table.rows;
    expect(table[1][3]).toBe("1 of 3, 1 partly");
    expect(table[1][4]).toBe("50%");
    expect(adherencePoints(trend)[1]).toMatchObject({ working: 1, partly: 1, checked: 3, pct: 50 });
    const md = agreementMarkdown(doc, []);
    expect(md).toContain("| 1 of 3, 1 partly | 50% |");
    expect(md).toContain("Not working in the last check-in (1 of 3 working, 1 partly): Three.");
    expect(md).toContain("Partly working: Two.");
    const onlyPartly = { ...doc, checkIns: [round("c1", "2026-10-01", { r1: "partly" })] };
    expect(agreementMarkdown(onlyPartly, [])).toContain(
      "Partly working in the last check-in (0 of 1 working, 1 partly): One."
    );
  });
});

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <WorkingAgreementClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

describe("the page's check-in offers Partly", () => {
  it("marks a rule Partly, saves the round, and reads it back at half", () => {
    seed({
      rules: [rule("r1", "One"), rule("r2", "Two")],
      meta: { version: 1, publishedAt: PUBLISHED },
    });
    renderPage();
    const one = screen.getByRole("radiogroup", { name: "This round: “One”" });
    expect(
      within(one)
        .getAllByRole("radio")
        .map((r) => r.textContent)
    ).toEqual(["Not checked", "Working", "Partly", "Not working"]);
    fireEvent.click(within(one).getByRole("radio", { name: "Partly" }));
    expect(stored().rules[0].stillWorking).toBe("partly");
    const two = screen.getByRole("radiogroup", { name: "This round: “Two”" });
    fireEvent.click(within(two).getByRole("radio", { name: "Working" }));
    expect(screen.getByText("2 of 2 rules marked in this round.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save check-in round" }));
    expect(stored().checkIns?.[0].results).toEqual({ r1: "partly", r2: "working" });
    expect(stored().rules.map((r) => r.stillWorking)).toEqual([undefined, undefined]);
    expect(screen.getByText(/1 of 2 working, 1 partly/, { selector: "span" })).toBeInTheDocument();
  });

  it("flags a rule partly working, and one slipping both ways, as not fully working", () => {
    seed({
      rules: [rule("r1", "One"), rule("r2", "Two"), rule("r3", "Three")],
      meta: { version: 1, publishedAt: PUBLISHED },
      checkIns: [
        round("c1", "2026-09-01", { r2: "not_working", r3: "not_working" }),
        round("c2", "2026-10-01", { r1: "partly", r2: "partly", r3: "not_working" }),
      ],
    });
    renderPage();
    expect(screen.getByText("Partly working in the last check-in")).toBeInTheDocument();
    expect(screen.getByText("Not fully working in the last 2 check-ins")).toBeInTheDocument();
    expect(screen.getByText("Not working in the last 2 check-ins")).toBeInTheDocument();
  });
});

describe("agents and the CRUD keep partly", () => {
  it("record_check_in takes partly, on both paths, and list_state counts it", async () => {
    seed({
      rules: [rule("r1", "One"), rule("r2", "Two", { stillWorking: "partly" })],
      meta: { version: 1, publishedAt: PUBLISHED },
    });
    const listed = await run<{ partlyWorkingCount: number }>("handler", "list_state");
    expect(listed.partlyWorkingCount).toBe(1);

    expect(
      await run("handler", "record_check_in", {
        results: [
          { ruleId: "r1", result: "working" },
          { ruleId: "r2", result: "partly" },
        ],
      })
    ).toMatchObject({ recorded: true, checked: 2, working: 1, partly: 1, pct: 75 });
    expect(stored().checkIns?.[0].results).toEqual({ r1: "working", r2: "partly" });

    rows.set(`${WA_KIND}/${WA_ID}`, {
      ...emptyAgreement(),
      meta: { version: 1 },
      rules: [rule("r1", "One")],
    });
    expect(
      await run("mcpHandler", "record_check_in", { results: [{ ruleId: "r1", result: "partly" }] })
    ).toMatchObject({ recorded: true, checked: 1, working: 0, partly: 1, pct: 50 });
    const last = await run<{ lastCheckIn: { partly: number; pct: number } }>(
      "mcpHandler",
      "list_state"
    );
    expect(last.lastCheckIn).toMatchObject({ partly: 1, pct: 50 });
  });

  it("the workspace.working_agreement schema keeps a partly mark and result", () => {
    const entity: WorkingAgreement = {
      id: WORKING_AGREEMENT_ID,
      meta: { version: 1 },
      rules: [rule("r1", "One", { stillWorking: "partly" })],
      checkIns: [round("c1", "2026-10-01", { r1: "partly" })],
    };
    const parsed = registry
      .get("workspace.working_agreement.create")!
      .paramsSchema.safeParse({ entity });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { entity: WorkingAgreement }).entity).toEqual(entity);
    expect(
      registry.get("workspace.working_agreement.create")!.paramsSchema.safeParse({
        entity: { ...entity, checkIns: [round("c1", "2026-10-01", { r1: "half" as "partly" })] },
      }).success
    ).toBe(false);
  });
});
