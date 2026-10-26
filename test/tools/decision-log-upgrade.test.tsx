import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DACIDecision, Decision, RAPIDDecision } from "@/lib/stores/workspace-types";
import { DECISION_LOG_KEY, DECISION_LOG_MOVED_KEY } from "@/lib/decisions/legacy-log";
import { allDecisions, decisionVerdict } from "@/lib/decisions/model";
import { syncEngine } from "@/lib/sync/engine";
import { registry } from "@/lib/actions/registry";

/**
 * Decision Log + DACI + RAPID, merged (Phase 7): one decision record for
 * the three routes, each opening its own form for New; numbered in one
 * sequence; people from the roster; options, outcome, decider and dates
 * (backdatable); superseded both ways; Undo on every lifecycle move and
 * delete; the one-time move of the old Decision Log blob and the DACI /
 * RAPID rows (idempotent, the old storage kept); the conflicts it finds;
 * `?id=`; Markdown, the verdict and the time to decide; and the agent
 * saying the same.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const migrationMode = vi.hoisted(() => ({ value: "off" as string }));
const signedIn = vi.hoisted(() => ({ value: null as { user: { id: string } } | null }));
const cloudRead = vi.hoisted(() => vi.fn(async () => null as Map<string, unknown> | null));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const loggedTool = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/data/use-legacy-migration-mode", () => ({
  useLegacyMigrationMode: () => migrationMode.value,
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => signedIn.value,
}));
vi.mock("@/lib/sync/cloud-blobs", () => ({ readCloudBlobs: cloudRead }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: (toolId: string) => {
    loggedTool.id = toolId;
    return {
      log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    };
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, filename }: { markdown?: string; filename: string }) => (
    <pre data-testid={`export-${filename}`}>{markdown}</pre>
  ),
}));

import { DecisionLogClient, readRecordParam } from "@/app/(tools)/decision-log/decision-log-client";
import DaciPage from "@/app/(tools)/daci/page";
import RapidPage from "@/app/(tools)/rapid-decision/page";
import { planDecisionMove } from "@/app/(tools)/decision-log/use-legacy-decisions";
import { buildExample } from "@/app/(tools)/decision-log/example";
import { decisionToMarkdown, decisionsToMarkdown } from "@/app/(tools)/decision-log/markdown";
import {
  decisionsCsv,
  recordName,
  reopenedDayError,
  replacementError,
  replacementsFor,
  toDaciRow,
  toRapidRow,
} from "@/app/(tools)/decision-log/view";
import {
  validateDecisionDraft,
  emptyDecisionDraft,
} from "@/app/(tools)/decision-log/decision-form";
import { validateDecide } from "@/app/(tools)/decision-log/decide-form";
import { ConflictNotice, withOldText } from "@/app/(tools)/decision-log/conflict-notice";
import "@/lib/actions/tools/decision-log";
import "@/lib/actions/tools/daci";
import "@/lib/actions/tools/rapid-decision";

/* ── Fixtures ───────────────────────────────────────────────────────── */

const TODAY = "2026-10-27";

const rec = (over: Partial<Decision> = {}): Decision => ({
  id: "d1",
  title: "Use Postgres for the event log",
  decision: "",
  status: "proposed",
  date: "2026-10-01",
  ...over,
});
const daciRow = (over: Partial<DACIDecision> = {}): DACIDecision => ({
  id: "daci-1",
  title: "Pick a flag vendor",
  driver: "Ana",
  approver: "Ben",
  contributors: ["Chen"],
  informed: [],
  options: ["LaunchDarkly", "Unleash"],
  recommendation: "Unleash",
  status: "open",
  date: "2026-09-20T09:00:00.000Z",
  ...over,
});
const rapidRow = (over: Partial<RAPIDDecision> = {}): RAPIDDecision => ({
  id: "rapid-1",
  title: "Weekly releases",
  recommend: "Priya",
  agree: ["Sam"],
  perform: [],
  input: [],
  decide: "Morgan",
  status: "decided",
  date: "2026-09-25T09:00:00.000Z",
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const all = () => allDecisions(ws().decisions, ws().daciDecisions, ws().rapidDecisions);
const find = (id: string) => all().find((d) => d.id === id);
const seed = (decisions: Decision[], daci: DACIDecision[] = [], rapid: RAPIDDecision[] = []) =>
  useWorkspaceStore.setState({
    decisions,
    daciDecisions: daci,
    rapidDecisions: rapid,
    teamMembers: [
      { id: "m1", name: "Ana" },
      { id: "m2", name: "Ben" },
    ],
    whiteboardObjects: [],
  });

const renderPage = (template?: "adr" | "daci" | "rapid") =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <DecisionLogClient template={template} />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const call = toastSpy.mock.calls.at(-1);
  const opts = call?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

/** The header button that opens a record (its name holds the label). */
const header = (label: string) => {
  const found = screen
    .getAllByRole("button", { name: new RegExp(label) })
    .filter((b) => b.closest("h3") && b.hasAttribute("aria-expanded"));
  expect(found).toHaveLength(1);
  return found[0];
};
const open = (label: string) => fireEvent.click(header(label));
const card = (id: string) => document.getElementById(`decision-${id}`) as HTMLElement;

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(id: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(id)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 9, 0, 0));
  toastSpy.mockReset();
  cloudRead.mockReset();
  cloudRead.mockResolvedValue(null);
  logs.length = 0;
  migrationMode.value = "off";
  signedIn.value = null;
  window.localStorage.removeItem(DECISION_LOG_KEY);
  window.localStorage.removeItem(DECISION_LOG_MOVED_KEY);
  window.history.replaceState(null, "", "/decision-log");
  seed([]);
});

afterEach(() => {
  vi.useRealTimers();
});

/* ── Routes ─────────────────────────────────────────────────────────── */

