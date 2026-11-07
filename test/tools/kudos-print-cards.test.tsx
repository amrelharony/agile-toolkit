/**
 * The Kudos page's printed cards: the picker's themes (the four habits and
 * Open) and each theme's cards (its book episodes' cards, or Thank you! and
 * Great teamwork! with the episode they remind of), ?ep=NN opening on that
 * episode's card, To / Thank you for / From, the privacy rule, and a
 * visitor's kudos sent as a link and an image that keep nothing unless they
 * keep a copy, opened again from its link.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import type { Kudos } from "@/lib/stores/workspace-types";
import { cardLink } from "@/lib/kudos/card-link";

const h = vi.hoisted(() => ({
  owner: true,
  broadcast: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/lib/history/use-history-logger", () => ({ useHistoryLogger: () => ({ log: h.log }) }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/components/collab/session-share-button", () => ({ SessionShareButton: () => null }));
vi.mock("@/app/(tools)/kudos/components/kudos-beacon", () => ({ KudosBeacon: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => undefined }));
vi.mock("@/lib/gamification/engine", () => ({ dispatch: () => undefined }));
vi.mock("@/lib/predictions/use-predicted-default", () => ({
  usePredictedDefault: () => ({ confidence: "none", value: "" }),
}));
vi.mock("@/lib/kudos/llm/sentiment", () => ({ analyseSentiment: async () => null }));
vi.mock("@/lib/kudos/llm", () => ({
  analyseSentiment: async () => null,
  detectDuplicate: async () => null,
  computeFairness: async () => null,
  installFairnessInvalidator: () => () => undefined,
  primeRecipientSuggestion: async () => undefined,
}));
vi.mock("@/lib/kudos/card-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kudos/card-image")>()),
  cardImage: async () => new Blob(["png"], { type: "image/png" }),
  downloadBlob: vi.fn(),
}));
vi.mock("@/lib/auth/use-is-owner", () => ({
  useIsOwner: () => h.owner,
  useOwnerState: () => ({ isOwner: h.owner, settled: true, unverified: false, visitor: !h.owner }),
}));
vi.mock("@/lib/auth/auth-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/auth-provider")>()),
  useAuthOptional: () =>
    h.owner
      ? {
          status: "authenticated",
          user: { id: "owner-1", user_metadata: {} },
          profile: { display_name: "Mia" },
        }
      : null,
}));
vi.mock("@/lib/realtime/use-room", () => ({
  useRoom: () => ({
    isConnected: h.owner,
    isLocalOnly: !h.owner,
    userId: "u-1",
    members: [],
    broadcast: h.broadcast,
    subscribeToEvent: () => () => undefined,
  }),
}));

import { KudosClient } from "@/app/(tools)/kudos/kudos-client";

const ws = () => useWorkspaceStore.getState();

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <KudosClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const cardGroup = () => screen.getByRole("group", { name: "Card" });
/** A button's name as a screen reader reads it here: its aria-label, else its text. */
const nameOf = (b: HTMLElement) => b.getAttribute("aria-label") ?? b.textContent;
const buttonsIn = (group: HTMLElement) => within(group).getAllByRole("button").map(nameOf);
const pressedIn = (group: HTMLElement) =>
  within(group)
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map(nameOf);
/** The pressed theme. */
const pressed = () => pressedIn(cardGroup());
/** The pressed card among the theme's cards. */
const pressedCard = (theme: string) =>
  pressedIn(screen.getByRole("group", { name: `${theme} cards` }));
const REMINDS = "Which episode does this remind you of?";

