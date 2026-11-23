import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";

/**
 * The estimator's page, /planning-poker/estimate#estimate=…: a round's
 * stories from the link, a card each, up to five notes, and a reply code.
 * It never loads the Poker page and writes nothing: not the workspace, not
 * the stored session, not history, not this browser's storage. Copying
 * confirms on the button, with no toast.
 */

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), message: vi.fn() },
  writeText: vi.fn<(text: string) => Promise<void>>(async () => {}),
}));

vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import {
  EstimateView,
  estimatorNotice,
  replyLink,
} from "@/app/(tools)/planning-poker/async/estimate-view";
import { encodePack, packFor, readReply } from "@/lib/estimation/async-pack";
import { LOCAL_SESSION_KEY } from "@/app/(tools)/planning-poker/local-session";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useHistoryStore } from "@/lib/history/history-store";
import { ASYNC_ESTIMATE_NOTICE } from "@/lib/site/disclosures";
import type { PokerAsyncRound } from "@/lib/stores/workspace-types";

const ROUND: PokerAsyncRound = {
  id: "async_round000001",
  title: "Checkout stories",
  scaleType: "fibonacci",
  deck: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
  stories: [
    { id: "s1", title: "Pay by phone" },
    { id: "s2", title: "Refund a payment" },
  ],
  dueDate: "2026-11-28",
  withMeanings: true,
  replies: [],
  status: "open",
  createdAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-20T10:00:00.000Z",
};

function openLink(round = ROUND, host = "Priya") {
  const meanings = round.deck.map((c) => (c === "5" ? "About a week" : ""));
  const packed = encodePack(packFor(round, { host, meanings }));
  if (!packed.ok) throw new Error(packed.problem);
  window.history.replaceState(null, "", `/planning-poker/estimate#estimate=${packed.code}`);
}

const storyItem = (title: string) =>
  screen.getAllByRole("listitem").find((li) => li.textContent?.includes(title)) as HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
  for (const fn of Object.values(h.toast)) fn.mockReset();
  h.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: h.writeText },
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("the estimator's page", () => {
  it("shows the facilitator's notice, word for word, with their name in it", () => {
    openLink();
    render(<EstimateView />);
    const note = screen.getByRole("note");
    expect(note.textContent).toBe(estimatorNotice("Priya"));
    expect(note.textContent).toBe(
      "Made in Planning Poker by Priya. Nothing you pick leaves this page until you copy your reply. If you send it, Priya's toolkit keeps your name, cards and notes until the round closes, at most 14 days after it's due."
    );
    expect(estimatorNotice(undefined)).toBe(
      ASYNC_ESTIMATE_NOTICE.split("{name}").join("the facilitator")
    );
  });

  it("lists the stories with a deck each, and the card's meaning once picked", () => {
    openLink();
    render(<EstimateView />);
    expect(screen.getByRole("heading", { name: "Checkout stories" })).toBeTruthy();
    const pay = storyItem("Pay by phone");
    const deck = within(pay).getByRole("radiogroup", { name: "Card for “Pay by phone”" });
    expect(
      within(deck)
        .getAllByRole("radio")
        .map((r) => r.textContent)
    ).toEqual(ROUND.deck);
    fireEvent.click(within(deck).getByRole("radio", { name: "5" }));
    expect(pay.textContent).toContain("About a week");
    // A card with no meaning in the guide shows none.
    fireEvent.click(within(deck).getByRole("radio", { name: "8" }));
    expect(pay.textContent).not.toContain("About a week");
  });

  it("says what's missing instead of making an empty reply", () => {
    openLink();
    render(<EstimateView />);
    fireEvent.click(screen.getByRole("button", { name: "Make my reply" }));
    expect(screen.getByText(/Enter your name/)).toBeTruthy();
    expect(screen.getByText("Pick a card for at least one story.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Your reply" })).toBeNull();
  });

  it("makes a reply code the host can read, and confirms the copy in place", async () => {
    openLink();
    render(<EstimateView />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Lee" } });
    const pay = storyItem("Pay by phone");
    fireEvent.click(within(pay).getByRole("radio", { name: "5" }));
    fireEvent.click(within(pay).getByRole("button", { name: "Add a note" }));
    fireEvent.change(within(pay).getByRole("textbox", { name: "Note on “Pay by phone”" }), {
      target: { value: "Needs the bank's API" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Make my reply" }));

    const result = screen.getByRole("region", { name: "Your reply" });
    expect(result.textContent).toContain("Send it to Priya only");
    const code = within(result).getByText(/^AT1\./).textContent as string;
    expect(readReply(code)).toEqual({
      roundId: ROUND.id,
      name: "Lee",
      cards: "3-",
      notes: [{ story: 0, text: "Needs the bank's API" }],
    });

    const copy = within(result).getByRole("button", { name: "Copy reply" });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(h.writeText).toHaveBeenCalledWith(code);
    expect(within(result).getByRole("button", { name: "Copied" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(result).getByRole("button", { name: "Copy link" }));
    });
    expect(h.writeText).toHaveBeenLastCalledWith(replyLink(code, window.location.origin));
    // Only the inline echo the copy button always sends; no toast of its own.
    for (const call of h.toast.success.mock.calls) expect(call[1]).toEqual({ kind: "echo" });
    expect(h.toast.info).not.toHaveBeenCalled();
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("takes at most five notes", () => {
    const stories = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, title: `Story ${i}` }));
    openLink({ ...ROUND, stories });
    render(<EstimateView />);
    for (let i = 0; i < 5; i++) {
      fireEvent.click(within(storyItem(`Story ${i}`)).getByRole("button", { name: "Add a note" }));
    }
    const sixth = within(storyItem("Story 5")).getByRole("button", { name: "Add a note" });
    expect((sixth as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/5 notes is the most/)).toBeTruthy();
  });

  it("writes nothing: not the workspace, the stored session, history or storage", async () => {
    const workspace = JSON.stringify(useWorkspaceStore.getState());
    const events = useHistoryStore.getState().events.length;
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    openLink();
    render(<EstimateView />);
    fireEvent.change(screen.getByLabelText(/Your name/), { target: { value: "Lee" } });
    fireEvent.click(within(storyItem("Refund a payment")).getByRole("radio", { name: "8" }));
    fireEvent.click(screen.getByRole("button", { name: "Make my reply" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
    });
    expect(JSON.stringify(useWorkspaceStore.getState())).toBe(workspace);
    expect(useHistoryStore.getState().events).toHaveLength(events);
    expect(window.localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("never imports the Poker page, the stores, the history logger or gamification", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/(tools)/planning-poker/async/estimate-view.tsx"),
      "utf8"
    );
    const imports = Array.from(src.matchAll(/^import[^;]*?from\s+"([^"]+)"/gm), (m) => m[1]);
    expect(imports.length).toBeGreaterThan(5);
    for (const banned of [
      "planning-poker-client",
      "workspace-store",
      "use-history-logger",
      "gamification",
      "local-session",
    ]) {
      expect(
        imports.filter((i) => i.includes(banned)),
        banned
      ).toEqual([]);
    }
    expect(src).not.toMatch(/\blocalStorage\s*\./);
  });

  it("says so when the link is broken or cut short", () => {
    window.history.replaceState(null, "", "/planning-poker/estimate#estimate=abc");
    render(<EstimateView />);
    expect(screen.getByText(/doesn't hold a complete round/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Make my reply" })).toBeNull();
  });
});
