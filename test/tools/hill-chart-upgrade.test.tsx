import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HillChart, HillScope } from "@/lib/stores/workspace-types";

/**
 * Hill Chart (tools plan, phase 2, N04): scopes on a hill, moved by drag,
 * arrow keys (announced, saved once when the move ends) or a number box;
 * weekly check-ins, one a day; what moved since an earlier check-in; the
 * stuck rule and a story that disagrees; a stuck scope raised as an
 * impediment with Undo; scopes added and removed with Undo; charts started,
 * archived and deleted; the week's update without AI, kept only as the
 * note; the example; the Markdown export; history payloads free of text.
 */

const h = vi.hoisted(() => ({
  logs: [] as { action: string; payload: Record<string, unknown> }[],
  cheers: [] as string[],
}));
const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hill-chart",
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload: Record<string, unknown>) => h.logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (tool: string, reason: string) => h.cheers.push(`${tool}:${reason}`),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: ({ config }: { config: { prompts: { id: string }[] } }) => (
    <pre data-testid="ai-prompt">{config.prompts.map((p) => p.id).join(",")}</pre>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { HillChartClient } from "@/app/(tools)/hill-chart/hill-chart-client";
import { validateChart, validateScope, EMPTY_SCOPE } from "@/app/(tools)/hill-chart/form";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const scope = (id: string, position: number, movedDaysAgo: number, over: Partial<HillScope> = {}) =>
  ({ id, title: `Scope ${id}`, position, movedAt: ago(movedDaysAgo), ...over }) as HillScope;
const chart = (over: Partial<HillChart> = {}): HillChart => ({
  id: "hill_a",
  title: "Refunds",
  scopes: [scope("s1", 30, 9), scope("s2", 60, 1)],
  checkIns: [
    {
      id: "c1",
      at: ago(7),
      positions: [
        { scopeId: "s1", position: 30 },
        { scopeId: "s2", position: 40 },
      ],
      note: "Week one",
    },
  ],
  createdAt: ago(20),
  updatedAt: ago(1),
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const stored = (id = "hill_a") => (ws().hillCharts ?? []).find((c) => c.id === id);
const seed = (charts: HillChart[], extra: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({ hillCharts: charts, stories: [], impediments: [], ...extra });
const logged = (action: string) => h.logs.filter((l) => l.action === action).map((l) => l.payload);
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <HillChartClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const dot = (name: string) => screen.getByRole("slider", { name });
/** A scope's row in the list, by its title. */
const rowOf = (title: string) =>
  screen
    .getAllByText(title)
    .find((el) => el.hasAttribute("data-scope-title"))
    ?.closest("li") as HTMLElement;

beforeEach(() => {
  toastSpy.mockReset();
  h.logs.length = 0;
  h.cheers.length = 0;
  seed([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the form checks", () => {
  it("needs a chart name, and a scope's title and a position from 0 to 100", () => {
    expect(validateChart({ title: " ", about: "", sprintId: "", epicId: "" })).toMatchObject({
      ok: false,
      errors: { title: expect.any(String) },
    });
    expect(validateScope({ ...EMPTY_SCOPE, title: "API", position: "" })).toMatchObject({
      ok: false,
      errors: { position: "Type where it is, from 0 to 100." },
    });
    expect(validateScope({ ...EMPTY_SCOPE, title: "API", position: "101" })).toMatchObject({
      ok: false,
    });
    expect(validateScope({ ...EMPTY_SCOPE, title: "API", position: "4.5" })).toMatchObject({
      ok: false,
    });
    expect(validateScope({ ...EMPTY_SCOPE, title: " API ", position: "20" })).toEqual({
      ok: true,
      values: { title: "API", position: 20 },
    });
  });
});

describe("starting out", () => {
  it("shows the empty state with the example, and the new chart form", () => {
    renderPage();
    expect(screen.getByText(/No hill charts yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Chart name/)).toBeInTheDocument();
  });

  it("refuses a blank chart name, then starts a chart and logs it without its name", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start chart" }));
    expect(ws().hillCharts).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(/Name the chart/);
    fireEvent.change(screen.getByLabelText(/Chart name/), { target: { value: "Checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "Start chart" }));
    expect(ws().hillCharts).toHaveLength(1);
    expect(ws().hillCharts?.[0]).toMatchObject({ title: "Checkout", scopes: [], checkIns: [] });
    expect(ws().hillCharts?.[0].id).toMatch(/^hill_/);
    const [payload] = logged("chart_created");
    expect(payload).toEqual({ chartId: ws().hillCharts?.[0].id });
  });

  it("loads the example: six scopes, the payment API stuck, nothing logged", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(6);
    const row = rowOf("Payment provider API");
    expect(within(row).getByText("Stuck")).toBeInTheDocument();
    expect(screen.getByText(/4 of 6 scopes are over the hill; 1 stuck uphill/)).toBeInTheDocument();
    expect(h.logs).toEqual([]);
  });

  it("never raises the example's stuck scope", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(screen.getByRole("button", { name: /^Send to… Payment provider API/ })).toBeDisabled();
  });

  it("clears the example with Undo", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(ws().hillCharts).toEqual([]);
    undoLast();
    expect(ws().hillCharts).toHaveLength(1);
  });
});

describe("moving scopes", () => {
  beforeEach(() => seed([chart()]));

  it("labels each dot as a slider with its position and side", () => {
    renderPage();
    const d = dot("Scope s1");
    expect(d).toHaveAttribute("aria-valuenow", "30");
    expect(d).toHaveAttribute("aria-valuetext", "Scope s1: 30, uphill");
    expect(d).toHaveAttribute("aria-valuemin", "0");
    expect(d).toHaveAttribute("aria-valuemax", "100");
  });

  it("moves 5 per arrow key, announced each time, and saves once when the move ends", async () => {
    renderPage();
    const d = dot("Scope s1");
    d.focus();
    fireEvent.keyDown(d, { key: "ArrowRight" });
    fireEvent.keyDown(d, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent("Scope s1: 40, uphill")
    );
    expect(stored()?.scopes[0].position).toBe(30);
    expect(logged("scope_moved")).toEqual([]);
    fireEvent.blur(d);
    expect(stored()?.scopes[0].position).toBe(40);
    expect(logged("scope_moved")).toEqual([{ chartId: "hill_a", scopeId: "s1", from: 30, to: 40 }]);
  });

  it("moves 15 with Shift, and Home and End go to the feet of the hill", () => {
    renderPage();
    const d = dot("Scope s2");
    fireEvent.keyDown(d, { key: "ArrowLeft", shiftKey: true });
    expect(d).toHaveAttribute("aria-valuenow", "45");
    fireEvent.keyDown(d, { key: "Home" });
    expect(d).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(d, { key: "End" });
    fireEvent.keyDown(d, { key: "Enter" });
    expect(stored()?.scopes[1].position).toBe(100);
  });

  it("saves a move after the keys pause", () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.keyDown(dot("Scope s1"), { key: "ArrowUp" });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(stored()?.scopes[0].position).toBe(35);
  });

  it("drags a dot along the hill and saves where it lands", () => {
    renderPage();
    const d = dot("Scope s1");
    const box = d.parentElement as HTMLElement;
    box.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 562, right: 1000, bottom: 562 }) as DOMRect;
    fireEvent.pointerDown(d, { button: 0, pointerId: 1, clientX: 320 });
    fireEvent.pointerMove(d, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(d, { pointerId: 1, clientX: 500 });
    expect(stored()?.scopes[0].position).toBe(50);
    expect(logged("scope_moved")).toHaveLength(1);
  });

  it("moves a scope from its number box, and says what's wrong with a bad number", () => {
    renderPage();
    const box = screen.getByLabelText("Position of Scope s1");
    fireEvent.change(box, { target: { value: "abc" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("Use a whole number from 0 to 100.");
    fireEvent.change(box, { target: { value: "55" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(stored()?.scopes[0].position).toBe(55);
    expect(stored()?.scopes[0].doneAt).toBeUndefined();
  });

  it("marks a scope done at 100 with Amr's cheer, in the tick of its log", () => {
    renderPage();
    const box = screen.getByLabelText("Position of Scope s2");
    fireEvent.change(box, { target: { value: "100" } });
    fireEvent.blur(box);
    expect(stored()?.scopes[1].doneAt).toBeTruthy();
    expect(logged("scope_done")).toEqual([{ chartId: "hill_a", scopeId: "s2" }]);
    expect(h.cheers).toEqual(["hill-chart:milestone"]);
  });
});

describe("scopes", () => {
  beforeEach(() => seed([chart()]));

  it("adds a scope from the form, refusing a missing position", () => {
    renderPage();
    const card = screen.getByRole("region", { name: "Add a scope" });
    fireEvent.change(within(card).getByLabelText(/^Scope/), { target: { value: "Emails" } });
    fireEvent.change(within(card).getByLabelText(/^Position/), { target: { value: "" } });
    fireEvent.click(within(card).getByRole("button", { name: "Add scope" }));
    expect(stored()?.scopes).toHaveLength(2);
    fireEvent.change(within(card).getByLabelText(/^Position/), { target: { value: "10" } });
    fireEvent.click(within(card).getByRole("button", { name: "Add scope" }));
    expect(stored()?.scopes.at(-1)).toMatchObject({ title: "Emails", position: 10 });
    const [payload] = logged("scope_added");
    expect(payload).toEqual({ chartId: "hill_a", scopeId: stored()?.scopes.at(-1)?.id });
  });

  it("edits a scope in place", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Scope s2" }));
    const title = screen.getByDisplayValue("Scope s2");
    fireEvent.change(title, { target: { value: "Receipts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scope" }));
    expect(stored()?.scopes[1].title).toBe("Receipts");
    expect(stored()?.scopes[1].position).toBe(60);
  });

  it("deletes a scope with Undo, logged by id only", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Scope s2" }));
    expect(stored()?.scopes.map((s) => s.id)).toEqual(["s1"]);
    expect(logged("scope_removed")).toEqual([{ chartId: "hill_a", scopeId: "s2" }]);
    undoLast();
    expect(stored()?.scopes.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("flags a stuck scope, and a scope its story disagrees with", () => {
    seed([chart({ scopes: [scope("s1", 30, 9, { storyId: "st" }), scope("s2", 60, 1)] })], {
      stories: [{ id: "st", title: "Payment story", status: "done" }],
    });
    renderPage();
    const row = rowOf("Scope s1");
    expect(within(row).getByText("Stuck")).toBeInTheDocument();
    expect(within(row).getByText("Check")).toBeInTheDocument();
    expect(
      within(row).getByText("Its story is done, but the scope is still uphill.")
    ).toBeInTheDocument();
    expect(within(row).getByText(/Payment story/)).toBeInTheDocument();
    const other = rowOf("Scope s2");
    expect(within(other).queryByText("Stuck")).toBeNull();
    expect(within(other).queryByRole("button", { name: /^Send to…/ })).toBeNull();
  });

  it("raises a stuck scope as an impediment, with Undo", () => {
    renderPage();
    const send = screen.getByRole("button", { name: /^Send to… Scope s1/ });
    fireEvent.pointerDown(send, { button: 0, pointerType: "mouse" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Raise as an impediment" }));
    const imps = ws().impediments ?? [];
    expect(imps).toHaveLength(1);
    expect(imps[0]).toMatchObject({
      title: "Scope s1",
      sourceRef: { tool: "hill-chart", id: "s1", doc: "hill_a" },
    });
    expect(stored()?.scopes[0].sentTo?.[0]).toMatchObject({ route: "impediment" });
    expect(logged("scope_raised")).toEqual([
      { chartId: "hill_a", scopeId: "s1", impedimentId: imps[0].id },
    ]);
    undoLast();
    expect(ws().impediments).toEqual([]);
    expect(stored()?.scopes[0].sentTo).toBeUndefined();
  });
});

describe("check-ins", () => {
  beforeEach(() => seed([chart()]));

  it("saves today's positions with the note, once a day", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/This week's note/), {
      target: { value: "Receipts moved" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    expect(stored()?.checkIns).toHaveLength(2);
    expect(stored()?.checkIns.at(-1)).toMatchObject({
      note: "Receipts moved",
      positions: [
        { scopeId: "s1", position: 30 },
        { scopeId: "s2", position: 60 },
      ],
    });
    expect(logged("checked_in")).toEqual([{ chartId: "hill_a", scopes: 2, moved: 1 }]);
    fireEvent.click(screen.getByRole("button", { name: "Check in again" }));
    expect(stored()?.checkIns).toHaveLength(2);
    undoLast();
    expect(stored()?.checkIns.at(-1)?.note).toBe("Receipts moved");
  });

  it("lists what moved since the check-in compared with", () => {
    renderPage();
    const card = screen.getByRole("region", { name: "Moved since a check-in" });
    expect(within(card).getByText("Forward (1)")).toBeInTheDocument();
    expect(within(card).getByText("Not moved (1)")).toBeInTheDocument();
    expect(within(card).getByText("Back (0)")).toBeInTheDocument();
    expect(within(card).getByText("(40 → 60)")).toBeInTheDocument();
  });

  it("drafts the week's update without AI, and keeps it only as the note", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Draft the update" }));
    const region = screen.getByRole("region", { name: "The week's update" });
    expect(region).toHaveTextContent(
      /1 of 2 pieces is over the hill\. 1 moved forward since the last check-in\. Scope s1 hasn't moved uphill for 9 days\./
    );
    expect(region).toHaveTextContent(/Drafted without AI/);
    expect(stored()?.checkIns).toHaveLength(1);
    fireEvent.click(within(region).getByRole("button", { name: "Use as the note" }));
    expect((screen.getByLabelText(/This week's note/) as HTMLTextAreaElement).value).toMatch(
      /^1 of 2 pieces is over the hill/
    );
  });
});

describe("charts", () => {
  it("archives a chart with Undo, and shows it again with Show archived", () => {
    seed([chart(), chart({ id: "hill_b", title: "Search", createdAt: ago(30) })]);
    renderPage();
    expect(screen.getByLabelText("Chart")).toHaveValue("hill_a");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(stored()?.archived).toBe(true);
    expect(screen.getByLabelText("Chart")).toHaveValue("hill_b");
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(
      within(screen.getByLabelText("Chart")).getByText("Refunds (archived)")
    ).toBeInTheDocument();
    undoLast();
    expect(stored()?.archived).toBeUndefined();
  });

  it("deletes a chart with Undo", () => {
    seed([chart()]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete the hill chart Refunds" }));
    expect(ws().hillCharts).toEqual([]);
    expect(logged("chart_removed")).toEqual([{ chartId: "hill_a" }]);
    undoLast();
    expect(stored()).toBeTruthy();
  });

  it("opens the chart a ?chart= link names", async () => {
    seed([chart(), chart({ id: "hill_b", title: "Search", createdAt: ago(30) })]);
    window.history.replaceState(null, "", "/hill-chart?chart=hill_b");
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Chart")).toHaveValue("hill_b"));
    expect(window.location.search).toBe("");
  });

  it("exports the chart as Markdown: the table and the check-in log", () => {
    seed([chart()]);
    renderPage();
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toMatch(/^# Hill chart — Refunds \(\d{4}-\d{2}-\d{2}\)/);
    expect(md).toContain(
      "| Scope s1 | Still working it out | 30 | not moved | 9 days ago | Stuck |"
    );
    expect(md).toContain("| Scope s2 | Getting it done | 60 | forward 20 | 1 days ago |  |");
    expect(md).toMatch(/## Check-ins\n\n- \d{4}-\d{2}-\d{2}: Week one/);
  });

  it("keeps titles and notes out of every history payload", () => {
    seed([chart()]);
    renderPage();
    fireEvent.keyDown(dot("Scope s1"), { key: "End" });
    fireEvent.blur(dot("Scope s1"));
    fireEvent.change(screen.getByLabelText(/This week's note/), { target: { value: "Secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    const text = JSON.stringify(h.logs);
    expect(text).not.toContain("Scope s1");
    expect(text).not.toContain("Refunds");
    expect(text).not.toContain("Secret");
    expect(h.logs.length).toBeGreaterThan(2);
  });
});