beforeEach(() => {
  h.owner = true;
  h.broadcast.mockReset();
  h.log.mockReset();
  localStorage.clear();
  resetSelectedSprint();
  window.history.replaceState(null, "", "/kudos");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
  );
  useWorkspaceStore.setState({
    kudos: [],
    teamMembers: [{ id: "m-sara", name: "Sara" }],
    sprints: [],
    retroBoards: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the cards on offer", () => {
  it("are the printed ones by theme, starting on Thank you!, with the privacy rule and no Team", () => {
    renderPage();
    expect(buttonsIn(cardGroup())).toEqual(["Focus", "Ownership", "Real needs", "Trust", "Open"]);
    expect(pressed()).toEqual(["Open"]);
    expect(buttonsIn(screen.getByRole("group", { name: "Open cards" }))).toEqual([
      "Thank you!",
      "Great teamwork!",
    ]);
    expect(pressedCard("Open")).toEqual(["Thank you!"]);
    // An open card can name the book episode it reminds the sender of: none yet.
    const reminds = screen.getByLabelText(REMINDS) as HTMLSelectElement;
    expect(reminds.value).toBe("");
    const options = within(reminds).getAllByRole("option");
    expect(options).toHaveLength(27);
    expect(options[0]).toHaveTextContent("No episode");
    expect(options[7]).toHaveTextContent("EP 07 · Nobody Owns It");
    expect(screen.getByRole("heading", { name: "Thank you!" })).toBeInTheDocument();
    // In the form (How kudos cards work, below it, says it too).
    const form = screen.getByRole("button", { name: /send kudos/i }).closest("form")!;
    expect(
      within(form).getByText(
        "First names and general thanks only. No customer names or internal details."
      )
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Team/)).toBeNull();
    // The printed card's back, in its order.
    const labels = ["To", "Thank you for", "From"].map((l) => screen.getByLabelText(l));
    for (let i = 1; i < labels.length; i++) {
      expect(
        labels[i - 1].compareDocumentPosition(labels[i]) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
  });

  it("draws a card saved under one of the original themes as the Thank you! card", () => {
    useWorkspaceStore.setState({
      kudos: [
        {
          id: "kud_old",
          theme: "well-done",
          toName: "Sara",
          fromName: "Mia",
          teamName: "Payments",
          message: "Great release",
          sentAt: new Date().toISOString(),
        },
      ],
    });
    renderPage();
    const entry = screen.getByRole("article", { name: /^Thank you! kudos from Mia to Sara/ });
    expect(within(entry).getByRole("heading", { name: "Thank you!" })).toBeInTheDocument();
    expect(screen.queryByText("Well Done")).toBeNull();
    expect(screen.getByText(/Payments/)).toBeInTheDocument();
  });

  it("lists a theme's episode cards, and keeps the card when its own theme is picked again", () => {
    renderPage();
    fireEvent.click(within(cardGroup()).getByRole("button", { name: "Ownership" }));
    expect(pressed()).toEqual(["Ownership"]);
    const ownership = screen.getByRole("group", { name: "Ownership cards" });
    expect(buttonsIn(ownership)).toEqual([
      "Episode 5: Thanks for getting us unblocked",
      "Episode 7: Thanks for seeing it through",
      "Episode 8: Thanks for not leaving anyone stuck",
      "Episode 14: Thanks for fixing it properly",
      "Episode 17: Thanks for fixing the cause",
      "Episode 18: Thanks for owning your part",
      "Episode 19: Thanks for keeping your promise",
      "Episode 20: Thanks for tracing where it got lost",
    ]);
    // A theme starts on its first episode's card.
    expect(pressedCard("Ownership")).toEqual(["Episode 5: Thanks for getting us unblocked"]);
    expect(screen.getByRole("heading", { name: "Thanks for getting us unblocked" })).toBeTruthy();
    // Each card shows its EP number and the rest of its headline.
    const ep7 = within(ownership).getByRole("button", {
      name: "Episode 7: Thanks for seeing it through",
    });
    expect(within(ep7).getByText("EP 07")).toBeInTheDocument();
    expect(within(ep7).getByText("seeing it through")).toBeInTheDocument();
    // Only an open card names the episode it reminds of.
    expect(screen.queryByLabelText(REMINDS)).toBeNull();

    fireEvent.click(ep7);
    expect(pressedCard("Ownership")).toEqual(["Episode 7: Thanks for seeing it through"]);
    expect(screen.getByRole("heading", { name: "Thanks for seeing it through" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Thanks for getting us unblocked" })).toBeNull();

    fireEvent.click(within(cardGroup()).getByRole("button", { name: "Ownership" }));
    expect(pressedCard("Ownership")).toEqual(["Episode 7: Thanks for seeing it through"]);

    fireEvent.click(within(cardGroup()).getByRole("button", { name: "Trust" }));
    expect(pressed()).toEqual(["Trust"]);
    expect(screen.queryByRole("group", { name: "Ownership cards" })).toBeNull();
    expect(pressedCard("Trust")).toEqual(["Episode 4: Thanks for saving us a meeting"]);
    expect(screen.queryByRole("heading", { name: "Thanks for seeing it through" })).toBeNull();

    fireEvent.click(within(cardGroup()).getByRole("button", { name: "Open" }));
    expect(pressedCard("Open")).toEqual(["Thank you!"]);
  });

  it("sends an open card with the episode it reminds of, and keeps both for the next one", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Great teamwork!" }));
    expect(pressedCard("Open")).toEqual(["Great teamwork!"]);
    fireEvent.change(screen.getByLabelText(REMINDS), { target: { value: "7" } });
    // The preview's back asks the same question, and answers it.
    expect(screen.getByText("Episode 07, “Nobody Owns It”")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "team:m-sara" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), {
      target: { value: "pairing on the release" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await waitFor(() => expect(ws().kudos).toHaveLength(1));
    expect(ws().kudos![0]).toMatchObject({ theme: "open-teamwork", episode: 7, toName: "Sara" });
    expect(pressedCard("Open")).toEqual(["Great teamwork!"]);
    expect((screen.getByLabelText(REMINDS) as HTMLSelectElement).value).toBe("7");

    // No episode: the card keeps none.
    fireEvent.change(screen.getByLabelText(REMINDS), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "team:m-sara" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), { target: { value: "the demo" } });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await waitFor(() => expect(ws().kudos).toHaveLength(2));
    const plain = ws().kudos!.find((k) => k.message === "the demo");
    expect(plain).toMatchObject({ theme: "open-teamwork" });
    expect(plain).not.toHaveProperty("episode");
  });
});

describe("/kudos?ep=NN", () => {
  it("opens on episode 7's card: Ownership, its headline, and the card keeps only ep", async () => {
    window.history.replaceState(null, "", "/kudos?ep=07");
    renderPage();
    await waitFor(() => expect(pressed()).toEqual(["Ownership"]));
    expect(pressedCard("Ownership")).toEqual(["Episode 7: Thanks for seeing it through"]);
    expect(
      screen.getAllByRole("heading", { name: "Thanks for seeing it through" }).length
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "team:m-sara" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), {
      target: { value: "staying with the release" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await waitFor(() => expect(ws().kudos).toHaveLength(1));
    const sent = ws().kudos![0];
    expect(sent).toMatchObject({ theme: "ownership", episode: 7, toName: "Sara" });
    expect(JSON.stringify(sent)).not.toContain("Thanks for seeing it through");
    // The card stays picked for the next kudos.
    expect(pressedCard("Ownership")).toEqual(["Episode 7: Thanks for seeing it through"]);
  });

  it("opens on another habit's episode, and picking a theme moves to its first card", async () => {
    window.history.replaceState(null, "", "/kudos?ep=12");
    renderPage();
    await waitFor(() => expect(pressed()).toEqual(["Real needs"]));
    expect(pressedCard("Real needs")).toEqual(["Episode 12: Thanks for hearing every voice"]);
    fireEvent.click(within(cardGroup()).getByRole("button", { name: "Focus" }));
    expect(pressedCard("Focus")).toEqual(["Episode 1: Thanks for choosing what comes first"]);
    expect(screen.queryByRole("heading", { name: "Thanks for hearing every voice" })).toBeNull();
  });

  it.each(["27", "0", "abc"])("ignores ep=%s", (ep) => {
    window.history.replaceState(null, "", `/kudos?ep=${ep}`);
    renderPage();
    expect(pressed()).toEqual(["Open"]);
    expect(pressedCard("Open")).toEqual(["Thank you!"]);
  });
});

describe("a visitor's kudos", () => {
  beforeEach(() => {
    h.owner = false;
  });

  const write = () => {
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "Sara" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), {
      target: { value: "the clear handover" },
    });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "Omar" } });
  };

  it("starts each sent card's panel afresh, outside the form, and Write another goes back to it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    write();
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await screen.findByRole("heading", { name: "Your kudos for Sara is ready" });
    const link = (await screen.findByLabelText("Link to this card")) as HTMLInputElement;
    expect(link.closest("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(link.value);

    // A second card while the panel is open: nothing of the first one's state is left.
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "Ben" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), { target: { value: "the demo" } });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await screen.findByRole("heading", { name: "Your kudos for Ben is ready" });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link copied" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Write another" }));
    expect(screen.queryByRole("heading", { name: /is ready/ })).toBeNull();
    expect(screen.getByLabelText("To")).toHaveFocus();
  });

  it("refuses a message longer than a card can carry, however few its words", async () => {
    renderPage();
    write();
    const box = screen.getByLabelText("Thank you for") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(2000);
    fireEvent.change(box, { target: { value: "x".repeat(2001) } });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    expect(await screen.findByText("Keep it to 50 words.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /is ready/ })).toBeNull();
  });

  it("names its recipient in a plain text box", () => {
    renderPage();
    expect(screen.getByLabelText("To").tagName).toBe("INPUT");
  });

  it("reads how the cards work, with the link line, and never sees Not thanked yet", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "How kudos cards work" })).toBeInTheDocument();
    expect(
      screen.getByText("Online, Send kudos gives you a link and an image to pass on.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Online, Send kudos pins it on your squad's wall.")).toBeNull();
    // The panel is the owner's: a visitor has the same roster in this test, and no list.
    expect(screen.queryByRole("heading", { name: "Not thanked yet" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Not thanked yet" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Send to/ })).toBeNull();
  });

  it("goes as a link and an image, keeping nothing", async () => {
    renderPage();
    expect(screen.getByRole("checkbox", { name: "Keep a copy on this device" })).not.toBeChecked();
    write();
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    expect(
      await screen.findByRole("heading", { name: "Your kudos for Sara is ready" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing was saved/)).toBeInTheDocument();
    const link = (await screen.findByLabelText("Link to this card")) as HTMLInputElement;
    expect(link.value.startsWith(`${window.location.origin}/kudos#k=s1.`)).toBe(true);
    expect(link.value).not.toContain("Sara");
    expect(ws().kudos).toEqual([]);
    expect(h.broadcast).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Download image" })).toBeInTheDocument();
  });

  it("keeps a copy on this device only when asked, with no names in the history", async () => {
    renderPage();
    write();
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep a copy on this device" }));
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await waitFor(() => expect(ws().kudos).toHaveLength(1));
    expect(await screen.findByText(/A copy is kept on this device/)).toBeInTheDocument();
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.log.mock.calls[0])).not.toContain("Sara");
  });
});

