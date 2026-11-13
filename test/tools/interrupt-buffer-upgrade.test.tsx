/**
 * Interrupt Buffer against the tool UX contract: an empty state with an
 * in-memory example; the sprint's buffer set as a share or points (blank
 * clears it) and checked first; interrupts logged with a checked form, Ask
 * Amr's kind without AI, resolved, edited and deleted with Undo; the gauge
 * and the Emergency Procedure once the buffer is spent; the sprint history;
 * the export; and the history it logs.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { InterruptItem, Sprint } from "@/lib/stores/workspace-types";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/interrupt-buffer",
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({
    markdown,
    csvData,
  }: {
    markdown?: string;
    csvData?: { headers: string[]; rows: unknown[][] };
  }) => (
    <>
      <pre data-testid="export-markdown">{markdown}</pre>
      <pre data-testid="export-csv">{JSON.stringify(csvData)}</pre>
    </>
  ),
}));

import {
  InterruptBufferClient,
  withStep,
} from "@/app/(tools)/interrupt-buffer/interrupt-buffer-client";
import { buildExample } from "@/app/(tools)/interrupt-buffer/example";
import { interruptsCsv } from "@/app/(tools)/interrupt-buffer/markdown";
import {
  emergencyFor,
  normalizeRun,
  useInterruptBufferPrefs,
} from "@/app/(tools)/interrupt-buffer/store";
import { INTERRUPT_BUFFER_ACTIONS } from "@/lib/history/event-actions";

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s1",
  name: "Sprint 7",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  pointsPlanned: 30,
  status: "active",
  ...over,
});
const item = (over: Partial<InterruptItem> = {}): InterruptItem => ({
  id: "i1",
  sprintId: "s1",
  title: "Checkout fails for one bank",
  kind: "bug",
  size: 2,
  emergency: false,
  loggedAt: "2026-11-04T09:00:00.000Z",
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const seed = (sprints: Sprint[], interruptItems: InterruptItem[] = []) =>
  useWorkspaceStore.setState({ sprints, interruptItems });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <InterruptBufferClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  localStorage.clear();
  resetSelectedSprint();
  useInterruptBufferPrefs.setState({ emergencies: {} });
  seed([]);
});

describe("empty state and example", () => {
  it("asks for a sprint first, or opens an example in memory", async () => {
    renderPage();
    expect(await screen.findByText(/No sprint yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See an example sprint" }));
    expect(screen.getByText(/Nothing in the example is saved/)).toBeInTheDocument();
    expect(screen.getByText("Card payments fail for one bank")).toBeInTheDocument();
    // Logging in the example stays in it.
    type("What came in", "Printer jam at the shop");
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    expect(screen.getByText("Printer jam at the shop")).toBeInTheDocument();
    expect(ws().interruptItems).toEqual([]);
    expect(ws().sprints).toEqual([]);
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(await screen.findByText(/No sprint yet/)).toBeInTheDocument();
  });

  it("builds a running sprint with a share kept free and a finished one", () => {
    const ex = buildExample(new Date("2026-11-12T10:00:00Z"));
    expect(ex.sprints.map((s) => s.status)).toEqual(["active", "completed"]);
    expect(ex.sprints[0].interruptBuffer).toEqual({ pct: 20 });
    expect([...ex.sprints, ...ex.items].every((x) => x.id.startsWith("example-"))).toBe(true);
  });
});

describe("the buffer", () => {
  it("is set as a share of the sprint, checked first, and logged", async () => {
    seed([sprint()]);
    renderPage();
    await screen.findByText("No buffer set and no interrupts logged.");
    type("Share", "95");
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    expect(screen.getByText(/from 1 to 90%/)).toBeInTheDocument();
    expect(ws().sprints[0].interruptBuffer).toBeUndefined();
    type("Share", "20");
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    expect(ws().sprints[0].interruptBuffer).toEqual({ pct: 20 });
    expect(
      screen.getByText("Nothing logged yet: all 6 points of the buffer left.")
    ).toBeInTheDocument();
    expect(logs.at(-1)).toEqual({
      action: INTERRUPT_BUFFER_ACTIONS.BUFFER_SET,
      payload: { sprintId: "s1", pct: 20, points: null },
    });
  });

  it("is set in points, and cleared when left blank", async () => {
    seed([sprint({ interruptBuffer: { pct: 20 } })]);
    renderPage();
    fireEvent.change(await screen.findByLabelText("Keep it as"), { target: { value: "points" } });
    type("Points", "4");
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    expect(ws().sprints[0].interruptBuffer).toEqual({ points: 4 });
    type("Points", "");
    fireEvent.click(screen.getByRole("button", { name: "Save the buffer" }));
    expect(ws().sprints[0].interruptBuffer).toBeUndefined();
  });

  it("reads a saved share back as a share", async () => {
    seed([sprint({ interruptBuffer: { pct: 20 } })]);
    renderPage();
    expect(await screen.findByLabelText("Keep it as")).toHaveValue("pct");
    expect(screen.getByLabelText("Share")).toHaveValue(20);
    expect(screen.getByText(/A share of the 30 points planned for Sprint 7/)).toBeInTheDocument();
  });

  it("weighs a share above 90% that was stored elsewhere, so the warning still comes", async () => {
    seed([sprint({ interruptBuffer: { pct: 95 } })], [item({ size: 40 })]);
    renderPage();
    expect(
      await screen.findByText("40 of 28.5 points used: 11.5 points over the buffer.")
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Emergency Procedure" })).toBeInTheDocument();
  });

  it("suggests a size from the finished sprints' interrupts", async () => {
    seed(
      [
        sprint(),
        sprint({
          id: "s0",
          name: "Sprint 6",
          status: "completed",
          endDate: "2026-10-30",
          startDate: "2026-10-19",
        }),
      ],
      [item({ id: "old", sprintId: "s0", size: 5 })]
    );
    renderPage();
    expect(await screen.findByText(/used 5 points of interrupts on average/)).toBeInTheDocument();
  });
});

describe("interrupts", () => {
  it("are logged with a checked form, against the sprint", async () => {
    seed([sprint({ interruptBuffer: { points: 8 } })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Log it" }));
    expect(screen.getByText("Say what came in.")).toBeInTheDocument();
    type("What came in", "Sales asks for a refunds export");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "request" } });
    type("Size in points", "3");
    fireEvent.click(screen.getByLabelText("It couldn't wait"));
    fireEvent.click(screen.getByRole("button", { name: "Log it" }));
    expect(ws().interruptItems).toEqual([
      expect.objectContaining({
        sprintId: "s1",
        title: "Sales asks for a refunds export",
        kind: "request",
        size: 3,
        emergency: true,
      }),
    ]);
    expect(screen.getByText("3 of 8 points used, 5 points left.")).toBeInTheDocument();
    expect(logs.at(-1)?.action).toBe(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_LOGGED);
  });

  it("get a kind and size from the words when AI is off, which the person can change", async () => {
    seed([sprint()]);
    renderPage();
    await screen.findByLabelText("What came in");
    type("What came in", "Checkout is down for card payments");
    fireEvent.click(screen.getByRole("button", { name: "Suggest the kind from the words" }));
    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe("incident");
    expect((screen.getByLabelText("Size in points") as HTMLInputElement).value).toBe("8");
    expect(screen.getByText(/From the words: Incident, about 8 points/)).toBeInTheDocument();
    expect(ws().interruptItems).toEqual([]);
  });

  it("are resolved and reopened, still counting against the buffer", async () => {
    seed([sprint({ interruptBuffer: { points: 4 } })], [item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Resolve “/ }));
    expect(ws().interruptItems?.[0].resolvedAt).toBeTruthy();
    expect(screen.getByText("2 of 4 points used, 2 points left.")).toBeInTheDocument();
    expect(logs.at(-1)?.action).toBe(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_RESOLVED);
    fireEvent.click(screen.getByRole("button", { name: /^Reopen “/ }));
    expect(ws().interruptItems?.[0]).not.toHaveProperty("resolvedAt");
  });

  it("are edited in place", async () => {
    seed([sprint()], [item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit “/ }));
    const list = screen.getByRole("list", { name: "Interrupts in Sprint 7" });
    fireEvent.change(within(list).getByLabelText("What came in"), {
      target: { value: "Checkout fails for two banks" },
    });
    fireEvent.click(within(list).getByRole("button", { name: "Save" }));
    expect(ws().interruptItems?.[0]).toMatchObject({
      title: "Checkout fails for two banks",
      kind: "bug",
    });
    expect(logs.at(-1)?.action).toBe(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_UPDATED);
  });

  it("put focus back on the row's Edit after Save or Cancel", async () => {
    seed([sprint()], [item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit “/ }));
    const list = screen.getByRole("list", { name: "Interrupts in Sprint 7" });
    fireEvent.click(within(list).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Edit “/ })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: /^Edit “/ }));
    fireEvent.click(within(list).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Edit “/ })).toHaveFocus());
  });

  it("move focus to the next row after a delete, then to the empty list", async () => {
    seed(
      [sprint()],
      [
        item({ id: "a", title: "Login broken", loggedAt: "2026-11-05T09:00:00.000Z" }),
        item({ id: "b", title: "Sales asks for an export", kind: "request" }),
      ]
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete “Login broken”" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Resolve “Sales asks for an export”" })
      ).toHaveFocus()
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete “Sales asks for an export”" }));
    await waitFor(() => expect(screen.getByText(/Nothing logged in Sprint 7 yet/)).toHaveFocus());
  });

  it("count only the sprint's own, and say how many have no size", async () => {
    seed(
      [sprint({ interruptBuffer: { points: 8 } })],
      [item({ size: undefined }), item({ id: "other", sprintId: "s9", title: "Elsewhere" })]
    );
    renderPage();
    expect(
      await screen.findByText("0 of 8 points used, 8 points left. 1 has no size yet.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Elsewhere")).toBeNull();
    expect(screen.getByText(/no size · logged/)).toBeInTheDocument();
  });

  it("are deleted with Undo", async () => {
    seed([sprint()], [item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete “/ }));
    expect(ws().interruptItems).toEqual([]);
    expect(logs.at(-1)?.action).toBe(INTERRUPT_BUFFER_ACTIONS.INTERRUPT_REMOVED);
    undoLast();
    expect(ws().interruptItems).toEqual([item()]);
  });

  it("have their kinds checked by the words, changed one by one with Undo", async () => {
    seed(
      [sprint()],
      [item({ title: "Customer can't reset their password", kind: "bug", size: undefined })]
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Check the kinds by the words" }));
    const list = await screen.findByTestId("ai-suggestions");
    fireEvent.click(within(list).getByRole("button", { name: /^Change:/ }));
    expect(ws().interruptItems?.[0]).toMatchObject({ kind: "support", size: 1 });
    undoLast();
    expect(ws().interruptItems?.[0]).toMatchObject({ kind: "bug" });
    expect(ws().interruptItems?.[0].size).toBeUndefined();
  });
});

describe("over the buffer", () => {
  it("shows the Emergency Procedure, started and ticked off", async () => {
    seed([sprint({ interruptBuffer: { points: 2 } })], [item({ size: 3 })]);
    renderPage();
    expect(
      await screen.findByText("3 of 2 points used: 1 point over the buffer.")
    ).toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Emergency Procedure" });
    fireEvent.click(within(panel).getByRole("button", { name: "Start the Emergency Procedure" }));
    expect(logs.at(-1)?.action).toBe(INTERRUPT_BUFFER_ACTIONS.EMERGENCY_STARTED);
    fireEvent.click(within(panel).getByLabelText(/Tell the Product Owner/));
    expect(emergencyFor(useInterruptBufferPrefs.getState().emergencies, "s1")?.done).toEqual([
      "inform",
    ]);
    expect(within(panel).getByText(/1 of 6 steps done/)).toBeInTheDocument();
  });

  it("moves focus to the first step once it is started", async () => {
    seed([sprint({ interruptBuffer: { points: 2 } })], [item({ size: 3 })]);
    renderPage();
    const panel = await screen.findByRole("region", { name: "Emergency Procedure" });
    fireEvent.click(within(panel).getByRole("button", { name: "Start the Emergency Procedure" }));
    await waitFor(() => expect(within(panel).getByLabelText(/Stop and look/)).toHaveFocus());
    expect(within(panel).queryByRole("button", { name: /Start the Emergency/ })).toBeNull();
  });

  it("shows the share used as a bar, and says when it is nearly used up", async () => {
    seed([sprint({ interruptBuffer: { points: 8 } })], [item({ size: 6 })]);
    renderPage();
    const bar = await screen.findByRole("progressbar", { name: "Buffer used" });
    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(bar).toHaveAttribute("aria-valuetext", "6 of 8 points used, 2 points left.");
    expect(screen.getByText("Nearly used up")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Emergency Procedure" })).toBeNull();
  });

  it("can't weigh a share of a sprint with no planned points yet, and says so", async () => {
    seed([sprint({ pointsPlanned: 0, interruptBuffer: { pct: 20 } })], [item()]);
    renderPage();
    expect(
      await screen.findByText(
        "The buffer is a share of the sprint, which has no planned points yet. 1 interrupt logged, 2 points.",
        { selector: '[data-field="buffer-summary"]' }
      )
    ).toBeInTheDocument();
    expect(screen.getByText("No buffer to weigh against")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Buffer used" })).toBeNull();
    expect(screen.getByText(/the share turns into points once it is planned/)).toBeInTheDocument();
  });

  it("is quiet while there is buffer left", async () => {
    seed([sprint({ interruptBuffer: { points: 8 } })], [item()]);
    renderPage();
    await screen.findByText("2 of 8 points used, 6 points left.");
    expect(screen.queryByRole("region", { name: "Emergency Procedure" })).toBeNull();
  });

  it("reads a saved run back safely", () => {
    expect(normalizeRun({ startedAt: "2026-11-05", done: ["stop", "stop", "nope", 3] })).toEqual({
      startedAt: "2026-11-05",
      done: ["stop"],
    });
    expect(normalizeRun({ done: [] })).toBeUndefined();
    expect(withStep({ startedAt: "x", done: ["stop"] }, "stop").done).toEqual([]);
  });
});

describe("history and export", () => {
  it("leaves a cancelled sprint out of the history", async () => {
    seed(
      [
        sprint({ interruptBuffer: { points: 5 } }),
        sprint({
          id: "sx",
          name: "Sprint X",
          startDate: "2026-10-19",
          endDate: "2026-10-30",
          status: "cancelled",
          interruptBuffer: { points: 4 },
        }),
      ],
      [item()]
    );
    renderPage();
    const table = await screen.findByRole("table", { name: "Interrupts by sprint" });
    expect(within(table).queryByText("Sprint X")).toBeNull();
  });

  it("lists each sprint's buffer and use, newest first", async () => {
    seed(
      [
        sprint({ interruptBuffer: { points: 5 } }),
        sprint({
          id: "s0",
          name: "Sprint 6",
          startDate: "2026-10-19",
          endDate: "2026-10-30",
          status: "completed",
          interruptBuffer: { points: 4 },
        }),
      ],
      [item(), item({ id: "i0", sprintId: "s0", size: 6 })]
    );
    renderPage();
    const table = await screen.findByRole("table", { name: "Interrupts by sprint" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Sprint 7",
      "Sprint 6over",
    ]);
  });

  it("exports the sprint's buffer and interrupts as Markdown and CSV", async () => {
    seed([sprint({ interruptBuffer: { pct: 20 } })], [item({ emergency: true })]);
    renderPage();
    await screen.findByText("2 of 6 points used, 4 points left.");
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("# Sprint 7 — interrupt buffer");
    expect(md).toContain("**Buffer:** 20% of the sprint (6 points)");
    expect(md).toContain("| 2026-11-04 | Checkout fails for one bank | Bug | 2 | Yes | Open |");
    expect(interruptsCsv([item()]).rows[0]).toEqual([
      "2026-11-04T09:00:00.000Z",
      "Checkout fails for one bank",
      "Bug",
      2,
      "",
      "",
    ]);
  });
});
