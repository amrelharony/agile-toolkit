import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

/**
 * The Stakeholder Map, upgraded: nobody is placed until you place them (no
 * 5/5 default in Manage Closely), a 2×2 you can drag on or move with the
 * arrow keys (announced, saved once), "Place in…" for the unplaced, current
 * vs desired sentiment with the gap, last contact and next touch, Undo on
 * deletes and the reset, an in-memory example, a Markdown export, and theme
 * tokens instead of hex. Old saved maps still load in place.
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
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
// What the page hands the AI prompt, to check its counts against its list.
const promptData = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock("@/lib/ai-prompts/stakeholder-map", () => ({
  generateStakeholderMapPrompts: (data: Record<string, unknown>) => {
    promptData.last = data;
    return [];
  },
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
// Radix Slider measures itself; jsdom doesn't ship ResizeObserver.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { StakeholderMapClient } from "@/app/(tools)/stakeholder-map/stakeholder-map-client";
import { buildExample } from "@/app/(tools)/stakeholder-map/example";
import { stakeholdersToMarkdown } from "@/app/(tools)/stakeholder-map/markdown";
import { validateStakeholder } from "@/app/(tools)/stakeholder-map/stakeholder-form";
import {
  STORAGE_KEY,
  gapText,
  moveBy,
  normalizeStakeholders,
  placeIn,
  quadrantOf,
  sentimentGap,
  stakeholderVerdict,
  touchStatus,
  type Stakeholder,
} from "@/app/(tools)/stakeholder-map/model";

const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, n) as string;

const stakeholder = (id: string, over: Partial<Stakeholder> = {}): Stakeholder => ({
  id,
  name: id,
  interest: null,
  authority: null,
  currentSentiment: null,
  desiredSentiment: null,
  ...over,
});

const seed = (list: unknown) => localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
const stored = (): Stakeholder[] => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <StakeholderMapClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

/**
 * Text of the compact StatCard whose label is `label` (its label is a
 * span.truncate; quadrant names also appear on the map and in pickers).
 */
const card = (label: string) =>
  screen.getByText(label, { selector: "span.truncate" }).parentElement!.parentElement!.textContent;
const map = () => screen.getByRole("group", { name: "Interest × Authority map" });
const updates = () => logs.filter((l) => l.action === "stakeholder_updated");

const undoLast = () => {
  const [, opts] = toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
  act(() => opts.action.onClick());
};

beforeEach(() => {
  localStorage.clear();
  toastSpy.mockReset();
  logs.length = 0;
});

/* ── The model ──────────────────────────────────────────────────────── */

describe("normalizeStakeholders", () => {
  it("reads the old single sentiment as the current one and keeps old places", () => {
    const legacy = [
      { id: "a", name: "Priya", interest: 5, authority: 5, sentiment: "skeptic", extra: 1 },
      { id: "b", name: "Ken", interest: 4.6, authority: 12, sentiment: "nope" },
      { id: "c", name: "Ana", sentiment: "blocker", currentSentiment: null, lastContactAt: "x" },
      "junk",
    ];
    const once = normalizeStakeholders(legacy);
    expect(once.map((s) => [s.interest, s.authority, s.currentSentiment])).toEqual([
      [5, 5, "skeptic"],
      [4.6, 10, null],
      [null, null, null],
    ]);
    // A legacy 5/5 can't be told from a choice: it stays where it was.
    expect(quadrantOf(once[0])).toBe("manageClosely");
    expect(quadrantOf(once[1])).toBe("keepSatisfied");
    expect(once[0]).toHaveProperty("extra", 1);
    expect(once[2]).not.toHaveProperty("lastContactAt");
    expect(normalizeStakeholders(once)).toEqual(once);
    expect(normalizeStakeholders({})).toEqual([]);
  });
});