describe("a card's link", () => {
  const CARD: Kudos = {
    id: "kud_link",
    theme: "trust",
    episode: 4,
    toName: "Lina",
    fromName: "Omar",
    message: "for owning the outage call",
    sentAt: "2026-11-06T10:00:00.000Z",
  };

  it("opens the card read-only, and Send your own leaves the plain page", async () => {
    h.owner = false;
    const link = await cardLink(CARD, window.location.origin);
    window.history.replaceState(null, "", link.slice(window.location.origin.length));
    renderPage();
    const heading = await screen.findByRole("heading", { name: "A kudos card for Lina" });
    const panel = heading.closest("section")!;
    expect(within(panel).getByText("for owning the outage call")).toBeInTheDocument();
    expect(within(panel).getByText("Trust")).toBeInTheDocument();
    expect(ws().kudos).toEqual([]);
    // The form is on an open card, whose episode select sits above To.
    expect(
      screen.getByRole("combobox", { name: "Which episode does this remind you of?" })
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Send your own" }));
    });
    expect(screen.queryByRole("heading", { name: "A kudos card for Lina" })).toBeNull();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/kudos");
    // On to To, not the card picker's select.
    expect(screen.getByRole("textbox", { name: "To" })).toHaveFocus();
  });

  it("stays open when another part of the page is linked, like Skip to content", async () => {
    const link = await cardLink(CARD, window.location.origin);
    window.history.replaceState(null, "", link.slice(window.location.origin.length));
    renderPage();
    await screen.findByRole("heading", { name: "A kudos card for Lina" });
    await act(async () => {
      window.history.pushState(null, "", "/kudos#main-content");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { name: "A kudos card for Lina" })).toBeInTheDocument();
  });

  it("says so when the link is damaged", async () => {
    window.history.replaceState(null, "", "/kudos#k=s1.not-a-card");
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "This kudos link didn't open" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send your own" })).toBeInTheDocument();
  });
});
