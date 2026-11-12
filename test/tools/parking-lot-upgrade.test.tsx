import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ParkingLotItem } from "@/lib/stores/workspace-types";
import { PARKING_LOT_ACTIONS } from "@/lib/history/event-actions";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

/**
 * Parking Lot on workspace.parkingLotItems: quick capture (Enter parks, the
 * meeting remembered, nothing saved blank), the open and decided lists,
 * discussed / dropped / reopened with Undo, "Send to…" through the hand-off
 * routes with a link both ways and Undo putting the status back, in-place
 * edit and delete with Undo, the meeting filter, the end-of-meeting review
 * (one tap per decision, Amr's cheer when the last point is decided), the
 * suggestions without AI (accept one, accept all, each with Undo) and with
 * it, clearing the decided points, the example (never sent, and never
 * offered as a send), the export, keyboard focus after every change, and
 * what the live announcer says.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/parking-lot",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (...args: unknown[]) => cheers.push(args),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
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
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { ParkingLotClient } from "@/app/(tools)/parking-lot/parking-lot-client";

const ws = () => useWorkspaceStore.getState();
const points = () => ws().parkingLotItems ?? [];
const point = (id: string) => points().find((i) => i.id === id);

const item = (over: Partial<ParkingLotItem> = {}): ParkingLotItem => ({
  id: "p1",
  text: "Who owns the release checklist?",
  meeting: "Daily Scrum",
  status: "open",
  createdAt: "2026-11-12T09:00:00.000Z",
  updatedAt: "2026-11-12T09:00:00.000Z",
  ...over,
});
const seed = (parkingLotItems: ParkingLotItem[]) =>
  useWorkspaceStore.setState({ parkingLotItems, stories: [], impediments: [], retroBoards: [] });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ParkingLotClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/** Click Undo on the newest toast. */
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};
const logged = (action: string) => logs.filter((l) => l.action === action);
const pointField = () => screen.getByRole("textbox", { name: /^Point to park/ });
const meetingField = () => screen.getByRole("textbox", { name: /^Meeting/ });
const openSendTo = (name: RegExp) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
/** A point's text on screen, where focus lands after a change. */
const textOf = (id: string) => document.querySelector(`[data-parking-text="${id}"]`);
const focusIs = (el: () => Element | null) =>
  waitFor(() => {
    const target = el();
    expect(target).not.toBeNull();
    expect(document.activeElement).toBe(target);
  });
/** What the live announcer said last. */
const announced = (text: string | RegExp) =>
  waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(text));
