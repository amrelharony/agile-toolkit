/**
 * The Kudos page's printed cards: the four habits and two open cards in the
 * picker, ?ep=NN opening on that episode's card, To / Thank you for / From,
 * the privacy rule, and a visitor's kudos sent as a link and an image that
 * keep nothing unless they keep a copy, opened again from its link.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useKudosSettingsStore } from "@/lib/stores/kudos-settings-store";
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
const pressed = () =>
  within(cardGroup())
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

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
  useKudosSettingsStore.setState({ customThemes: [] });
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
  it("are the printed ones, starting on Thank you!, with the privacy rule and no Team", () => {
    renderPage();
    expect(
      within(cardGroup())
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Focus", "Ownership", "Real needs", "Trust", "Thank you!", "Great teamwork!"]);
    expect(pressed()).toEqual(["Thank you!"]);
    expect(
      screen.getByText(
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

  it("still shows a card saved under one of the original themes", () => {
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
    expect(screen.getAllByText("Well Done").length).toBeGreaterThan(0);
    expect(screen.getByText(/Payments/)).toBeInTheDocument();
  });
});

describe("/kudos?ep=NN", () => {
  it("opens on episode 7's card: Ownership, its headline and quote, and the card keeps only ep", async () => {
    window.history.replaceState(null, "", "/kudos?ep=07");
    renderPage();
    await waitFor(() => expect(pressed()).toEqual(["Ownership"]));
    expect(screen.getAllByText("Thanks for seeing it through").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("To"), { target: { value: "team:m-sara" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), {
      target: { value: "staying with the release" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await waitFor(() => expect(ws().kudos).toHaveLength(1));
    const sent = ws().kudos![0];
    expect(sent).toMatchObject({ theme: "ownership", episode: 7, toName: "Sara" });
    expect(JSON.stringify(sent)).not.toContain("Thanks for seeing it through");
  });

  it("drops the episode's words when another card is picked, or when asked", async () => {
    window.history.replaceState(null, "", "/kudos?ep=7");
    renderPage();
    await waitFor(() => expect(pressed()).toEqual(["Ownership"]));
    fireEvent.click(within(cardGroup()).getByRole("button", { name: "Focus" }));
    expect(screen.queryByText("Thanks for seeing it through")).toBeNull();

    fireEvent.click(within(cardGroup()).getByRole("button", { name: "Ownership" }));
    expect(screen.queryByText("Thanks for seeing it through")).toBeNull();
  });

  it("lets the episode's words go while keeping its card", async () => {
    window.history.replaceState(null, "", "/kudos?ep=12");
    renderPage();
    await waitFor(() => expect(pressed()).toEqual(["Real needs"]));
    fireEvent.click(screen.getByRole("button", { name: "Leave out its words" }));
    expect(pressed()).toEqual(["Real needs"]);
    expect(screen.queryByRole("button", { name: "Leave out its words" })).toBeNull();
  });

  it.each(["27", "0", "abc"])("ignores ep=%s", (ep) => {
    window.history.replaceState(null, "", `/kudos?ep=${ep}`);
    renderPage();
    expect(pressed()).toEqual(["Thank you!"]);
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

    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Send your own" }));
    });
    expect(screen.queryByRole("heading", { name: "A kudos card for Lina" })).toBeNull();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/kudos");
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