describe("each route opens its own form", () => {
  it("titles the page, logs under the route's tool and defaults New to its template", () => {
    renderPage("daci");
    expect(screen.getByRole("heading", { name: "DACI Decision Doc" })).toBeInTheDocument();
    expect(loggedTool.id).toBe("daci");
    fireEvent.click(screen.getAllByRole("button", { name: "New DACI" })[0]);
    expect(screen.getByRole("radio", { name: "DACI" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Add DACI record" })).toBeInTheDocument();
  });

  it("the old DACI and RAPID pages render the Decision Log in their form", () => {
    const daci = render(
      <LiveAnnouncerProvider>
        <TooltipProvider>
          <DaciPage />
        </TooltipProvider>
      </LiveAnnouncerProvider>
    );
    expect(screen.getByRole("heading", { name: "DACI Decision Doc" })).toBeInTheDocument();
    daci.unmount();
    render(
      <LiveAnnouncerProvider>
        <TooltipProvider>
          <RapidPage />
        </TooltipProvider>
      </LiveAnnouncerProvider>
    );
    expect(screen.getByRole("heading", { name: "RAPID Decision Matrix" })).toBeInTheDocument();
    expect(loggedTool.id).toBe("rapid-decision");
    expect(screen.getAllByRole("button", { name: "New RAPID" }).length).toBeGreaterThan(0);
  });

  it("every route lists every record, with a badge and a filter chip per form", () => {
    seed([
      rec({ id: "a", number: 1 }),
      rec({ id: "b", number: 2, template: "daci", title: "Vendor" }),
    ]);
    renderPage("rapid");
    expect(header("ADR-0001")).toBeInTheDocument();
    expect(header("DACI-0002")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^DACI\s*1$/ }));
    expect(screen.queryByRole("button", { name: /ADR-0001/ })).not.toBeInTheDocument();
    expect(header("DACI-0002")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^RAPID\s*0$/ }));
    expect(screen.getByText("No RAPID records yet.")).toBeInTheDocument();
  });
});

/* ── New records ────────────────────────────────────────────────────── */

describe("raising a record", () => {
  it("refuses a blank title and saves nothing", () => {
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: "New ADR" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Add ADR record" }));
    expect(screen.getByText("Give the decision a title.")).toBeInTheDocument();
    expect(ws().decisions).toEqual([]);
  });

  it("numbers it after the highest in the log, keeps the roster's spelling, and opens it", () => {
    seed([rec({ id: "old", number: 3 }), rec({ id: "example-x", number: 40 })]);
    renderPage("daci");
    fireEvent.click(screen.getAllByRole("button", { name: "New DACI" })[0]);
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Pick a vendor" } });
    fireEvent.change(screen.getByLabelText(/^Approver/), { target: { value: "ben" } });
    fireEvent.change(screen.getByLabelText(/^Driver/), { target: { value: "Ana" } });
    const contributors = screen.getByLabelText(/^Contributors/);
    fireEvent.change(contributors, { target: { value: "Chen" } });
    fireEvent.keyDown(contributors, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Add an option" }));
    fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: "Unleash" } });
    fireEvent.click(screen.getByRole("button", { name: "Add DACI record" }));

    const saved = ws().decisions.find((d) => d.title === "Pick a vendor")!;
    // Example rows (example-x holds 40) never count toward the team's sequence.
    expect(saved.number).toBe(4);
    expect(saved.template).toBe("daci");
    expect(saved.decider).toBe("Ben");
    expect(saved.roles).toEqual({ driver: ["Ana"], contributor: ["Chen"] });
    expect(saved.options).toEqual([{ id: `${saved.id}-o0`, text: "Unleash" }]);
    expect(saved.status).toBe("proposed");
    expect(saved.date).toBe(TODAY);
    expect(header("DACI-0004")).toHaveAttribute("aria-expanded", "true");
    expect(logs.at(-1)?.action).toBe("decision_added");
  });

  it("validates the draft on its own: dates, duplicate options, single roles", () => {
    const d = { ...emptyDecisionDraft("rapid", TODAY), title: "X" };
    const idFor = (i: number) => `n-o${i}`;
    expect(validateDecisionDraft({ ...d, date: "2026-11-01" }, { today: TODAY, idFor })).toEqual({
      ok: false,
      errors: { date: "Pick today or an earlier day." },
    });
    expect(validateDecisionDraft({ ...d, options: ["A", "a "] }, { today: TODAY, idFor }).ok).toBe(
      false
    );
    const ok = validateDecisionDraft(
      {
        ...d,
        date: "2026-09-01",
        roles: { recommend: ["A", "B"], agree: ["C"] },
        recommendation: "Go",
      },
      { today: TODAY, idFor }
    );
    expect(ok.ok && ok.values.roles).toEqual({ recommend: ["A"], agree: ["C"] });
    expect(ok.ok && ok.values.date).toBe("2026-09-01");
    // An ADR keeps no recommendation (its form has none).
    const adr = validateDecisionDraft(
      { ...emptyDecisionDraft("adr", TODAY), title: "Y", recommendation: "Z" },
      { today: TODAY, idFor }
    );
    expect(adr.ok && adr.values.recommendation).toBeUndefined();
  });
});

/* ── Lifecycle ──────────────────────────────────────────────────────── */

