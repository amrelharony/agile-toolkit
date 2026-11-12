import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";

/**
 * Card Decks (Phase 1 tools plan, P1.8): the built-in decks and the team's
 * own on one table; deal a card or a hand (never a card twice a round, never
 * a used or hidden one), go back, shuffle with Undo; star, use and hide
 * cards; decks of the team's own with a validated form and Undo on every
 * removal; an example; the Markdown export; Ask Amr for a card that fits the
 * team's mood and for a deck on a theme (both work without AI, and nothing
 * is added until the person chooses it, with Undo); and dealing to a live
 * room through the show-room kit.
 */

const h = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() }),
  log: vi.fn(),
  cheer: vi.fn(),
  exportProps: { current: null as null | { markdown?: string; jsonData?: unknown } },
  room: {
    live: false,
    status: "live",
    show: vi.fn<(kind: string, payload: unknown) => boolean>(() => true),
    hostProps: null as null | { tool?: string; toolName?: string; description?: unknown },
  },
  auth: null as null | { status: string; user: { id: string } | null },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/card-decks",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/utils/toast", () => ({ toast: h.toast }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => h.auth }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: { markdown?: string; jsonData?: unknown }) => {
    h.exportProps.current = props;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({ useHistoryLogger: () => ({ log: h.log }) }));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: h.cheer }));
vi.mock("@/components/collab/show-room", () => ({
  ShowRoomHost: ({
    children,
    ...props
  }: {
    children?: (room: unknown) => ReactNode;
    tool?: string;
    toolName?: string;
    description?: unknown;
  }) => {
    h.room.hostProps = props;
    return h.room.live ? (
      <div data-testid="room">{children?.({ status: h.room.status, show: h.room.show })}</div>
    ) : (
      <button type="button">Show on everyone&apos;s phones</button>
    );
  },
}));