describe("positions, sentiment and touches", () => {
  it("leaves the unplaced out of every quadrant", () => {
    expect(quadrantOf({ interest: null, authority: 9 })).toBeNull();
    expect(quadrantOf({ interest: 5, authority: 5 })).toBe("manageClosely");
    expect(quadrantOf({ interest: 4, authority: 5 })).toBe("keepSatisfied");
    expect(quadrantOf({ interest: 5, authority: 4 })).toBe("keepInformed");
    expect(quadrantOf({ interest: 0, authority: 0 })).toBe("monitor");
  });

  it("moves on the 0–10 scale and places in a quadrant's middle", () => {
    const s = stakeholder("a", { interest: 9, authority: 1 });
    expect(moveBy(s, "interest", 3).interest).toBe(10);
    expect(moveBy(s, "authority", -3).authority).toBe(0);
    expect(moveBy(stakeholder("b"), "interest", 1).interest).toBe(6);
    expect(placeIn(stakeholder("c"), "keepInformed")).toMatchObject({ interest: 8, authority: 2 });
  });

  it("measures the sentiment gap in steps", () => {
    expect(sentimentGap({ currentSentiment: "blocker", desiredSentiment: "supporter" })).toBe(3);
    expect(gapText(3)).toBe("3 steps short");
    expect(gapText(-1)).toBe("1 step past");
    expect(gapText(0)).toBe("on target");
    expect(sentimentGap({ currentSentiment: null, desiredSentiment: "champion" })).toBeNull();
  });

  it("reads the next touch as overdue, due this week, planned, or none", () => {
    expect(touchStatus({ nextTouchAt: day(-1) }, TODAY)).toBe("overdue");
    expect(touchStatus({ nextTouchAt: TODAY }, TODAY)).toBe("due-soon");
    expect(touchStatus({ nextTouchAt: day(7) }, TODAY)).toBe("due-soon");
    expect(touchStatus({ nextTouchAt: day(8) }, TODAY)).toBe("scheduled");
    expect(touchStatus({}, TODAY)).toBe("none");
  });

  it("says who is short of where you need them, and the most overdue touch", () => {
    expect(stakeholderVerdict([], TODAY)).toBe("No stakeholders yet.");
    expect(stakeholderVerdict([stakeholder("a")], TODAY)).toBe(
      "1 stakeholder, none placed on the map yet."
    );
    expect(stakeholderVerdict(buildExample(TODAY), TODAY)).toBe(
      "2 of 4 Manage Closely stakeholders are below where you need them; Priya Shah's next touch was due 3 days ago; 1 not placed yet."
    );
  });

  it("needs a name, and starts everything else unset", () => {
    expect(
      validateStakeholder({
        name: " ",
        role: "",
        quadrant: "",
        current: "",
        desired: "",
        strategy: "",
      })
    ).toEqual({ ok: false, errors: { name: "Who is the stakeholder?" } });
    expect(
      validateStakeholder({
        name: "Kim",
        role: "",
        quadrant: "",
        current: "",
        desired: "",
        strategy: "",
      })
    ).toEqual({
      ok: true,
      values: {
        name: "Kim",
        interest: null,
        authority: null,
        currentSentiment: null,
        desiredSentiment: null,
      },
    });
  });
});