/** Press Undo on every toast since `from`, newest first. */
const undoSince = (from: number) => {
  for (const call of toastSpy.mock.calls.slice(from).reverse()) {
    const opts = call[1] as { action?: { onClick: () => void } } | undefined;
    act(() => opts?.action?.onClick());
  }
};
const toReview = () =>
  fireEvent.click(screen.getByRole("radio", { name: "End-of-meeting review" }));

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  seed([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("an empty parking lot", () => {
  it("says what it is for and offers the example, which is never sent anywhere", async () => {
    renderPage();
    expect(await screen.findByText(/Nothing parked yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(points().length).toBe(7);
    expect(points().every((i) => i.id.startsWith("example-"))).toBe(true);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    const send = screen.getAllByRole("button", { name: /^Send to…/ })[0];
    expect(send).toBeDisabled();
    expect(logs).toEqual([]);
  });

  it("clears only the example, with Undo", async () => {
    seed([item()]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    act(() => {
      ws().upsertParkingLotItem(item({ id: "example-x", text: "Example point" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(points().map((i) => i.id)).toEqual(["p1"]);
    undoLast();
    expect(point("example-x")).toBeDefined();
  });
});

describe("quick capture", () => {
  it("parks a point on Enter, keeps the meeting for the next one, and clears the rest", async () => {
    renderPage();
    await screen.findByText(/Nothing parked yet/);
    fireEvent.change(pointField(), { target: { value: "  Who signs off releases?  " } });
    fireEvent.change(meetingField(), { target: { value: "Sprint Planning" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Raised by" }), {
      target: { value: "Priya" },
    });
    fireEvent.submit(pointField().closest("form")!);
    expect(points()).toEqual([
      expect.objectContaining({
        text: "Who signs off releases?",
        meeting: "Sprint Planning",
        raisedBy: "Priya",
        status: "open",
      }),
    ]);
    expect(points()[0].id).toMatch(/^parking_/);
    expect(points()[0].createdAt).toBe(points()[0].updatedAt);
    expect(logged(PARKING_LOT_ACTIONS.ITEM_PARKED)).toEqual([
      { action: "item_parked", payload: { itemId: points()[0].id, meeting: "Sprint Planning" } },
    ]);
    expect(pointField()).toHaveValue("");
    expect(meetingField()).toHaveValue("Sprint Planning");
    expect(screen.getByRole("combobox", { name: "Raised by" })).toHaveValue("");
  });

  it("starts with the meeting of the last point parked, and saves nothing blank", async () => {
    seed([item({ meeting: "Daily Scrum" })]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    expect(meetingField()).toHaveValue("Daily Scrum");
    fireEvent.submit(pointField().closest("form")!);
    expect(await screen.findByText("Say what the point is.")).toBeInTheDocument();
    expect(points()).toHaveLength(1);
  });
});

describe("deciding a point in the list", () => {
  it("marks it discussed with Undo, and Amr cheers when the last open point is decided", async () => {
    seed([item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Discussed: Who owns/ }));
    expect(point("p1")?.status).toBe("discussed");
    expect(logged(PARKING_LOT_ACTIONS.ITEM_DISCUSSED)).toHaveLength(1);
    expect(cheers).toEqual([["parking-lot", "done"]]);
    expect(screen.getByRole("heading", { name: "Decided (1)" })).toBeInTheDocument();
    undoLast();
    expect(point("p1")?.status).toBe("open");
  });

  it("drops a point and reopens it", async () => {
    seed([item(), item({ id: "p2", text: "Second point" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Drop: Who owns/ }));
    expect(point("p1")?.status).toBe("dropped");
    expect(logged(PARKING_LOT_ACTIONS.ITEM_DROPPED)).toHaveLength(1);
    expect(cheers).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /^Reopen: Who owns/ }));
    expect(point("p1")?.status).toBe("open");
    expect(logged(PARKING_LOT_ACTIONS.ITEM_UPDATED).at(-1)?.payload).toEqual({
      itemId: "p1",
      fields: ["status"],
    });
  });
});

describe("Send to…", () => {
  it("puts the point on the backlog with a link both ways; Undo takes it back and reopens it", async () => {
    seed([item({ raisedBy: "Priya" })]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    openSendTo(/^Send to… Who owns/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    expect(ws().stories).toEqual([
      expect.objectContaining({
        title: "Who owns the release checklist?",
        status: "backlog",
        sourceRef: { tool: "parking-lot", id: "p1" },
      }),
    ]);
    const storyId = ws().stories[0].id;
    expect(point("p1")).toMatchObject({
      status: "sent",
      sentTo: [expect.objectContaining({ route: "backlog-story", targetId: storyId })],
    });
    expect(logged(PARKING_LOT_ACTIONS.ITEM_SENT)[0].payload).toEqual({
      itemId: "p1",
      route: "backlog-story",
      targetId: storyId,
    });
    expect(screen.getByText(/Sent to the backlog/)).toBeInTheDocument();
    const open = screen.getByRole("link", {
      name: "Open on the backlog: Who owns the release checklist?",
    });
    expect(open).toHaveAttribute("href", "/sprint-planning");
    expect(open).toHaveTextContent("Open");
    expect(open).toHaveClass("min-touch-coarse");

    undoLast();
    expect(ws().stories).toEqual([]);
    expect(point("p1")?.status).toBe("open");
    expect(point("p1")).not.toHaveProperty("sentTo");
  });

  it("raises an impediment, then shows the route as sent", async () => {
    seed([item()]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    openSendTo(/^Send to… Who owns/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));
    expect(ws().impediments).toEqual([
      expect.objectContaining({ title: "Who owns the release checklist?", severity: "medium" }),
    ]);
    openSendTo(/^Send to… Who owns.*\(sent\)$/);
    expect(screen.getByRole("menuitem", { name: /Impediment.*Sent · Open/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Retro action" }));
    const board = (ws().retroBoards ?? []).find((b) => b.id === "retro:current");
    expect(board?.cards).toEqual([
      expect.objectContaining({ isActionItem: true, sourceRef: { tool: "parking-lot", id: "p1" } }),
    ]);
    expect(point("p1")?.sentTo?.map((l) => l.route)).toEqual(["impediment", "retro-action"]);
  });
});

describe("editing and deleting", () => {
  it("edits a point in place with the same checks, and logs the fields changed", async () => {
    seed([item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit: Who owns/ }));
    const row = document.getElementById("parking-p1")!;
    const text = within(row).getByRole("textbox", { name: /^Point/ });
    fireEvent.change(text, { target: { value: " " } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(await within(row).findByText("Say what the point is.")).toBeInTheDocument();
    fireEvent.change(text, { target: { value: "Who owns releases now?" } });
    fireEvent.change(within(row).getByRole("textbox", { name: /^Meeting/ }), {
      target: { value: "" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    expect(point("p1")?.text).toBe("Who owns releases now?");
    expect(point("p1")).not.toHaveProperty("meeting");
    expect(logged(PARKING_LOT_ACTIONS.ITEM_UPDATED)[0].payload).toEqual({
      itemId: "p1",
      fields: ["text", "meeting"],
    });
  });

  it("deletes a point with Undo", async () => {
    seed([item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete: Who owns/ }));
    expect(points()).toEqual([]);
    expect(logged(PARKING_LOT_ACTIONS.ITEM_REMOVED)).toHaveLength(1);
    undoLast();
    expect(point("p1")).toBeDefined();
  });
});

describe("meetings", () => {
  it("filters the lists and the export by meeting", async () => {
    seed([
      item(),
      item({
        id: "p2",
        text: "Pricing for spring",
        meeting: "Sprint Planning",
        createdAt: "2026-11-11T09:00:00Z",
      }),
    ]);
    renderPage();
    await screen.findByText("Pricing for spring");
    const filter = screen.getByRole("radiogroup", { name: "Meeting" });
    fireEvent.click(within(filter).getByRole("radio", { name: "Sprint Planning (1 open)" }));
    expect(screen.queryByText("Who owns the release checklist?")).toBeNull();
    expect(screen.getByText("Pricing for spring")).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "# Parking lot — Sprint Planning"
    );
    fireEvent.click(within(filter).getByRole("radio", { name: "All meetings" }));
    expect(screen.getByText("Who owns the release checklist?")).toBeInTheDocument();
  });
});

describe("the end-of-meeting review", () => {
  it("decides each open point with one tap, then says all are decided", async () => {
    seed([item(), item({ id: "p2", text: "Old idea", createdAt: "2026-11-12T09:01:00Z" })]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    fireEvent.click(screen.getByRole("radio", { name: "End-of-meeting review" }));
    expect(screen.getByText(/2 open points to decide/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Send to impediments: Who owns/ }));
    expect(ws().impediments).toHaveLength(1);
    expect(point("p1")?.status).toBe("sent");
    expect(cheers).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /^Drop: Old idea/ }));
    expect(point("p2")?.status).toBe("dropped");
    expect(screen.getByText(/Every point here is decided/)).toHaveTextContent(
      "0 open · 1 sent · 1 dropped"
    );
    expect(cheers).toEqual([["parking-lot", "done"]]);
  });

  it("suggests where each point goes without AI, and applies only what is accepted", async () => {
    seed([
      item({ text: "We are blocked on the payments team's approval" }),
      item({ id: "p2", text: "Customers want a CSV export", createdAt: "2026-11-12T09:01:00Z" }),
      item({ id: "p3", text: "Never mind, already decided", createdAt: "2026-11-12T09:02:00Z" }),
    ]);
    renderPage();
    await screen.findByText("Customers want a CSV export");
    fireEvent.click(screen.getByRole("radio", { name: "End-of-meeting review" }));
    fireEvent.click(screen.getByRole("button", { name: "Suggest where each goes" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested without AI. Check before you add.")
    ).toBeInTheDocument();
    expect(points().every((i) => i.status === "open")).toBe(true);

    fireEvent.click(
      within(list).getByRole("button", { name: /^Accept: Impediment: We are blocked/ })
    );
    expect(ws().impediments).toHaveLength(1);
    expect(point("p1")?.status).toBe("sent");

    fireEvent.click(within(list).getByRole("button", { name: "Accept all 2" }));
    expect(ws().stories).toEqual([
      expect.objectContaining({
        title: "Customers want a CSV export",
        sourceRef: { tool: "parking-lot", id: "p2" },
      }),
    ]);
    expect(point("p3")?.status).toBe("dropped");
    expect(logged(PARKING_LOT_ACTIONS.ITEM_SENT).map((l) => l.payload?.route)).toEqual([
      "impediment",
      "backlog-story",
    ]);
    expect(logged(PARKING_LOT_ACTIONS.ITEM_DROPPED)).toHaveLength(1);
    expect(cheers).toEqual([["parking-lot", "done"]]);
  });
});

describe("clearing the decided points", () => {
  it("asks first, removes only the decided ones, and Undo brings them back", async () => {
    seed([item(), item({ id: "p2", text: "Done one", status: "discussed" })]);
    renderPage();
    await screen.findByText("Done one");
    fireEvent.click(screen.getByRole("button", { name: "Clear decided points" }));
    const dialog = screen.getByRole("dialog", { name: "Clear the decided points?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear points" }));
    expect(points().map((i) => i.id)).toEqual(["p1"]);
    expect(logged(PARKING_LOT_ACTIONS.PARKING_LOT_RESET)[0].payload).toEqual({ count: 1 });
    undoLast();
    await waitFor(() => expect(point("p2")).toBeDefined());
  });
});

describe("the export", () => {
  it("lists the points as a checklist, open first", async () => {
    seed([item({ raisedBy: "Sam" }), item({ id: "p2", text: "Settled", status: "discussed" })]);
    renderPage();
    await screen.findByText("Settled");
    const md = screen.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("- [ ] Who owns the release checklist? (raised by Sam)");
    expect(md).toContain("- [x] Settled — discussed");
  });
});

describe("more ways to decide", () => {
  it("reopens a discussed point, and Undo marks it discussed again", async () => {
    seed([item({ status: "discussed" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Reopen: Who owns/ }));
    expect(point("p1")?.status).toBe("open");
    await announced("Reopened “Who owns the release checklist?”");
    undoLast();
    expect(point("p1")?.status).toBe("discussed");
  });

  it("reopens or drops a sent point whose item was removed there, never one still live", async () => {
    seed([
      item({
        status: "sent",
        sentTo: [{ route: "backlog-story", targetId: "gone", at: "2026-11-12T09:30:00Z" }],
      }),
    ]);
    renderPage();
    expect(await screen.findByText(/Sent to the backlog, since removed there/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Discussed: Who owns/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Drop: Who owns/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Reopen: Who owns/ }));
    expect(point("p1")?.status).toBe("open");
    await focusIs(() => textOf("p1"));

    act(() => ws().upsertStory({ id: "s1", title: "Live", status: "backlog" }));
    act(() =>
      ws().upsertParkingLotItem(
        item({
          id: "p2",
          text: "Still on the backlog",
          status: "sent",
          sentTo: [{ route: "backlog-story", targetId: "s1", at: "2026-11-12T09:30:00Z" }],
        })
      )
    );
    expect(await screen.findByText("Still on the backlog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reopen: Still on/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Drop: Still on/ })).toBeNull();
  });

  it("filters to the points parked with no meeting, and names that in the export", async () => {
    seed([item(), item({ id: "p2", text: "Loose point", meeting: undefined })]);
    renderPage();
    await screen.findByText("Loose point");
    const filter = screen.getByRole("radiogroup", { name: "Meeting" });
    fireEvent.click(within(filter).getByRole("radio", { name: "No meeting named (1 open)" }));
    expect(screen.queryByText("Who owns the release checklist?")).toBeNull();
    expect(screen.getByText("Loose point")).toBeInTheDocument();
    expect(screen.getByTestId("export-markdown").textContent).toContain(
      "# Parking lot — No meeting named"
    );
  });

  it("says each change out loud: parked, then sent", async () => {
    renderPage();
    await screen.findByText(/Nothing parked yet/);
    fireEvent.change(pointField(), { target: { value: "Who signs off releases?" } });
    fireEvent.submit(pointField().closest("form")!);
    await announced("Parked “Who signs off releases?”");
    openSendTo(/^Send to… Who signs/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    await announced("Sent “Who signs off releases?” to the backlog");
  });
});

describe("the review, further", () => {
  it("marks a point discussed in the review, and Undo puts the card back", async () => {
    seed([item()]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    toReview();
    fireEvent.click(screen.getByRole("button", { name: /^Discussed: Who owns/ }));
    expect(point("p1")?.status).toBe("discussed");
    expect(logged(PARKING_LOT_ACTIONS.ITEM_DISCUSSED)).toHaveLength(1);
    expect(screen.getByText(/Every point here is decided/)).toBeInTheDocument();
    undoLast();
    expect(point("p1")?.status).toBe("open");
    expect(await screen.findByText(/1 open point to decide/)).toBeInTheDocument();
  });

  it("names each send button by where it sends the point", async () => {
    seed([item()]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    toReview();
    const buttons: [string, RegExp][] = [
      ["To backlog", /^Send to backlog: Who owns/],
      ["To impediments", /^Send to impediments: Who owns/],
      ["To retro actions", /^Send to retro actions: Who owns/],
    ];
    for (const [label, name] of buttons) {
      expect(screen.getByRole("button", { name })).toHaveTextContent(label);
    }
  });

  it("Accept all sends each point on its route, and each Undo takes it back", async () => {
    seed([
      item({ text: "We are blocked on the payments team's approval" }),
      item({ id: "p2", text: "Customers want a CSV export", createdAt: "2026-11-12T09:01:00Z" }),
      item({
        id: "p3",
        text: "We should agree how we hand over on-call",
        createdAt: "2026-11-12T09:02:00Z",
      }),
      item({ id: "p4", text: "Never mind, already decided", createdAt: "2026-11-12T09:03:00Z" }),
    ]);
    renderPage();
    await screen.findByText("Customers want a CSV export");
    toReview();
    fireEvent.click(screen.getByRole("button", { name: "Suggest where each goes" }));
    const list = await screen.findByTestId("ai-suggestions");
    const before = toastSpy.mock.calls.length;
    fireEvent.click(within(list).getByRole("button", { name: "Accept all 4" }));

    const cards = () =>
      (ws().retroBoards ?? [])
        .flatMap((b) => b.cards)
        .filter((c) => c.sourceRef?.tool === "parking-lot");
    expect(ws().stories).toHaveLength(1);
    expect(ws().impediments).toHaveLength(1);
    expect(cards()).toHaveLength(1);
    expect(points().map((i) => i.status)).toEqual(["sent", "sent", "sent", "dropped"]);
    await announced("Decided 4 points");
    expect(cheers).toEqual([["parking-lot", "done"]]);

    // One toast per route, and one for the drops.
    expect(toastSpy.mock.calls.length - before).toBe(4);
    undoSince(before);
    expect(ws().stories).toEqual([]);
    expect(ws().impediments).toEqual([]);
    expect(cards()).toEqual([]);
    expect(points().every((i) => i.status === "open" && !i.sentTo)).toBe(true);
  });

  it("offers only drops for example points: a send would change nothing", async () => {
    seed([
      item({ id: "example-a", text: "We are blocked on the payments team's approval" }),
      item({
        id: "example-b",
        text: "Never mind, already decided",
        createdAt: "2026-11-12T09:01:00Z",
      }),
    ]);
    renderPage();
    await screen.findByText("Never mind, already decided");
    toReview();
    fireEvent.click(screen.getByRole("button", { name: "Suggest where each goes" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      screen.getByText(/1 suggestion to send an example point on is left out: example points stay/)
    ).toBeInTheDocument();
    expect(within(list).queryByText(/We are blocked/)).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: /^Accept: Drop: Never mind/ }));
    expect(point("example-b")?.status).toBe("dropped");
    expect(point("example-a")?.status).toBe("open");
    expect(ws().impediments).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("says so when every suggestion would send an example point, and offers none", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Load an example" }));
    toReview();
    fireEvent.click(screen.getByRole("button", { name: "Suggest where each goes" }));
    expect(
      await screen.findByText(/5 suggestions to send example points on are left out/)
    ).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("ai-suggestions")).toBeNull();
    expect(screen.queryByText(/No suggestion fits/)).toBeNull();
  });

  it("still suggests for the other points when one has an id the task can't take", async () => {
    const longId = `parking_${"x".repeat(70)}`;
    seed([
      item({ id: longId, text: "We are blocked on approvals" }),
      item({ id: "p2", text: "Customers want a CSV export", createdAt: "2026-11-12T09:01:00Z" }),
    ]);
    renderPage();
    await screen.findByText("Customers want a CSV export");
    toReview();
    fireEvent.click(screen.getByRole("button", { name: "Suggest where each goes" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Backlog story: Customers want a CSV export")
    ).toBeInTheDocument();
    expect(within(list).queryByText(/We are blocked/)).toBeNull();
    expect(screen.queryByText(/Fill in the tool first/)).toBeNull();
  });

  it("shows Amr's AI answer as his, and applies only what is accepted", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              routes: [
                { id: "p1", destination: "action", reason: "It is about how the team works." },
                { id: "made-up", destination: "drop", reason: "Not a point on the list." },
              ],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed([item()]);
    renderPage();
    await screen.findByText("Who owns the release checklist?");
    toReview();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Amr where each goes" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested by Amr's AI. Check before you add.")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(list).queryByText(/Not a point on the list/)).toBeNull();
    expect(point("p1")?.status).toBe("open");
    fireEvent.click(within(list).getByRole("button", { name: /^Accept: Retro action: Who owns/ }));
    expect(point("p1")?.sentTo?.map((l) => l.route)).toEqual(["retro-action"]);
  });
});

describe("keyboard focus stays on the page", () => {
  it("moves to the next open point after one is marked discussed, then to the last one itself", async () => {
    seed([item(), item({ id: "p2", text: "Second point", createdAt: "2026-11-12T09:01:00Z" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Discussed: Who owns/ }));
    await focusIs(() => textOf("p2"));
    fireEvent.click(screen.getByRole("button", { name: /^Discussed: Second point/ }));
    await focusIs(() => textOf("p2"));
  });

  it("keeps focus after a reopen and a drop", async () => {
    seed([
      item({ status: "discussed" }),
      item({
        id: "p2",
        text: "Second point",
        status: "dropped",
        createdAt: "2026-11-12T09:01:00Z",
      }),
      item({ id: "p3", text: "Third point", createdAt: "2026-11-12T09:02:00Z" }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Reopen: Who owns/ }));
    // It left the decided list: focus goes to the next point there.
    await focusIs(() => textOf("p2"));
    fireEvent.click(screen.getByRole("button", { name: /^Drop: Third point/ }));
    // The open list now has the reopened point before it.
    await focusIs(() => textOf("p1"));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("moves to the next open point after a send from the menu", async () => {
    seed([item(), item({ id: "p2", text: "Second point", createdAt: "2026-11-12T09:01:00Z" })]);
    renderPage();
    await screen.findByText("Second point");
    openSendTo(/^Send to… Who owns/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));
    expect(point("p1")?.status).toBe("sent");
    await focusIs(() => textOf("p2"));
  });

  it("moves to the next point after a delete, and back to the point on Undo", async () => {
    seed([item(), item({ id: "p2", text: "Second point", createdAt: "2026-11-12T09:01:00Z" })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Delete: Who owns/ }));
    await focusIs(() => textOf("p2"));
    undoLast();
    await focusIs(() => textOf("p1"));
  });

  it("returns to the point after an edit is cancelled or saved", async () => {
    seed([item()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Edit: Who owns/ }));
    fireEvent.click(
      within(document.getElementById("parking-p1")!).getByRole("button", { name: "Cancel" })
    );
    await focusIs(() => textOf("p1"));
    fireEvent.click(screen.getByRole("button", { name: /^Edit: Who owns/ }));
    const row = document.getElementById("parking-p1")!;
    fireEvent.change(within(row).getByRole("textbox", { name: /^Point/ }), {
      target: { value: "Who owns releases now?" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await focusIs(() => textOf("p1"));
    await announced("Saved “Who owns releases now?”");
  });

  it("moves through the review card by card, then to its heading; Dismiss keeps it there", async () => {
    seed([item(), item({ id: "p2", text: "Second point", createdAt: "2026-11-12T09:01:00Z" })]);
    renderPage();
    await screen.findByText("Second point");
    toReview();
    fireEvent.click(screen.getByRole("button", { name: "Suggest where each goes" }));
    const list = await screen.findByTestId("ai-suggestions");
    fireEvent.click(within(list).getByRole("button", { name: "Dismiss suggestions" }));
    const heading = () => screen.getByRole("heading", { name: "End-of-meeting review" });
    expect(document.activeElement).toBe(heading());
    fireEvent.click(screen.getByRole("button", { name: /^Drop: Who owns/ }));
    await focusIs(() => screen.getByRole("button", { name: /^Discussed: Second point/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Discussed: Second point/ }));
    await focusIs(heading);
  });
});