import { CardDecksClient } from "@/app/(tools)/card-decks/card-decks-client";
import { EXAMPLE_DECK_ID, buildExample } from "@/app/(tools)/card-decks/example";
import { toMarkdown } from "@/app/(tools)/card-decks/markdown";
import { moodLine, teamMood } from "@/app/(tools)/card-decks/mood";
import { validateThemeDraft } from "@/app/(tools)/card-decks/components/ask-amr";
import { builtInDeck } from "@/lib/card-decks/decks";
import { CARD_DECKS_INITIAL, findDeck, marksOf, type CustomDeck } from "@/lib/card-decks/model";
import { readCardDecks, useCardDecks } from "@/lib/card-decks/store";
import { CARD_DECKS_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { addDays } from "@/lib/impediments/model";
import { todayLocalISO } from "@/lib/utils/formatters";

const retro = builtInDeck("retro")!;
const OWN: CustomDeck = {
  id: "deck_own",
  name: "Offsite",
  cards: [
    { id: "c1", text: "First question?" },
    { id: "c2", text: "Second question?" },
  ],
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function mount() {
  const view = render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <CardDecksClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
  await flush();
  return view;
}

const click = (el: HTMLElement) => fireEvent.click(el);
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const tableStatus = () =>
  within(screen.getByRole("region", { name: "On the table" }) as HTMLElement)
    .getAllByRole("status")
    .map((s) => s.textContent)
    .join(" ");
const dealt = () =>
  within(screen.getByRole("list", { name: /^The (card|\d+ cards) dealt$/ }))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p.font-display")?.textContent);
const undoOf = (label: string) => {
  const call = [...h.toast.mock.calls].reverse().find((c) => c[0] === label);
  expect(call, `toast "${label}"`).toBeTruthy();
  return () => act(() => (call![1] as { action: { onClick: () => void } }).action.onClick());
};
const logged = (action: string) => h.log.mock.calls.filter((c) => c[0] === action);
/** A card's remove button in the card list ("Remove: <its text>"). */
const REMOVE_CARD = /^Remove: /;
/** The deck form's cards box (its label reads "Cards*": the star marks it required). */
const cardsField = () => screen.getByRole("textbox", { name: /^Cards\*?$/ });

beforeEach(() => {
  window.localStorage.clear();
  useCardDecks.setState({ ...CARD_DECKS_INITIAL });
  useWorkspaceStore.setState({ moodEntries: [], moodPulses: [] });
  h.toast.mockClear();
  h.log.mockClear();
  h.cheer.mockClear();
  h.room.live = false;
  h.room.status = "live";
  h.room.hostProps = null;
  h.room.show.mockClear();
  h.room.show.mockImplementation(() => true);
  h.auth = null;
  h.exportProps.current = null;
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the table", () => {
  it("opens on the retro prompts with every deck to pick from and nothing dealt", async () => {
    await mount();
    const decks = within(screen.getByRole("radiogroup", { name: "Deck" })).getAllByRole("radio");
    expect(decks.map((r) => r.textContent)).toEqual([
      "Retro prompts",
      "Coaching questions",
      "Tell us about…",
      "Story splitting",
      "Yay! questions",
      "Check-in",
      "Check-out",
    ]);
    expect(screen.getByRole("radio", { name: "Retro prompts" }).getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(screen.getByText(/Nothing dealt yet/)).toBeTruthy();
  });

  it("deals a card large, says how many are left, saves the round and logs it", async () => {
    await mount();
    click(button("Deal a card"));
    expect(dealt()).toEqual([retro.cards[0].text]);
    expect(tableStatus()).toContain(
      `Dealt a card from Retro prompts. ${retro.cards.length - 1} left.`
    );
    expect(readCardDecks().rounds.retro).toEqual([[retro.cards[0].id]]);
    expect(logged(CARD_DECKS_ACTIONS.CARD_DEALT)[0][1]).toMatchObject({
      deckId: "retro",
      count: 1,
      forRoom: false,
    });
  });

  it("never deals a card twice in a round, and Back one deal puts the last one back", async () => {
    await mount();
    click(button("Deal a card"));
    click(button("Deal a card"));
    expect(dealt()).toEqual([retro.cards[1].text]);
    click(button("Back one deal"));
    expect(dealt()).toEqual([retro.cards[0].text]);
    expect(tableStatus()).toContain("The card is back in the deck.");
  });

  it("deals a hand of several cards", async () => {
    await mount();
    click(screen.getByRole("radio", { name: "3 cards" }));
    click(button("Deal 3 cards"));
    expect(dealt()).toEqual(retro.cards.slice(0, 3).map((c) => c.text));
  });

  it("shuffles with Undo: every dealt card goes back", async () => {
    await mount();
    click(button("Deal a card"));
    click(button("Deal a card"));
    click(button("Shuffle"));
    expect(readCardDecks().rounds.retro).toBeUndefined();
    expect(logged(CARD_DECKS_ACTIONS.DECK_SHUFFLED)[0][1]).toEqual({ deckId: "retro", dealt: 2 });
    await undoOf("Shuffled Retro prompts: 2 cards back in the deck")();
    expect(readCardDecks().rounds.retro).toHaveLength(2);
  });

  it("says a fresh deck is already shuffled, without an Undo", async () => {
    await mount();
    click(button("Shuffle"));
    expect(tableStatus()).toContain("The deck is shuffled");
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("ends the round when every card is dealt, cheers once, and keeps focus on Deal", async () => {
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own" });
    await mount();
    const deal = button("Deal a card") as HTMLButtonElement;
    deal.focus();
    click(deal);
    click(deal);
    expect(tableStatus()).toContain("That was the last one this round.");
    expect(h.cheer).toHaveBeenCalledTimes(1);
    expect(h.cheer).toHaveBeenCalledWith("card-decks", "done");
    // aria-disabled, never disabled: the focused button keeps focus.
    expect(deal.disabled).toBe(false);
    expect(deal.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(deal);
    click(deal);
    expect(tableStatus()).toContain("No cards left to deal this round. Shuffle to start again.");
    expect(readCardDecks().rounds.deck_own).toHaveLength(2);
    // The last card stays on the table until the next deal or shuffle.
    expect(dealt()).toEqual(["Second question?"]);
    const back = button("Back one deal") as HTMLButtonElement;
    back.focus();
    click(back);
    click(back);
    expect(screen.getByText(/Nothing dealt yet/)).toBeTruthy();
    expect(back.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(back);
    click(back);
    expect(tableStatus()).toContain("Nothing to put back");
  });

  it("says when every card is used or hidden, with no shuffle that wouldn't help", async () => {
    useCardDecks.setState({
      decks: [OWN],
      deckId: "deck_own",
      used: ["deck_own/c1", "deck_own/c2"],
    });
    await mount();
    expect(screen.getByText(/Every card in this deck is used or hidden/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Shuffle the deck" })).toBeNull();
    click(button("Deal a card"));
    expect(tableStatus()).toContain("Bring some back in the card list below.");
  });

  it("switches decks: story splitting shows the pattern and its how", async () => {
    await mount();
    click(screen.getByRole("radio", { name: "Story splitting" }));
    click(button("Deal a card"));
    const table = screen.getByRole("list", { name: "The card dealt" });
    expect(table.textContent).toContain("Spike");
    expect(table.textContent).toContain("timeboxed piece of research");
    expect(readCardDecks().deckId).toBe("splitting");
  });

  it("deals the Ice Breaker's own check-in activities", async () => {
    await mount();
    click(screen.getByRole("radio", { name: "Check-in" }));
    click(button("Deal a card"));
    expect(dealt()).toEqual([findDeck([], "check-in")!.cards[0].text]);
  });
});

describe("marks", () => {
  it("stars a dealt card, logs it, and can deal from the starred cards only", async () => {
    await mount();
    click(button("Deal a card"));
    const star = within(screen.getByRole("list", { name: "The card dealt" })).getByRole("button", {
      name: "Star",
    });
    click(star);
    expect(readCardDecks().starred).toEqual([`retro/${retro.cards[0].id}`]);
    expect(logged(CARD_DECKS_ACTIONS.CARD_STARRED)[0][1]).toMatchObject({ starred: true });
    click(button("Shuffle"));
    click(screen.getByRole("switch", { name: "Deal from starred cards only" }));
    click(button("Deal a card"));
    expect(dealt()).toEqual([retro.cards[0].text]);
    expect(tableStatus()).toContain("That was the last one this round.");
  });

  it("skips a used card in later rounds, and brings used cards back with Undo", async () => {
    await mount();
    click(button("Deal a card"));
    click(
      within(screen.getByRole("list", { name: "The card dealt" })).getByRole("button", {
        name: "Mark used",
      })
    );
    click(button("Shuffle"));
    click(button("Deal a card"));
    expect(dealt()).toEqual([retro.cards[1].text]);
    click(button("Bring back the used card"));
    expect(readCardDecks().used).toEqual([]);
    await undoOf("Brought back 1 used card in Retro prompts")();
    expect(readCardDecks().used).toEqual([`retro/${retro.cards[0].id}`]);
  });

  it("keeps the round's counts adding up when a dealt card is marked used", async () => {
    await mount();
    const n = retro.cards.length;
    const counts = () =>
      screen.getByText(/dealt this round/, { selector: "section[aria-labelledby] p" }).textContent;
    click(button("Deal a card"));
    expect(counts()).toBe(`1 of ${n} cards dealt this round · ${n - 1} left`);
    click(
      within(screen.getByRole("list", { name: "The card dealt" })).getByRole("button", {
        name: "Mark used",
      })
    );
    expect(counts()).toBe(`0 of ${n - 1} cards dealt this round · ${n - 1} left · 1 set aside`);
  });

  it("counts the starred cards under starred-only", async () => {
    useCardDecks.setState({
      decks: [OWN],
      deckId: "deck_own",
      starred: ["deck_own/c2"],
      starredOnly: true,
    });
    await mount();
    click(button("Deal a card"));
    expect(
      screen.getByText(/dealt this round/, { selector: "section[aria-labelledby] p" }).textContent
    ).toBe("1 of 1 starred card dealt this round · 0 left");
  });

  it("hides a card from the card list so it is never dealt, and shows it again", async () => {
    await mount();
    const list = screen.getByRole("region", { name: "Cards in Retro prompts" });
    const hide = within(list).getAllByRole("button", { name: /^Hide: / })[0];
    expect(hide.getAttribute("aria-label")).toBe(`Hide: ${retro.cards[0].text}`);
    expect(hide.getAttribute("aria-pressed")).toBe("false");
    click(hide);
    click(button("Deal a card"));
    expect(dealt()).toEqual([retro.cards[1].text]);
    click(screen.getByRole("radio", { name: "Hidden (1)" }));
    // One name whatever the state: aria-pressed says the card is hidden.
    const again = within(list).getByRole("button", { name: `Hide: ${retro.cards[0].text}` });
    expect(again.getAttribute("aria-pressed")).toBe("true");
    again.focus();
    click(again);
    expect(readCardDecks().hidden).toEqual([]);
    // The row left the Hidden list: focus goes to the list's heading, not the page.
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Cards in Retro prompts" })
    );
    expect(within(list).getByText("No hidden cards in this deck.")).toBeTruthy();
  });

  it("moves focus to the next row's control when a filtered row leaves the list", async () => {
    useCardDecks.setState({
      starred: [`retro/${retro.cards[0].id}`, `retro/${retro.cards[1].id}`],
    });
    await mount();
    const list = screen.getByRole("region", { name: "Cards in Retro prompts" });
    click(screen.getByRole("radio", { name: "Starred (2)" }));
    const first = within(list).getByRole("button", { name: `Star: ${retro.cards[0].text}` });
    expect(first.getAttribute("aria-pressed")).toBe("true");
    first.focus();
    click(first);
    expect(document.activeElement).toBe(
      within(list).getByRole("button", { name: `Star: ${retro.cards[1].text}` })
    );
  });

  it("names each card's buttons after the card, and a toggle on the table keeps its name", async () => {
    await mount();
    const list = screen.getByRole("region", { name: "Cards in Retro prompts" });
    const names = within(list)
      .getAllByRole("button", { name: /^Star: / })
      .map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(retro.cards.length);
    click(button("Deal a card"));
    const table = screen.getByRole("list", { name: "The card dealt" });
    const star = within(table).getByRole("button", { name: "Star" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    click(star);
    expect(within(table).getByRole("button", { name: "Star" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    click(within(table).getByRole("button", { name: "Mark used" }));
    expect(
      within(table).getByRole("button", { name: "Mark used" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(table.textContent).toContain("Used: skipped in later rounds.");
  });
});

describe("the team's own decks", () => {
  it("shows an empty state with an example to load, and clears exactly the example", async () => {
    await mount();
    click(button("Load an example"));
    expect(screen.getByText(/Example data\./)).toBeTruthy();
    expect(readCardDecks().deckId).toBe(EXAMPLE_DECK_ID);
    expect(dealt()).toEqual([buildExample().deck.cards[0].text]);
    click(button("Clear example"));
    expect(readCardDecks().decks).toEqual([]);
    expect(readCardDecks().deckId).toBe("retro");
    expect(screen.getByText(/No decks of your own yet/)).toBeTruthy();
  });

  it("checks the new-deck form before saving, then puts the deck on the table", async () => {
    await mount();
    click(button("New deck"));
    click(button("Create the deck"));
    expect(screen.getByText("Give the deck a name.")).toBeTruthy();
    expect(screen.getByText("Write at least one card, one per line.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Deck name/), { target: { value: "Retro prompts" } });
    fireEvent.change(cardsField(), { target: { value: "- One?\n\n2. Two?" } });
    click(button("Create the deck"));
    expect(screen.getByText("A deck has that name already. Pick another.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Deck name/), { target: { value: "Kickoff" } });
    click(button("Create the deck"));
    const state = readCardDecks();
    expect(state.decks).toHaveLength(1);
    expect(state.decks[0]).toMatchObject({ name: "Kickoff" });
    expect(state.decks[0].cards.map((c) => c.text)).toEqual(["One?", "Two?"]);
    expect(state.deckId).toBe(state.decks[0].id);
    expect(logged(CARD_DECKS_ACTIONS.DECK_SAVED)[0][1]).toMatchObject({ cards: 2, how: "new" });
  });

  it("edits a deck, keeping a kept card's id, with Undo when cards were taken out", async () => {
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own", starred: ["deck_own/c2"] });
    await mount();
    click(button("Edit Offsite"));
    fireEvent.change(cardsField(), {
      target: { value: "Second question?\nThird?" },
    });
    click(button("Save the deck"));
    const cards = readCardDecks().decks[0].cards;
    expect(cards[0]).toEqual({ id: "c2", text: "Second question?" });
    expect(cards[1].text).toBe("Third?");
    await undoOf("Saved Offsite: 1 card taken out")();
    expect(readCardDecks().decks[0].cards).toEqual(OWN.cards);
  });

  it("deletes a deck with Undo, which puts back its round and its place on the table", async () => {
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own", rounds: { deck_own: [["c1"]] } });
    await mount();
    click(button("Delete Offsite"));
    expect(readCardDecks().decks).toEqual([]);
    expect(readCardDecks().deckId).toBe("retro");
    expect(readCardDecks().rounds.deck_own).toBeUndefined();
    expect(logged(CARD_DECKS_ACTIONS.DECK_REMOVED)).toHaveLength(1);
    await undoOf("Deleted Offsite")();
    const state = readCardDecks();
    expect(state.decks.map((d) => d.id)).toEqual(["deck_own"]);
    expect(state.deckId).toBe("deck_own");
    expect(state.rounds.deck_own).toEqual([["c1"]]);
    expect(dealt()).toEqual(["First question?"]);
  });

  it("puts a removed card back as dealt this round when Undo comes before another deal", async () => {
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own", rounds: { deck_own: [["c1"]] } });
    await mount();
    const list = screen.getByRole("region", { name: "Cards in Offsite" });
    click(within(list).getAllByRole("button", { name: REMOVE_CARD })[0]);
    expect(readCardDecks().rounds.deck_own).toBeUndefined();
    await undoOf("Removed a card from Offsite")();
    expect(readCardDecks().decks[0].cards).toEqual(OWN.cards);
    expect(readCardDecks().rounds.deck_own).toEqual([["c1"]]);
  });

  it("adds a card to the deck on the table (no repeats) and removes one with Undo", async () => {
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own" });
    await mount();
    const field = screen.getByLabelText(/New card for Offsite/);
    fireEvent.change(field, { target: { value: "first question?" } });
    click(button("Add the card"));
    expect(screen.getByText("That card is in the deck already.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "Third question?" } });
    click(button("Add the card"));
    expect(readCardDecks().decks[0].cards.map((c) => c.text)).toEqual([
      "First question?",
      "Second question?",
      "Third question?",
    ]);
    const list = screen.getByRole("region", { name: "Cards in Offsite" });
    const remove = within(list).getAllByRole("button", { name: REMOVE_CARD })[0];
    expect(remove.getAttribute("aria-label")).toBe("Remove: First question?");
    remove.focus();
    click(remove);
    expect(readCardDecks().decks[0].cards).toHaveLength(2);
    // Focus goes to the next card's Remove, not the page.
    expect(document.activeElement).toBe(
      within(list).getByRole("button", { name: "Remove: Second question?" })
    );
    await undoOf("Removed a card from Offsite")();
    expect(readCardDecks().decks[0].cards[0].text).toBe("First question?");
  });

  it("says a deck of the team's own has no cards once the last one is removed", async () => {
    useCardDecks.setState({ decks: [{ ...OWN, cards: [OWN.cards[0]] }], deckId: "deck_own" });
    await mount();
    const list = screen.getByRole("region", { name: "Cards in Offsite" });
    const remove = within(list).getByRole("button", { name: REMOVE_CARD });
    remove.focus();
    click(remove);
    expect(
      screen.getByText("This deck has no cards yet. Add one in the card list below.")
    ).toBeTruthy();
    expect(within(list).getByText("This deck has no cards yet. Add one below.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Shuffle the deck" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Cards in Offsite" }));
    click(button("Deal a card"));
    expect(tableStatus()).toContain("This deck has no cards yet.");
  });

  it("built-in decks have no remove or add controls", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: REMOVE_CARD })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add the card" })).toBeNull();
  });

  it("keeps focus on the page through the deck form, Put on the table and Delete", async () => {
    const second: CustomDeck = { ...OWN, id: "deck_two", name: "Kickoff" };
    useCardDecks.setState({ decks: [OWN, second] });
    await mount();
    // New deck: focus goes into the form, and back to New deck when it closes.
    click(button("New deck"));
    expect(document.activeElement).toBe(screen.getByLabelText(/Deck name/));
    click(button("Cancel"));
    expect(document.activeElement).toBe(button("New deck"));
    // Edit: into the form, and back to that deck's Edit on Save.
    click(button("Edit Kickoff"));
    expect(document.activeElement).toBe(screen.getByLabelText(/Deck name/));
    click(button("Save the deck"));
    expect(document.activeElement).toBe(button("Edit Kickoff"));
    // Put on the table: the button goes, so focus goes to the table.
    click(button("Put Offsite on the table"));
    expect(readCardDecks().deckId).toBe("deck_own");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "On the table" }));
    // Delete: the next deck's Delete, then New deck when none is left.
    click(button("Delete Offsite"));
    expect(document.activeElement).toBe(button("Delete Kickoff"));
    click(button("Delete Kickoff"));
    expect(document.activeElement).toBe(button("New deck"));
  });
});

describe("export", () => {
  it("passes the deck as Markdown, with the cards on the table and their marks", async () => {
    await mount();
    click(button("Deal a card"));
    const md = h.exportProps.current?.markdown ?? "";
    expect(md).toContain("# Card Decks: Retro prompts");
    expect(md).toContain("## On the table");
    expect(md).toContain(`- ${retro.cards[0].text}`);
    expect(md).toContain(`1 dealt this round · ${retro.cards.length - 1} left to deal`);
  });

  it("escapes markup and lists starred and used cards", () => {
    const deck = findDeck(
      [{ ...OWN, cards: [{ id: "c1", text: "Use *bold* | pipes?" }] }],
      "deck_own"
    )!;
    const md = toMarkdown(
      {
        deck,
        marks: marksOf({ used: ["deck_own/c1"], starred: ["deck_own/c1"], hidden: [] }),
        round: [],
      },
      new Date(2026, 10, 12)
    );
    expect(md).toContain("Use \\*bold\\* \\| pipes?");
    expect(md).toContain("## Starred");
    expect(md).toContain("(used, starred)");
    expect(md).toContain("12 Nov 2026");
  });
});

describe("Ask Amr: a card for the mood", () => {
  it("reads the team's average mood only, and says when there isn't enough", () => {
    const today = todayLocalISO();
    expect(moodLine(teamMood([], [], today))).toContain("Not enough Mood Tracker check-ins");
    const pulses = [0, 1, 2].map((d) => ({
      id: `moodPulse_${d}`,
      date: addDays(today, -d),
      counts: { 1: 2, 2: 2, 3: 0, 4: 0, 5: 0 },
      source: "facilitator" as const,
      createdAt: `${today}T09:00:00.000Z`,
    }));
    const mood = teamMood([], pulses, today);
    expect(mood).toMatchObject({ average: 1.5, checkIns: 12, lowDays: 3 });
    expect(moodLine(mood)).toContain("1.5 of 5");
  });

  it("picks a light card without AI when there is no mood, and deals it only on Deal, with Undo", async () => {
    await mount();
    click(button("Pick a card for the mood"));
    const panel = screen.getByTestId("ai-suggestions");
    expect(panel.textContent).toContain("Suggested without AI");
    expect(panel.textContent).toContain("aren't enough mood check-ins");
    expect(readCardDecks().rounds.retro).toBeUndefined();
    click(within(panel).getByRole("button", { name: /^Deal: / }));
    expect(readCardDecks().rounds.retro).toHaveLength(1);
    // The suggestion stays, saying it is done, with focus on its heading.
    const after = screen.getByTestId("ai-suggestions");
    expect(after.textContent).toContain("All added.");
    expect(document.activeElement).toBe(
      within(after).getByRole("heading", { name: "A card for the team's mood" })
    );
    await undoOf("Dealt the card Amr picked")();
    expect(readCardDecks().rounds.retro).toBeUndefined();
  });

  it("picks a gentle card for a low mood", async () => {
    const today = todayLocalISO();
    useWorkspaceStore.setState({
      moodPulses: [0, 1, 2].map((d) => ({
        id: `moodPulse_${d}`,
        date: addDays(today, -d),
        counts: { 1: 2, 2: 2, 3: 0, 4: 0, 5: 0 },
        source: "facilitator" as const,
        createdAt: `${today}T09:00:00.000Z`,
      })),
    });
    await mount();
    click(button("Pick a card for the mood"));
    const panel = screen.getByTestId("ai-suggestions");
    expect(panel.textContent).toContain("What helped us most this sprint?");
    expect(panel.textContent).toContain("low lately");
  });

  it("asks the owner route, and replaces a card id the deck doesn't hold", async () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { cardId: "made-up", reason: "Because." },
            source: "ai",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    await act(async () => {
      click(button("Ask Amr for a card"));
    });
    await flush();
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.task).toBe("card-decks.for_mood");
    expect(body.input.mood).toEqual({ average: null, checkIns: 0, trend: "unknown", lowDays: 0 });
    expect(body.input.cards).toHaveLength(retro.cards.length);
    const panel = screen.getByTestId("ai-suggestions");
    expect(panel.textContent).toContain("Suggested without AI");
    expect(panel.textContent).not.toContain("Because.");
  });
});

describe("Ask Amr: a deck on a theme", () => {
  it("checks the theme and the count", () => {
    expect(validateThemeDraft({ theme: " ", count: "5" }).ok).toBe(false);
    expect(validateThemeDraft({ theme: "Trust", count: "31" }).ok).toBe(false);
    expect(validateThemeDraft({ theme: "Trust", count: "2.5" }).ok).toBe(false);
    expect(validateThemeDraft({ theme: " Trust ", count: "5" })).toEqual({
      ok: true,
      values: { theme: "Trust", count: 5 },
    });
  });

  it("says what is missing before it asks", async () => {
    await mount();
    click(button("Suggest cards from the built-in decks"));
    expect(screen.getAllByText(/Write a theme, such as/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("ai-suggestions")).toBeNull();
  });

  it("suggests cards without AI, and Add all makes a new deck on the table, with Undo", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Theme"), {
      target: { value: "thanks and appreciation" },
    });
    fireEvent.change(screen.getByLabelText("How many cards"), { target: { value: "3" } });
    click(button("Suggest cards from the built-in decks"));
    const panel = screen.getByTestId("ai-suggestions");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
    expect(readCardDecks().decks).toEqual([]);
    click(within(panel).getByRole("button", { name: "Add all 3" }));
    const state = readCardDecks();
    expect(state.decks).toHaveLength(1);
    expect(state.decks[0]).toMatchObject({
      name: "Thanks and appreciation",
      theme: "thanks and appreciation",
    });
    expect(state.decks[0].cards).toHaveLength(3);
    expect(state.deckId).toBe(state.decks[0].id);
    await undoOf("Made Thanks and appreciation with 3 cards")();
    expect(readCardDecks().decks).toEqual([]);
  });

  it("adds one card at a time into the same new deck", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "retro" } });
    fireEvent.change(screen.getByLabelText("How many cards"), { target: { value: "2" } });
    click(button("Suggest cards from the built-in decks"));
    const panel = screen.getByTestId("ai-suggestions");
    const [first] = within(panel).getAllByRole("button", { name: /^Add: / });
    click(first);
    click(within(panel).getAllByRole("button", { name: /^Add: / })[0]);
    const state = readCardDecks();
    expect(state.decks).toHaveLength(1);
    expect(state.decks[0].cards).toHaveLength(2);
  });

  it("can put the cards into the team's deck on the table, skipping repeats", async () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              data: { name: "More", cards: ["first question?", "A brand new one?"] },
              source: "ai",
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
    );
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own" });
    await mount();
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "More of these" } });
    click(screen.getByRole("radio", { name: "Into Offsite" }));
    await act(async () => {
      click(button("Ask Amr for cards"));
    });
    await flush();
    const panel = screen.getByTestId("ai-suggestions");
    expect(panel.textContent).toContain("Suggested by Amr's AI");
    click(within(panel).getByRole("button", { name: "Add all 2" }));
    expect(readCardDecks().decks).toHaveLength(1);
    expect(readCardDecks().decks[0].cards.map((c) => c.text)).toEqual([
      "First question?",
      "Second question?",
      "A brand new one?",
    ]);
  });
});

describe("Ask Amr: when the cards can't go in", () => {
  const answer = (cards: string[]) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, data: { name: "More", cards }, source: "ai" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
      )
    );
  const ask = async () => {
    fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "More of these" } });
    await act(async () => {
      click(button("Ask Amr for cards"));
    });
    await flush();
    return screen.getByTestId("ai-suggestions");
  };

  it("says so when the deck on the table holds the cards already", async () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    answer(["first question?"]);
    useCardDecks.setState({ decks: [OWN], deckId: "deck_own" });
    await mount();
    click(screen.getByRole("radio", { name: "Into Offsite" }));
    const panel = await ask();
    click(within(panel).getByRole("button", { name: /^Add: / }));
    expect(readCardDecks().decks[0].cards).toEqual(OWN.cards);
    expect(screen.getByText("Nothing added. Offsite has that card already.")).toBeTruthy();
  });

  it("says so when the deck on the table is full", async () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    answer(["A brand new one?"]);
    const cards = Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, text: `Card ${i}?` }));
    useCardDecks.setState({ decks: [{ ...OWN, cards }], deckId: "deck_own" });
    await mount();
    click(screen.getByRole("radio", { name: "Into Offsite" }));
    const panel = await ask();
    click(within(panel).getByRole("button", { name: /^Add: / }));
    expect(readCardDecks().decks[0].cards).toHaveLength(80);
    expect(screen.getByText("Nothing added. Offsite is full: a deck holds 80 cards.")).toBeTruthy();
  });

  it("makes no 41st deck: a late accept is refused, and the next ask says why", async () => {
    h.auth = { status: "authenticated", user: { id: "owner" } };
    answer(["A brand new one?"]);
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...OWN, id: `deck_${i}`, name: `Deck ${i}` }));
    useCardDecks.setState({ decks: many(39) });
    await mount();
    const panel = await ask();
    // A 40th deck arrives (Amr, another tab) before the person adds the cards.
    act(() => useCardDecks.setState({ decks: many(40) }));
    click(within(panel).getByRole("button", { name: /^Add: / }));
    expect(readCardDecks().decks).toHaveLength(40);
    expect(readCardDecks().decks.some((d) => d.name === "More")).toBe(false);
    expect(screen.getAllByText(/You have 40 decks of your own/).length).toBeGreaterThan(0);
    expect(h.toast.mock.calls.some((c) => String(c[0]).startsWith("Made "))).toBe(false);
  });
});