describe("Markdown", () => {
  it("lists stakeholders by quadrant, the unplaced, and the touches due", () => {
    const md = stakeholdersToMarkdown(buildExample(TODAY), TODAY);
    expect(md).toContain("## Manage Closely");
    expect(md).toContain(
      `- **Marco Ruiz** (Head of Payments) · interest 7, authority 8 · Blocker → Supporter (3 steps short) · last contact ${day(-6)} · next touch ${day(8)} — Co-design the fraud checks with his team.`
    );
    expect(md).toContain("## Not placed yet");
    expect(md).toContain("- **Jo Park** (New data protection officer) · sentiment not set");
    expect(md).toContain(`- ${day(-3)} · Priya Shah (overdue by 3 days)`);
    expect(md.indexOf("Priya Shah (overdue")).toBeLessThan(md.indexOf("Omar Haddad (in 4 days)"));
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("Stakeholder page", () => {
  it("adds a stakeholder unplaced, out of Manage Closely", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add stakeholder" }));
    expect(await screen.findByText("Who is the stakeholder?")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Stakeholder name" })).toHaveFocus()
    );
    expect(stored()).toEqual([]);

    fireEvent.change(screen.getByRole("textbox", { name: "Stakeholder name" }), {
      target: { value: "Kim Lee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add stakeholder" }));
    expect(stored()[0]).toMatchObject({ name: "Kim Lee", interest: null, authority: null });
    expect(card("Manage Closely")).toBe("Manage Closely0");
    expect(card("Total")).toContain("1 not placed yet");
    const tray = screen.getByRole("region", { name: "Not placed yet" });
    expect(within(tray).getByText("Kim Lee")).toBeInTheDocument();
  });

  it("places someone from the tray with the quadrant picker", async () => {
    seed([stakeholder("kim", { name: "Kim" })]);
    renderPage();
    const tray = screen.getByRole("region", { name: "Not placed yet" });
    const pick = within(tray).getByLabelText("Place Kim in");
    act(() => pick.focus());
    fireEvent.change(pick, { target: { value: "manageClosely" } });
    expect(stored()[0]).toMatchObject({ interest: 8, authority: 8 });
    expect(card("Manage Closely")).toBe("Manage Closely1");
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Kim: interest 8, authority 8, Manage Closely"
      )
    );
    // The chip (and its select) went: focus is on Kim's new dot.
    await waitFor(() => expect(within(map()).getByRole("button", { name: /^Kim:/ })).toHaveFocus());
  });

  it("places someone from their row, announced, with focus on the Interest slider", async () => {
    seed([stakeholder("kim", { name: "Kim" })]);
    renderPage();
    const tray = screen.getByRole("region", { name: "Not placed yet" });
    const rowPick = screen
      .getAllByLabelText("Place Kim in")
      .find((el) => !tray.contains(el)) as HTMLElement;
    act(() => rowPick.focus());
    fireEvent.change(rowPick, { target: { value: "monitor" } });
    expect(stored()[0]).toMatchObject({ interest: 2, authority: 2 });
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Kim: interest 2, authority 2, Monitor"
      )
    );
    await waitFor(() =>
      expect(screen.getByRole("slider", { name: "Interest for Kim" })).toHaveFocus()
    );
  });

  it("never saves a last contact after today, and names each date field", () => {
    seed([stakeholder("kim", { name: "Kim", lastContactAt: day(-3) })]);
    renderPage();
    const last = screen.getByLabelText("Last contact with Kim");
    fireEvent.change(last, { target: { value: day(2) } });
    expect(stored()[0].lastContactAt).toBe(day(-3));
    fireEvent.change(last, { target: { value: day(-1) } });
    expect(stored()[0].lastContactAt).toBe(day(-1));
    fireEvent.change(last, { target: { value: "" } });
    expect(stored()[0]).not.toHaveProperty("lastContactAt");
    fireEvent.change(screen.getByLabelText("Next touch with Kim"), {
      target: { value: day(4) },
    });
    expect(stored()[0].nextTouchAt).toBe(day(4));
  });

  it("hands the AI prompt every stakeholder, so its counts are the cards'", async () => {
    seed([
      stakeholder("a", {
        name: "Ana",
        interest: 8,
        authority: 8,
        currentSentiment: "blocker",
      }),
      // Not placed, and placed without a sentiment: in the prompt too, read
      // as not placed / not set.
      stakeholder("b", { name: "Ben", currentSentiment: "blocker" }),
      stakeholder("c", { name: "Cleo", interest: 9, authority: 9 }),
    ]);
    renderPage();
    const data = promptData.last as { stakeholders: Stakeholder[]; today: string };
    expect(data.stakeholders.map((s) => s.name)).toEqual(["Ana", "Ben", "Cleo"]);
    expect(data.today).toBe(TODAY);
    const actual = await vi.importActual<typeof import("@/lib/ai-prompts/stakeholder-map")>(
      "@/lib/ai-prompts/stakeholder-map"
    );
    const [strategy] = actual.generateStakeholderMapPrompts(data);
    expect(strategy.prompt).toContain("3 stakeholders (1 not placed on the map yet).");
    expect(strategy.prompt).toContain("Manage Closely: 2, Keep Satisfied: 0");
    expect(strategy.prompt).toContain("- Blockers: 2");
    // The page's own cards say the same.
    expect(card("Blockers")).toContain("2");
    expect(card("Manage Closely")).toBe("Manage Closely2");
  });

  it("moves a dot with the arrow keys, announced, and saves once on blur", async () => {
    seed([stakeholder("priya", { name: "Priya", interest: 4, authority: 6 })]);
    renderPage();
    const dot = within(map()).getByRole("button", { name: /^Priya:/ });
    expect(dot).toHaveAccessibleName("Priya: interest 4, authority 6, Keep Satisfied");
    act(() => dot.focus());
    fireEvent.keyDown(dot, { key: "ArrowRight" });
    fireEvent.keyDown(dot, { key: "ArrowUp", shiftKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("live-polite")).toHaveTextContent(
        "Priya: interest 5, authority 9, Manage Closely"
      )
    );
    expect(stored()[0]).toMatchObject({ interest: 4, authority: 6 });
    fireEvent.blur(dot);
    expect(stored()[0]).toMatchObject({ interest: 5, authority: 9 });
    expect(updates()).toHaveLength(1);
    expect(card("Manage Closely")).toBe("Manage Closely1");
  });

  it("drags a dot with the pointer and saves one update on release", () => {
    seed([stakeholder("priya", { name: "Priya", interest: 2, authority: 2 })]);
    renderPage();
    const grid = map();
    grid.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 200,
        right: 200,
        bottom: 200,
        x: 0,
        y: 0,
      }) as DOMRect;
    const dot = within(grid).getByRole("button", { name: /^Priya:/ });
    fireEvent.pointerDown(dot, { pointerId: 1, button: 0, clientX: 40, clientY: 160 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(dot, { pointerId: 1, clientX: 160, clientY: 40 });
    expect(stored()[0]).toMatchObject({ interest: 2, authority: 2 });
    fireEvent.pointerUp(dot, { pointerId: 1, clientX: 160, clientY: 40 });
    expect(stored()[0]).toMatchObject({ interest: 8, authority: 8 });
    expect(updates()).toHaveLength(1);
  });

  it("drags a chip from the tray onto the map", () => {
    seed([stakeholder("jo", { name: "Jo" })]);
    renderPage();
    const grid = map();
    grid.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
      }) as DOMRect;
    const chip = screen.getByRole("button", { name: /^Jo: not placed yet/ });
    fireEvent.pointerDown(chip, { pointerId: 2, button: 0, clientX: -50, clientY: -50 });
    fireEvent.pointerMove(chip, { pointerId: 2, clientX: 90, clientY: 70 });
    fireEvent.pointerUp(chip, { pointerId: 2, clientX: 90, clientY: 70 });
    expect(stored()[0]).toMatchObject({ interest: 9, authority: 3 });
  });

  it("tracks current vs desired sentiment, and contact", () => {
    seed([
      stakeholder("marco", {
        name: "Marco",
        interest: 7,
        authority: 8,
        currentSentiment: "blocker",
        nextTouchAt: day(-2),
      }),
    ]);
    renderPage();
    fireEvent.change(screen.getByLabelText("Desired sentiment for Marco"), {
      target: { value: "supporter" },
    });
    expect(stored()[0].desiredSentiment).toBe("supporter");
    expect(screen.getByText("3 steps short")).toBeInTheDocument();
    expect(card("Touches overdue")).toBe("Touches overdue1");
    fireEvent.click(screen.getByRole("button", { name: "Contacted Marco today" }));
    expect(stored()[0].lastContactAt).toBe(TODAY);
    expect(stored()[0]).not.toHaveProperty("nextTouchAt");
    expect(card("Touches overdue")).toBe("Touches overdue0");
    // Clearing the current sentiment sticks (no fallback to an old value).
    fireEvent.change(screen.getByLabelText("Current sentiment for Marco"), {
      target: { value: "" },
    });
    expect(stored()[0].currentSentiment).toBeNull();
  });

  it("keeps a name when it's emptied in place", () => {
    seed([stakeholder("kim", { name: "Kim" })]);
    renderPage();
    const name = screen.getByRole("textbox", { name: "Name of Kim" });
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);
    expect(stored()[0].name).toBe("Kim");
    expect(name).toHaveValue("Kim");
  });

  it("removes with Undo, and clears all only after a confirm", async () => {
    seed([stakeholder("a", { name: "Ana" }), stakeholder("b", { name: "Ben" })]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Remove Ana" }));
    expect(stored().map((s) => s.id)).toEqual(["b"]);
    undoLast();
    expect(stored().map((s) => s.id)).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove all" }));
    expect(stored()).toEqual([]);
    undoLast();
    expect(stored().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("shows an example in memory only, and exports it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(
      screen.getByText(
        "2 of 4 Manage Closely stakeholders are below where you need them; Priya Shah's next touch was due 3 days ago; 1 not placed yet."
      )
    ).toBeInTheDocument();
    expect(card("Manage Closely")).toBe("Manage Closely4");
    expect(screen.getByTestId("export-markdown").textContent).toContain("## Not placed yet");
    const tray = screen.getByRole("region", { name: "Not placed yet" });
    fireEvent.change(within(tray).getByLabelText("Place Jo Park in"), {
      target: { value: "monitor" },
    });
    expect(localStorage.getItem(STORAGE_KEY) ?? "[]").toBe("[]");
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("selects a dot for the detail panel", () => {
    seed([
      stakeholder("lena", {
        name: "Lena",
        role: "CFO",
        interest: 5,
        authority: 10,
        currentSentiment: "supporter",
        desiredSentiment: "champion",
        lastContactAt: day(-12),
      }),
    ]);
    renderPage();
    expect(screen.getByText(/Tap one to see their details\.$/)).toBeInTheDocument();
    fireEvent.click(within(map()).getByRole("button", { name: /^Lena/ }));
    const detail = screen.getByRole("region", { name: "Selected stakeholder" });
    // Not a live region: the announcer says what moved, not the whole card.
    expect(detail).not.toHaveAttribute("aria-live");
    expect(within(detail).getByText("Supporter → Champion (1 step short)")).toBeInTheDocument();
    expect(
      within(detail).getByText("Last contact 12 days ago · No touch planned")
    ).toBeInTheDocument();
  });

  it("colours with theme tokens, never hex", () => {
    const dir = path.resolve(__dirname, "../../src/app/(tools)/stakeholder-map");
    for (const f of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
