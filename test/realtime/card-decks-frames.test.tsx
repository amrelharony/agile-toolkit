/**
 * Card Decks' show-room frame ("cards"): the host builds it from its own
 * deck (cleaned and cut, never more than seven cards), the parser accepts
 * exactly that and refuses anything else, the registry knows the kind, and
 * the renderer draws a dealt card large on a phone and a hand as a list.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { ShowFrameView } from "@/components/collab/show-room/show-frame-view";
import {
  CARDS_FRAME_KIND,
  CARDS_FRAME_LIMITS,
  cardsFrame,
  parseCardsFrame,
} from "@/lib/realtime/show-room/frames/card-decks";
import {
  encodeShowPayload,
  parseShowPayload,
  showFrameKinds,
} from "@/lib/realtime/show-room/frames";
import { SHOW_LIMITS } from "@/lib/realtime/show-room/protocol";
import { showRendererFor } from "@/lib/realtime/show-room/renderers";
import type { ShowFrame } from "@/lib/realtime/show-room/use-show-room";

const card = { text: "What helped us most this sprint?" };

describe("the cards frame", () => {
  it("is a kind Card Decks shows, beside the generic text frame", () => {
    expect(showFrameKinds("card-decks").sort()).toEqual(["cards", "text"]);
    expect(showFrameKinds("picker")).not.toContain("cards");
    expect(showRendererFor("card-decks", CARDS_FRAME_KIND)).not.toBeNull();
  });

  it("is built from the host's own deck: cleaned, cut, blank cards dropped, at most seven", () => {
    const frame = cardsFrame(" Retro‮ prompts ", [
      { text: "  One\n two  ", title: "Path", hint: "How‮ it works" },
      { text: "   " },
      ...Array.from({ length: 9 }, (_, i) => ({ text: `Card ${i}`, title: "" })),
    ]);
    expect(frame?.deck).toBe("Retro prompts");
    expect(frame?.cards[0]).toEqual({ text: "One two", title: "Path", hint: "How it works" });
    expect(frame?.cards).toHaveLength(CARDS_FRAME_LIMITS.maxCards);
    expect(frame?.cards[1]).toEqual({ text: "Card 0" });
    expect(cardsFrame("Deck", [{ text: "x".repeat(300) }])?.cards[0].text).toHaveLength(140);
    expect(cardsFrame("", [card])).toBeNull();
    expect(cardsFrame("Deck", [{ text: " " }])).toBeNull();
  });

  it("parses exactly what was built, and drops unknown fields", () => {
    const frame = cardsFrame("Yay! questions", [card, { text: "Who helped?", hint: "Name one" }])!;
    expect(parseCardsFrame({ ...frame, extra: 1 })).toEqual(frame);
    const data = encodeShowPayload("card-decks", CARDS_FRAME_KIND, frame)!;
    expect(data.length).toBeLessThan(SHOW_LIMITS.maxPayloadChars);
    expect(parseShowPayload("card-decks", CARDS_FRAME_KIND, data)).toEqual(frame);
  });

  it("refuses text that isn't clean, too long, too many cards, or the wrong shape", () => {
    const ok = { deck: "Deck", cards: [card] };
    expect(parseCardsFrame(ok)).toEqual(ok);
    expect(parseCardsFrame({ ...ok, deck: " Deck" })).toBeNull();
    expect(parseCardsFrame({ ...ok, cards: [{ text: "a‮b" }] })).toBeNull();
    expect(parseCardsFrame({ ...ok, cards: [{ text: "x".repeat(141) }] })).toBeNull();
    expect(parseCardsFrame({ ...ok, cards: [{ text: "ok", title: 5 }] })).toBeNull();
    expect(parseCardsFrame({ ...ok, cards: [{ text: "ok", hint: "" }] })).toBeNull();
    expect(parseCardsFrame({ ...ok, cards: [] })).toBeNull();
    expect(parseCardsFrame({ ...ok, cards: Array.from({ length: 8 }, () => card) })).toBeNull();
    expect(parseCardsFrame({ ...ok, cards: "nope" })).toBeNull();
    expect(parseCardsFrame([ok])).toBeNull();
    expect(parseShowPayload("card-decks", CARDS_FRAME_KIND, "{not json")).toBeNull();
    expect(
      encodeShowPayload("card-decks", CARDS_FRAME_KIND, { deck: "", cards: [card] })
    ).toBeNull();
  });

  it("stays well under the payload cap at seven full cards", () => {
    const full = cardsFrame(
      "d".repeat(60),
      Array.from({ length: 7 }, (_, i) => ({
        text: `${i}`.repeat(140),
        title: "t".repeat(60),
        hint: "h".repeat(200),
      }))
    );
    const data = encodeShowPayload("card-decks", CARDS_FRAME_KIND, full)!;
    expect(data).not.toBeNull();
    expect(data.length).toBeLessThan(SHOW_LIMITS.maxPayloadChars / 2);
  });
});

describe("the cards renderer", () => {
  const frameOf = (payload: unknown, n = 1): ShowFrame => ({
    n,
    kind: CARDS_FRAME_KIND,
    payload,
    supported: true,
    at: 1_700_000_000_000 + n,
  });

  it("draws one card large on a phone, with its title and hint", () => {
    render(
      <LiveAnnouncerProvider>
        <ShowFrameView
          tool="card-decks"
          frame={frameOf(
            cardsFrame("Story splitting", [
              { text: "Checkout: the happy path first.", title: "Path", hint: "Main path first." },
            ])
          )}
        />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByText("Story splitting")).toBeTruthy();
    const text = screen.getByText("Checkout: the happy path first.");
    expect(text.className).toContain("text-2xl");
    expect(screen.getByText("Path")).toBeTruthy();
    expect(screen.getByText("Main path first.")).toBeTruthy();
  });

  it("draws a hand as a list of cards, with the count beside the deck", () => {
    render(
      <LiveAnnouncerProvider>
        <ShowFrameView
          tool="card-decks"
          surface="host"
          frame={frameOf(cardsFrame("Retro prompts", [{ text: "One?" }, { text: "Two?" }]))}
        />
      </LiveAnnouncerProvider>
    );
    expect(screen.getByText(/Retro prompts/).textContent).toBe("Retro prompts · 2 cards");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("One?").className).not.toContain("text-2xl");
  });
});