describe("dealing for the room", () => {
  it("hands the show room Card Decks and says what is sent, before a room is open", async () => {
    await mount();
    expect(h.room.hostProps).toMatchObject({ tool: "card-decks", toolName: "Card Decks" });
    expect(String(h.room.hostProps?.description)).toContain("with the deck's name");
    expect(screen.queryByRole("button", { name: /for the room$/ })).toBeNull();
  });

  it("keeps the room's buttons off until the room is live", async () => {
    h.room.live = true;
    h.room.status = "connecting";
    await mount();
    const room = screen.getByTestId("room");
    const off = (name: string) =>
      (within(room).getByRole("button", { name }) as HTMLButtonElement).disabled;
    expect(off("Deal a card for the room")).toBe(true);
    expect(off("Show the table to the room")).toBe(true);
  });

  it("sends the dealt card as a cards frame, and the table again on request", async () => {
    h.room.live = true;
    await mount();
    const room = screen.getByTestId("room");
    click(within(room).getByRole("button", { name: "Deal a card for the room" }));
    expect(h.room.show).toHaveBeenCalledWith("cards", {
      deck: "Retro prompts",
      cards: [{ text: retro.cards[0].text }],
    });
    expect(room.textContent).toContain("Everyone in the room sees it now.");
    expect(logged(CARD_DECKS_ACTIONS.CARD_DEALT)[0][1]).toMatchObject({ forRoom: true });
    click(within(room).getByRole("button", { name: "Show the table to the room" }));
    expect(h.room.show).toHaveBeenCalledTimes(2);
  });

  it("deals nothing when the room can't take the frame, and says so", async () => {
    h.room.live = true;
    h.room.show.mockImplementation(() => false);
    await mount();
    const room = screen.getByTestId("room");
    click(within(room).getByRole("button", { name: "Deal a card for the room" }));
    expect(h.room.show).toHaveBeenCalledTimes(1);
    expect(room.textContent).toContain(
      "Couldn't show that to the room, so nothing was dealt. Try again in a moment."
    );
    expect(readCardDecks().rounds.retro).toBeUndefined();
    expect(logged(CARD_DECKS_ACTIONS.CARD_DEALT)).toHaveLength(0);
    expect(screen.getByText(/Nothing dealt yet/)).toBeTruthy();
  });
});