describe("deciding, superseding, carrying out, reopening", () => {
  it("DACI can't be decided until the Approver is named; deciding records the outcome, with Undo", () => {
    seed([
      rec({ id: "d1", number: 1, template: "daci", options: [{ id: "o1", text: "Unleash" }] }),
    ]);
    renderPage("daci");
    open("DACI-0001");
    fireEvent.click(screen.getByRole("button", { name: "Record the decision" }));
    const form = screen.getByRole("button", { name: "Record the decision" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^What was decided/), {
      target: { value: "We use Unleash." },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Record the decision" }));
    expect(within(form).getByText("Name the Approver before deciding.")).toBeInTheDocument();
    expect(find("d1")?.status).toBe("proposed");

    fireEvent.change(within(form).getByLabelText(/^Approver/), { target: { value: "Ben" } });
    fireEvent.change(within(form).getByLabelText(/^Option chosen/), { target: { value: "o1" } });
    fireEvent.change(within(form).getByLabelText(/^Decided on/), {
      target: { value: "2026-10-20" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Record the decision" }));
    expect(find("d1")).toMatchObject({
      status: "accepted",
      decision: "We use Unleash.",
      decider: "Ben",
      chosenOptionId: "o1",
      decidedAt: "2026-10-20",
    });
    expect(logs.at(-1)?.action).toBe("decision_decided");
    undoLast();
    expect(find("d1")?.status).toBe("proposed");
    expect(find("d1")?.decision).toBe("");
  });

  it("refuses a decided day before the record was raised or in the future", () => {
    const d = rec({ date: "2026-10-10", template: "adr" });
    const draft = { outcome: "Go", chosenOptionId: "", decider: "", date: "2026-10-01" };
    expect(validateDecide(d, draft, TODAY).ok).toBe(false);
    expect(validateDecide(d, { ...draft, date: "2026-10-28" }, TODAY).ok).toBe(false);
    expect(validateDecide(d, { ...draft, date: "2026-10-12" }, TODAY)).toEqual({
      ok: true,
      values: { outcome: "Go", date: "2026-10-12" },
    });
    // Every problem at once, not one per press.
    const both = validateDecide(rec({ template: "rapid" }), { ...draft, outcome: " " }, TODAY);
    expect(both.ok === false && Object.keys(both.errors).sort()).toEqual(["decider", "outcome"]);
  });

  it("supersedes both ways, and Undo takes it back", () => {
    seed([
      rec({ id: "old", number: 1, status: "accepted", decision: "Heroku" }),
      rec({ id: "new", number: 2, status: "accepted", decision: "ECS", title: "Move to ECS" }),
    ]);
    renderPage();
    open("ADR-0001");
    const old = card("old");
    fireEvent.change(within(old).getByLabelText("The record that replaces ADR-0001"), {
      target: { value: "new" },
    });
    fireEvent.click(within(old).getByRole("button", { name: "Supersede" }));
    expect(find("old")).toMatchObject({ status: "superseded", supersededBy: "new" });
    expect(within(old).getByRole("button", { name: /Superseded by ADR-0002/ })).toBeInTheDocument();
    open("ADR-0002");
    expect(
      within(card("new")).getByRole("button", { name: /Supersedes ADR-0001/ })
    ).toBeInTheDocument();
    undoLast();
    expect(find("old")?.status).toBe("accepted");
    expect(find("old")?.supersededBy).toBeUndefined();
  });

  it("only offers a replacement of the same kind (the example's for the example)", () => {
    const list = [rec({ id: "a" }), rec({ id: "b" }), rec({ id: "example-c" })];
    expect(replacementsFor(list, list[0]).map((d) => d.id)).toEqual(["b"]);
    expect(replacementsFor(list, list[2])).toEqual([]);
  });

  it("marks a DACI decision carried out, and reopens it as 'revisit'", () => {
    seed([
      rec({
        id: "d1",
        number: 1,
        template: "daci",
        status: "accepted",
        decision: "Go",
        decider: "Ben",
        decidedAt: "2026-10-05",
      }),
    ]);
    renderPage("daci");
    open("DACI-0001");
    fireEvent.click(screen.getByRole("button", { name: "Mark carried out" }));
    expect(find("d1")?.implementedAt).toBe(TODAY);
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(find("d1")).toMatchObject({ status: "proposed", reopenedAt: TODAY });
    expect(find("d1")?.implementedAt).toBeUndefined();
    undoLast();
    expect(find("d1")?.status).toBe("accepted");
  });
});

/* ── Legacy rows, delete ────────────────────────────────────────────── */

describe("old DACI and RAPID rows", () => {
  it("read through as records; an edit saves a Decision under the same id and keeps the old row", () => {
    seed([], [daciRow()], [rapidRow()]);
    renderPage("daci");
    // Unnumbered until the move runs (it's off here).
    expect(screen.getAllByRole("button", { name: /Unnumbered/ })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Pick a flag vendor/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: /Approver: Ben/ }));
    const input = screen.getByLabelText(/^Approver/);
    fireEvent.change(input, { target: { value: "Ana" } });
    fireEvent.submit(input.closest("form")!);
    const saved = ws().decisions.find((d) => d.id === "daci-1")!;
    expect(saved).toMatchObject({
      template: "daci",
      decider: "Ana",
      roles: { driver: ["Ana"], contributor: ["Chen"] },
      date: "2026-09-20",
    });
    expect(ws().daciDecisions).toEqual([daciRow()]);
  });

  it("delete removes the id from all three collections, with Undo", () => {
    seed([rec({ id: "daci-1", number: 2, template: "daci", title: "Shadow" })], [daciRow()]);
    renderPage();
    open("DACI-0002");
    fireEvent.click(screen.getByRole("button", { name: "Delete DACI-0002: Shadow" }));
    expect(ws().decisions).toEqual([]);
    expect(ws().daciDecisions).toEqual([]);
    expect(find("daci-1")).toBeUndefined();
    undoLast();
    expect(ws().decisions.map((d) => d.id)).toEqual(["daci-1"]);
    expect(ws().daciDecisions?.map((d) => d.id)).toEqual(["daci-1"]);
  });
});

/* ── The one-time move ──────────────────────────────────────────────── */

describe("the one-time move", () => {
  it("plans: blob rows added and filled, DACI/RAPID copied, everything numbered oldest first", () => {
    const stored = [
      rec({
        id: "both",
        title: "Both",
        date: "2026-08-01",
        context: "",
        decision: "",
        status: "proposed",
      }),
    ];
    const blob = [
      {
        id: "both",
        title: "Both",
        context: "From the old page",
        status: "accepted",
        decision: "Go",
        date: "2026-08-01",
      },
      { id: "only-blob", title: "Blob only", status: "proposed", date: "2026-07-01" },
    ];
    const plan = planDecisionMove(stored, [daciRow()], [rapidRow()], blob, []);
    const byId = new Map(plan.writes.map((d) => [d.id, d]));
    expect(byId.get("both")).toMatchObject({
      context: "From the old page",
      status: "accepted",
      decision: "Go",
    });
    expect(byId.get("only-blob")?.title).toBe("Blob only");
    expect(byId.get("daci-1")?.template).toBe("daci");
    expect(byId.get("rapid-1")).toMatchObject({
      template: "rapid",
      status: "accepted",
      decider: "Morgan",
    });
    // Oldest day first: only-blob (07-01), both (08-01), daci (09-20), rapid (09-25).
    expect(["only-blob", "both", "daci-1", "rapid-1"].map((id) => byId.get(id)?.number)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(plan.moved).toEqual(["both", "only-blob"]);
    expect(plan.movedChanged).toBe(true);
  });

  it("is idempotent: run on its own result it writes nothing", () => {
    const blob = [{ id: "b", title: "B", status: "accepted", decision: "Go", date: "2026-07-01" }];
    const first = planDecisionMove([], [daciRow()], [], blob, []);
    const again = planDecisionMove(first.writes, [daciRow()], [], blob, first.moved);
    expect(again.writes).toEqual([]);
    expect(again.movedChanged).toBe(false);
    // And when only the moved-ids write was lost: nothing new either.
    const lost = planDecisionMove(first.writes, [daciRow()], [], blob, []);
    expect(lost.writes).toEqual([]);
  });

  it("never lets the blob undo a newer workspace row (one saved since the merge)", () => {
    const stored = [
      rec({ id: "x", status: "proposed", number: 7, reopenedAt: "2026-10-20", decision: "Old" }),
    ];
    const blob = [
      {
        id: "x",
        title: "Use Postgres for the event log",
        status: "accepted",
        decision: "Old",
        date: "2026-10-01",
      },
    ];
    const plan = planDecisionMove(stored, [], [], blob, []);
    expect(plan.writes).toEqual([]);
    expect(plan.moved).toEqual(["x"]);
  });

  it("runs once on the page: one write, the moved ids recorded, the blob and old rows kept", async () => {
    const blob = [
      { id: "b", title: "Blob row", status: "proposed", date: "2026-07-01", decision: "" },
    ];
    window.localStorage.setItem(DECISION_LOG_KEY, JSON.stringify(blob));
    seed([], [daciRow()], []);
    migrationMode.value = "local";
    const first = renderPage();
    expect(ws().decisions.map((d) => [d.id, d.number])).toEqual([
      ["daci-1", 2],
      ["b", 1],
    ]);
    expect(ws().daciDecisions).toEqual([daciRow()]);
    expect(JSON.parse(window.localStorage.getItem(DECISION_LOG_KEY)!)).toEqual(blob);
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(DECISION_LOG_MOVED_KEY) ?? "[]")).toEqual(["b"])
    );
    first.unmount();

    // Deleted after the move, it stays deleted on the next visit.
    act(() => ws().removeDecision("b"));
    renderPage();
    expect(ws().decisions.map((d) => d.id)).toEqual(["daci-1"]);
  });

  it("plans the owner's move on the cloud's copy once the first pull is done", async () => {
    window.localStorage.setItem(
      DECISION_LOG_KEY,
      JSON.stringify([{ id: "c", title: "Stale", date: "2026-07-01" }])
    );
    cloudRead.mockResolvedValue(
      new Map<string, unknown>([
        [DECISION_LOG_KEY, [{ id: "c", title: "Renamed elsewhere", date: "2026-07-01" }]],
      ])
    );
    migrationMode.value = "cloud";
    signedIn.value = { user: { id: "owner" } };
    const ready = vi.spyOn(syncEngine, "whenReady").mockResolvedValue(undefined);
    try {
      renderPage();
      await waitFor(() =>
        expect(ws().decisions.map((d) => d.title)).toEqual(["Renamed elsewhere"])
      );
      expect(cloudRead).toHaveBeenCalledWith("owner", [DECISION_LOG_KEY, DECISION_LOG_MOVED_KEY]);
    } finally {
      ready.mockRestore();
    }
  });

  it("shows text edited on the old page once, with Keep or Use the old text (Undo)", async () => {
    seed([
      rec({ id: "x", context: "Workspace context", title: "Same" }),
      rec({ id: "y", title: "Kept", context: "Mine" }),
    ]);
    window.localStorage.setItem(
      DECISION_LOG_KEY,
      JSON.stringify([
        { id: "x", title: "Same", context: "Old page context", date: "2026-10-01" },
        { id: "y", title: "Kept", context: "Theirs", date: "2026-10-01" },
      ])
    );
    migrationMode.value = "local";
    renderPage();
    const notice = screen.getByRole("region", { name: "Edited on the old Decision Log page" });
    expect(
      within(notice).getAllByText(/This record was edited on the old Decision Log page/)
    ).toHaveLength(2);
    const items = within(notice).getAllByRole("listitem");
    fireEvent.click(within(items[0]).getByRole("button", { name: "Use the old text" }));
    expect(find("x")?.context).toBe("Old page context");
    undoLast();
    expect(find("x")?.context).toBe("Workspace context");
    fireEvent.click(
      within(
        screen.getAllByRole("listitem").find((li) => li.textContent?.includes("Kept · Context"))!
      ).getByRole("button", { name: "Keep this text" })
    );
    expect(
      screen.queryByRole("region", { name: "Edited on the old Decision Log page" })
    ).not.toBeInTheDocument();
    expect(find("y")?.context).toBe("Mine");
  });

  it("taking the old page's options keeps a choice still on one of them", () => {
    const d = rec({ id: "r", options: [{ id: "r-a0", text: "A" }], chosenOptionId: "r-a0" });
    const next = withOldText(d, {
      id: "r",
      field: "alternatives",
      blob: ["A", "B"],
      workspace: ["A"],
    });
    expect(next.options).toEqual([
      { id: "r-a0", text: "A" },
      { id: "r-a1", text: "B" },
    ]);
    expect(next.chosenOptionId).toBe("r-a0");
  });
});

/* ── Opening one record, exports, verdict ───────────────────────────── */

describe("?id=, Markdown, the verdict and the time to decide", () => {
  it("?id= opens that record", () => {
    expect(readRecordParam("?id=abc")).toBe("abc");
    expect(readRecordParam("?id=" + "x".repeat(200))).toBeNull();
    seed([rec({ id: "a", number: 1 }), rec({ id: "b", number: 2, title: "Second" })]);
    window.history.replaceState(null, "", "/decision-log?id=a");
    renderPage();
    expect(header("ADR-0001")).toHaveAttribute("aria-expanded", "true");
    expect(header("ADR-0002")).toHaveAttribute("aria-expanded", "false");
  });

  it("exports each record as an ADR section and the log with its verdict", () => {
    const list = buildExample(TODAY);
    const md = decisionToMarkdown(list[1], list);
    expect(md).toContain("## DACI-0002 · Pick a feature-flag service");
    expect(md).toContain("- **Approver:** Ben");
    expect(md).toContain("- **Driver:** Ana");
    expect(md).toContain("_Not decided yet._");
    expect(decisionToMarkdown(list[0], list)).toContain(
      "- **Superseded by:** ADR-0004 · Move the API to AWS ECS"
    );
    expect(decisionToMarkdown(list[3], list)).toContain(
      "- **Supersedes:** ADR-0001 · Host the API on Heroku"
    );
    expect(decisionToMarkdown(list[0], list)).toContain("- Heroku **(chosen)**");
    const log = decisionsToMarkdown(list, { verdict: decisionVerdict(list, TODAY) });
    expect(
      log.startsWith(
        "# Decision Log\n\n4 decisions: 1 proposed (waiting 5 days), 2 accepted, 1 superseded."
      )
    ).toBe(true);
    const csv = decisionsCsv(list);
    expect(csv.headers).toContain("Superseded by");
    expect(csv.rows[0][0]).toBe("ADR-0001");
  });

  it("keeps the old tools' shapes for their AI prompts", () => {
    const [, daci, rapid] = buildExample(TODAY);
    expect(toDaciRow(daci)).toMatchObject({
      driver: "Ana",
      approver: "Ben",
      status: "open",
      options: ["LaunchDarkly", "Unleash", "Build our own"],
    });
    expect(toRapidRow(rapid)).toMatchObject({
      recommend: "Priya",
      decide: "Morgan",
      status: "implemented",
    });
  });

  it("shows the time to decide only from 3 decided records", () => {
    seed([
      rec({
        id: "a",
        number: 1,
        status: "accepted",
        decision: "x",
        date: "2026-10-01",
        decidedAt: "2026-10-03",
      }),
      rec({
        id: "b",
        number: 2,
        status: "accepted",
        decision: "x",
        date: "2026-10-01",
        decidedAt: "2026-10-11",
      }),
    ]);
    const first = renderPage();
    expect(
      screen.getByText(/Decide 1 more decided record to see how long decisions take/)
    ).toBeInTheDocument();
    first.unmount();
    seed([
      ...ws().decisions,
      rec({
        id: "c",
        number: 3,
        status: "accepted",
        decision: "x",
        date: "2026-10-01",
        decidedAt: "2026-10-05",
      }),
    ]);
    renderPage();
    expect(screen.getByText("4 days")).toBeInTheDocument();
  });
});

/* ── Example ────────────────────────────────────────────────────────── */

describe("the example", () => {
  it("loads in all three forms and clears without touching the team's records", () => {
    seed([rec({ id: "mine", number: 9 })]);
    renderPage();
    expect(screen.queryByRole("button", { name: "Load an example" })).not.toBeInTheDocument();
    act(() => useWorkspaceStore.setState({ decisions: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(ws().decisions.map((d) => d.template)).toEqual(["adr", "daci", "rapid", "adr"]);
    act(() => ws().upsertDecision(rec({ id: "mine", number: 9 })));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(ws().decisions.map((d) => d.id)).toEqual(["mine"]);
  });
});

/* ── Page and agent agree ───────────────────────────────────────────── */

describe("the agent sees what the page shows", () => {
  it("same verdict, numbers and issues; the aliases speak their old words", async () => {
    seed(
      [rec({ id: "a", number: 1, status: "accepted", decision: "", date: "2026-09-01" })],
      [daciRow({ approver: undefined })],
      [rapidRow({ status: "implemented" })]
    );
    renderPage();
    const state = await run<{
      verdict: string;
      total: number;
      byTemplate: Record<string, number>;
      items: { id: string; label: string; issues: { kind: string }[] }[];
    }>("tool.decision_log.list_state");
    expect(screen.getByText(state.verdict)).toBeInTheDocument();
    expect(state.total).toBe(3);
    expect(state.byTemplate).toEqual({ adr: 1, daci: 1, rapid: 1 });
    expect(state.items.find((i) => i.id === "a")?.issues.map((x) => x.kind)).toEqual([
      "accepted_no_outcome",
    ]);
    expect(state.items.find((i) => i.id === "daci-1")?.issues.map((x) => x.kind)).toEqual([
      "no_decider",
      "stale_proposed",
    ]);

    const daci = await run<{
      byStatus: Record<string, number>;
      items: { status: string; label: string }[];
    }>("tool.daci.list_state");
    expect(daci.byStatus).toEqual({ open: 1, decided: 0, implemented: 0, revisit: 0 });
    const rapid = await run<{ byStatus: Record<string, number> }>("tool.rapid_decision.list_state");
    expect(rapid.byStatus).toEqual({ open: 0, decided: 0, implemented: 1 });
  });

  it("an agent's record shows on the page, numbered, and the DACI alias decides it", async () => {
    seed([rec({ id: "a", number: 5 })]);
    renderPage();
    const created = await run<{ created: boolean; label: string; id: string }>(
      "tool.decision_log.add_decision",
      { template: "daci", title: "Agent raised", decider: "ana", roles: { driver: ["BEN"] } }
    );
    expect(created).toMatchObject({ created: true, label: "DACI-0006" });
    expect(header("DACI-0006")).toBeInTheDocument();
    expect(find(created.id)).toMatchObject({ decider: "Ana", roles: { driver: ["Ben"] } });

    await run("tool.daci.set_status", { id: created.id, status: "implemented" });
    expect(find(created.id)).toMatchObject({
      status: "accepted",
      decidedAt: TODAY,
      implementedAt: TODAY,
    });
    const refused = await run<{ assigned: boolean; reason: string }>(
      "tool.decision_log.assign_role",
      {
        id: created.id,
        role: "driver",
        person: "Chen",
      }
    );
    expect(refused).toMatchObject({ assigned: false, reason: "single_role_taken", holder: "Ben" });
    const wrongForm = await run<{ reason: string }>("tool.decision_log.assign_role", {
      id: "a",
      role: "agree",
      person: "Chen",
    });
    expect(wrongForm.reason).toBe("role_not_in_template");
  });

  it("decide refuses what the page refuses", async () => {
    seed([
      rec({
        id: "r",
        number: 1,
        template: "rapid",
        date: "2026-10-10",
        options: [{ id: "o1", text: "Weekly" }],
      }),
    ]);
    const noDecider = await run<{ decided: boolean; reason: string }>("tool.decision_log.decide", {
      id: "r",
      outcome: "Go weekly",
    });
    expect(noDecider).toMatchObject({ decided: false, reason: "invalid" });
    const early = await run<{ reason: string }>("tool.decision_log.decide", {
      id: "r",
      outcome: "Go weekly",
      decider: "Morgan",
      date: "2026-10-01",
    });
    expect(early.reason).toBe("before_raised");
    const ok = await run<{ decided: boolean; label: string }>("tool.decision_log.decide", {
      id: "r",
      outcome: "Go weekly",
      decider: "Morgan",
      chosenOption: "weekly",
    });
    expect(ok).toMatchObject({ decided: true, label: "RAPID-0001" });
    expect(find("r")).toMatchObject({ status: "accepted", chosenOptionId: "o1", decidedAt: TODAY });
    const back = await run<{ reopened: boolean }>("tool.decision_log.reopen", { id: "r" });
    expect(back.reopened).toBe(true);
    expect(find("r")).toMatchObject({ status: "proposed", reopenedAt: TODAY });
  });
});

/* ── Review fixes ───────────────────────────────────────────────────── */

describe("review fixes: a weighted matrix's recommendation", () => {
  it("an ADR shows the recommendation it came with, editable; one without has no field", () => {
    seed([
      rec({
        id: "w",
        number: 1,
        recommendation: "Alpha (weighted total 20)",
        sourceRef: { tool: "weighted-decision", id: "m1", doc: "m1" },
      }),
      rec({ id: "plain", number: 2, title: "Plain ADR" }),
    ]);
    renderPage();
    open("ADR-0001");
    const box = within(card("w")).getByLabelText("Recommendation") as HTMLTextAreaElement;
    expect(box.value).toBe("Alpha (weighted total 20)");
    expect(box.getAttribute("aria-describedby")).toBe(
      within(card("w")).getByText("From the Weighted Decision Matrix: its leader.").id
    );
    fireEvent.change(box, { target: { value: "Alpha, with a pilot first" } });
    fireEvent.blur(box);
    expect(find("w")?.recommendation).toBe("Alpha, with a pilot first");
    open("ADR-0002");
    expect(within(card("plain")).queryByLabelText("Recommendation")).not.toBeInTheDocument();
  });

  it("add_decision keeps a recommendation on any form, as the card shows it", async () => {
    const out = await run<{ id: string }>("tool.decision_log.add_decision", {
      title: "Pick a host",
      recommendation: "ECS",
    });
    expect(find(out.id)).toMatchObject({ template: "adr", recommendation: "ECS" });
  });
});

describe("review fixes: the agent's delete", () => {
  it("removes the id from all three collections, so an old row can't read back in", async () => {
    seed(
      [rec({ id: "daci-1", number: 2, template: "daci", title: "Shadow" })],
      [daciRow()],
      [rapidRow()]
    );
    const out = await run<{ deleted: boolean; label: string }>("tool.decision_log.delete", {
      id: "daci-1",
    });
    expect(out).toEqual({ deleted: true, id: "daci-1", label: "DACI-0002" });
    expect(ws().decisions).toEqual([]);
    expect(ws().daciDecisions).toEqual([]);
    expect(find("daci-1")).toBeUndefined();
    // An old RAPID row read through (no stored record) goes too.
    expect(await run("tool.decision_log.delete", { id: "rapid-1" })).toMatchObject({
      deleted: true,
    });
    expect(ws().rapidDecisions).toEqual([]);
    expect(await run("tool.decision_log.delete", { id: "ghost" })).toEqual({
      deleted: false,
      reason: "not_found",
    });
  });

  it("refuses a row of the old Decision Log page that hasn't moved in yet", async () => {
    window.localStorage.setItem(
      DECISION_LOG_KEY,
      JSON.stringify([{ id: "blob-1", title: "Blob", status: "proposed", date: "2026-07-01" }])
    );
    const out = await run<{ deleted: boolean; reason: string }>("tool.decision_log.delete", {
      id: "blob-1",
    });
    expect(out).toMatchObject({ deleted: false, reason: "pending_move" });
    expect(JSON.parse(window.localStorage.getItem(DECISION_LOG_KEY)!)).toHaveLength(1);
  });

  it("asks first when the caller can confirm, and keeps the record on a no", async () => {
    seed([rec({ id: "a", number: 1 })]);
    const action = registry.get("tool.decision_log.delete")!;
    const out = await action.handler(action.paramsSchema.parse({ id: "a" }), {
      ...ctx,
      confirm: async () => false,
    });
    expect(out).toEqual({ deleted: false, confirmed: false });
    expect(find("a")).toBeDefined();
  });
});

describe("review fixes: no DACI or RAPID decision without its decider", () => {
  it("the status verbs refuse to decide a DACI or RAPID proposal with no decider named", async () => {
    seed([
      rec({ id: "d", number: 1, template: "daci" }),
      rec({ id: "r", number: 2, template: "rapid" }),
      rec({ id: "a", number: 3 }),
    ]);
    for (const [id, args] of [
      ["d", ["tool.daci.set_status", "decided"]],
      ["d", ["tool.daci.set_status", "implemented"]],
      ["d", ["tool.decision_log.set_status", "accepted"]],
      ["r", ["tool.rapid_decision.set_status", "decided"]],
      ["r", ["tool.rapid_decision.set_status", "implemented"]],
      ["r", ["tool.decision_log.set_status", "accepted"]],
    ] as const) {
      const out = await run(args[0], { id, status: args[1] });
      expect(out).toMatchObject({ updated: false, reason: "no_decider" });
    }
    expect(await run("tool.daci.set_status", { id: "d", status: "decided" })).toMatchObject({
      message: "Name the Approver before deciding.",
    });
    expect(find("d")?.status).toBe("proposed");
    expect(find("r")?.status).toBe("proposed");
    // An ADR needs no decider; a named one lets DACI through.
    expect(await run("tool.decision_log.set_status", { id: "a", status: "accepted" })).toEqual({
      updated: true,
    });
    await run("tool.decision_log.set_decider", { id: "d", person: "Ben" });
    expect(await run("tool.daci.set_status", { id: "d", status: "decided" })).toEqual({
      updated: true,
    });
    // An accepted record carries out without a decider (an old row may have none).
    seed([rec({ id: "x", number: 1, template: "rapid", status: "accepted", decision: "Go" })]);
    expect(await run("tool.rapid_decision.set_status", { id: "x", status: "implemented" })).toEqual(
      { updated: true }
    );
  });
});

describe("review fixes: superseding", () => {
  const list = [
    rec({ id: "a", number: 1, status: "superseded", supersededBy: "b" }),
    rec({ id: "b", number: 2, status: "accepted" }),
    rec({ id: "c", number: 3, status: "deprecated" }),
    rec({ id: "d", number: 4, status: "proposed" }),
    rec({ id: "example-e", number: 5, status: "accepted" }),
    rec({ id: "f", number: 6, status: "accepted", supersededBy: "b" }),
  ];

  it("offers no loop, no record out of force and no example for a team's record", () => {
    // b replaced a: a can't replace b back (it's superseded anyway), and f's
    // stray link to b makes f a loop too; c is deprecated; e is an example.
    expect(replacementsFor(list, list[1]).map((x) => x.id)).toEqual(["d"]);
    expect(replacementError(list, list[1], "a")).toBe("not_in_force");
    expect(replacementError(list, list[1], "f")).toBe("loop");
    expect(replacementError(list, list[1], "c")).toBe("not_in_force");
    expect(replacementError(list, list[1], "example-e")).toBe("example_mismatch");
    expect(replacementError(list, list[1], "b")).toBe("self");
    expect(replacementError(list, list[1], "ghost")).toBe("not_found");
  });

  it("the agent's supersede and set_status follow the same rules (page/agent parity)", async () => {
    seed(list);
    const reasons: Record<string, string> = {
      not_found: "replacement_not_found",
      self: "replacement_not_found",
      example_mismatch: "example_mismatch",
      not_in_force: "replacement_not_in_force",
      loop: "supersede_loop",
    };
    for (const by of ["a", "c", "example-e", "f", "b", "ghost"]) {
      const page = replacementError(list, list[1], by);
      const agent = await run<{ superseded: boolean; reason?: string }>(
        "tool.decision_log.supersede",
        { id: "b", supersededBy: by }
      );
      expect(agent).toMatchObject({ superseded: false, reason: reasons[page!] });
      const status = await run<{ updated: boolean; reason?: string }>(
        "tool.decision_log.set_status",
        { id: "b", status: "superseded", supersededBy: by }
      );
      expect(status).toMatchObject({ updated: false, reason: reasons[page!] });
    }
    expect(find("b")?.status).toBe("accepted");
    // An example can't name a team's record either.
    expect(
      await run("tool.decision_log.supersede", { id: "example-e", supersededBy: "d" })
    ).toMatchObject({ superseded: false, reason: "example_mismatch" });
    // The one allowed: d.
    expect(replacementError(list, list[1], "d")).toBeNull();
    expect(await run("tool.decision_log.supersede", { id: "b", supersededBy: "d" })).toMatchObject({
      superseded: true,
    });
    // Asked again, it's a no-op, even with the rules applied.
    expect(await run("tool.decision_log.supersede", { id: "b", supersededBy: "d" })).toMatchObject({
      superseded: false,
      alreadySuperseded: true,
    });
  });

  it("a deleted replacement reads as 'a deleted record', on the card and in the exports", () => {
    seed([
      rec({ id: "old", number: 1, status: "superseded", supersededBy: "gone" }),
      rec({ id: "x", number: 2, template: "daci", status: "superseded", supersededBy: "y" }),
      rec({ id: "y", number: 3, title: "The ADR" }),
    ]);
    renderPage();
    open("ADR-0001");
    expect(within(card("old")).getByText("Superseded by a deleted record")).toBeInTheDocument();
    expect(
      within(card("old")).queryByRole("button", { name: /Superseded by/ })
    ).not.toBeInTheDocument();
    expect(recordName(all(), "gone")).toBe("a deleted record");
    expect(decisionToMarkdown(find("old")!, all())).toContain(
      "- **Superseded by:** a deleted record"
    );
    // With the DACI chip on, the CSV still names the ADR that replaced it.
    const daciOnly = all().filter((d) => d.template === "daci");
    const csv = decisionsCsv(daciOnly, all());
    expect(csv.rows[0][csv.headers.indexOf("Superseded by")]).toBe("ADR-0003 · The ADR");
  });
});

describe("review fixes: focus after a lifecycle move", () => {
  it("Reopen, Deprecate, Supersede and Record the decision leave focus on the record's header", () => {
    seed([
      rec({ id: "a", number: 1, status: "accepted", decision: "Go", decidedAt: "2026-10-05" }),
      rec({ id: "b", number: 2, title: "Replacement" }),
    ]);
    renderPage();
    open("ADR-0001");
    fireEvent.click(within(card("a")).getByRole("button", { name: "Deprecate" }));
    expect(header("ADR-0001")).toHaveFocus();
    fireEvent.click(within(card("a")).getByRole("button", { name: "Reopen" }));
    expect(header("ADR-0001")).toHaveFocus();

    fireEvent.click(within(card("a")).getByRole("button", { name: "Record the decision" }));
    fireEvent.click(within(card("a")).getByRole("button", { name: "Cancel" }));
    expect(within(card("a")).getByRole("button", { name: "Record the decision" })).toHaveFocus();

    fireEvent.click(within(card("a")).getByRole("button", { name: "Record the decision" }));
    const form = within(card("a"))
      .getByRole("button", { name: "Record the decision" })
      .closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^What was decided/), {
      target: { value: "Go again" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Record the decision" }));
    expect(find("a")?.status).toBe("accepted");
    expect(header("ADR-0001")).toHaveFocus();

    fireEvent.change(within(card("a")).getByLabelText("The record that replaces ADR-0001"), {
      target: { value: "b" },
    });
    fireEvent.click(within(card("a")).getByRole("button", { name: "Supersede" }));
    expect(find("a")?.status).toBe("superseded");
    expect(header("ADR-0001")).toHaveFocus();
  });

  it("cancelling the New form returns focus to the New button", () => {
    seed([rec({ id: "a", number: 1 })]);
    renderPage();
    const button = screen.getAllByRole("button", { name: "New ADR" })[0];
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(button).toHaveFocus();
  });
});

describe("review fixes: editing options and the reopen day", () => {
  it("an emptied or repeated option isn't saved: the field shows its text again and says why", () => {
    seed([
      rec({
        id: "a",
        number: 1,
        options: [
          { id: "o1", text: "Heroku" },
          { id: "o2", text: "ECS" },
        ],
      }),
    ]);
    renderPage();
    open("ADR-0001");
    const second = within(card("a")).getByLabelText("Option 2") as HTMLInputElement;
    fireEvent.change(second, { target: { value: " " } });
    fireEvent.blur(second);
    expect(second.value).toBe("ECS");
    const error = within(card("a")).getByText("An option needs text: use × to remove it.");
    expect(second.getAttribute("aria-describedby")).toBe(error.id);
    fireEvent.change(second, { target: { value: "heroku" } });
    fireEvent.blur(second);
    expect(second.value).toBe("ECS");
    expect(within(card("a")).getByText("That option is already listed.")).toBeInTheDocument();
    expect(find("a")?.options?.map((o) => o.text)).toEqual(["Heroku", "ECS"]);
    fireEvent.change(second, { target: { value: "Fargate" } });
    fireEvent.blur(second);
    expect(find("a")?.options?.map((o) => o.text)).toEqual(["Heroku", "Fargate"]);
  });

  it("a reopened proposal shows the day it was reopened, and it can be backdated", () => {
    seed([
      rec({
        id: "a",
        number: 1,
        status: "proposed",
        date: "2026-10-01",
        decidedAt: "2026-10-05",
        reopenedAt: "2026-10-20",
        decision: "Go",
      }),
    ]);
    renderPage();
    expect(header("ADR-0001")).toHaveTextContent("reopened 2026-10-20");
    open("ADR-0001");
    const day = within(card("a")).getByLabelText("Day ADR-0001 was reopened") as HTMLInputElement;
    expect(day.value).toBe("2026-10-20");
    fireEvent.change(day, { target: { value: "2026-10-10" } });
    fireEvent.blur(day);
    expect(find("a")?.reopenedAt).toBe("2026-10-10");
    const d = find("a")!;
    expect(reopenedDayError("2026-10-04", d, TODAY)).toBe(
      "It can't be reopened before it was decided."
    );
    expect(reopenedDayError("2026-10-28", d, TODAY)).toBe("Pick today or an earlier day.");
    expect(reopenedDayError("2026-10-05", d, TODAY)).toBeNull();
  });

  it("add_decision refuses two options that say the same thing, as the form does", async () => {
    expect(
      await run("tool.decision_log.add_decision", {
        title: "Host",
        options: ["Heroku", " heroku "],
      })
    ).toMatchObject({ created: false, reason: "duplicate_option" });
    expect(ws().decisions).toEqual([]);
  });
});

describe("review fixes: the old page's text", () => {
  it("taking the old page's options keeps the choice on its text, wherever it now sits", () => {
    const d = rec({
      id: "r",
      options: [
        { id: "r-o0", text: "A" },
        { id: "r-o1", text: "B" },
      ],
      chosenOptionId: "r-o1",
    });
    const moved = withOldText(d, {
      id: "r",
      field: "alternatives",
      blob: ["B", "C"],
      workspace: ["A", "B"],
    });
    expect(moved.options).toEqual([
      { id: "r-a0", text: "B" },
      { id: "r-a1", text: "C" },
    ]);
    // Form-made ids (-o) follow their text to the new place (-a0), not a position.
    expect(moved.chosenOptionId).toBe("r-a0");
    const gone = withOldText(d, {
      id: "r",
      field: "alternatives",
      blob: ["A", "C"],
      workspace: ["A", "B"],
    });
    expect(gone.chosenOptionId).toBeUndefined();
    // An old ADR's alternatives (no options yet): the choice still follows its text.
    const old = rec({ id: "q", alternatives: ["X", "Y"], chosenOptionId: "q-a0" });
    const next = withOldText(old, {
      id: "q",
      field: "alternatives",
      blob: ["", "Y", "X"],
      workspace: ["X", "Y"],
    });
    expect(next.alternatives).toEqual(["", "Y", "X"]);
    expect(next.chosenOptionId).toBe("q-a1");
  });

  it("points at the kept text by its heading, which still holds when the columns stack", () => {
    const d = rec({ id: "r", number: 1, context: "Mine" });
    render(
      <ConflictNotice
        conflicts={[{ id: "r", field: "context", blob: "Theirs", workspace: "Mine" }]}
        records={[d]}
        onKeep={() => {}}
        onUseOld={() => {}}
      />
    );
    expect(screen.getByText(/The log kept the text under “In the log now”\./)).toBeInTheDocument();
    expect(screen.queryByText(/on the left/)).not.toBeInTheDocument();
  });
});
