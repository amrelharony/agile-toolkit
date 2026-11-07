// @vitest-environment node
/** A visitor's kudos travels as a link that holds the card, and only the card. */

import { describe, expect, it } from "vitest";
import type { Kudos } from "@/lib/stores/workspace-types";
import { encodeSnapshot } from "@/lib/share/snapshot";
import { CARD_LINK_HASH, cardLink, isCardLinkHash, readCardLink } from "@/lib/kudos/card-link";

const ORIGIN = "https://agile.test";

const card = (over: Partial<Kudos> = {}): Kudos => ({
  id: "kud_0123456789abcdef",
  version: 2,
  theme: "ownership",
  episode: 7,
  toName: "Sara",
  fromName: "Omar",
  message: "for staying with the release until it was really done",
  sentAt: "2026-11-06T10:00:00.000Z",
  fromProfileId: "11111111-1111-4111-8111-111111111111",
  toMemberId: "m-sara",
  teamName: "Payments",
  sentiment: { label: "positive", confidence: 0.9, tone: ["grateful"] },
  ...over,
});

const hashOf = (link: string) => link.slice(link.indexOf("#"));

describe("a card link", () => {
  it("opens the Kudos page with the card after the #, where no server sees it", async () => {
    const link = await cardLink(card(), ORIGIN);
    expect(link.startsWith(`${ORIGIN}/kudos${CARD_LINK_HASH}s1.`)).toBe(true);
    expect(new URL(link).search).toBe("");
    expect(link).not.toContain("Sara");
  });

  it("gives back the card's face and nothing else about anyone", async () => {
    const opened = await readCardLink(hashOf(await cardLink(card(), ORIGIN)));
    expect(opened).toMatchObject({
      theme: "ownership",
      episode: 7,
      toName: "Sara",
      fromName: "Omar",
      message: "for staying with the release until it was really done",
      sentAt: "2026-11-06T10:00:00.000Z",
    });
    for (const kept of ["fromProfileId", "toMemberId", "teamName", "sentiment"]) {
      expect(opened).not.toHaveProperty(kept);
    }
  });

  it("carries an open card with no episode, and an old theme", async () => {
    for (const theme of ["open-teamwork", "well-done"] as const) {
      const opened = await readCardLink(
        hashOf(await cardLink(card({ theme, episode: undefined }), ORIGIN))
      );
      expect(opened.theme).toBe(theme);
      expect(opened).not.toHaveProperty("episode");
    }
  });

  it("keeps a date a little ahead of this device's clock", async () => {
    const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const opened = await readCardLink(hashOf(await cardLink(card({ sentAt: ahead }), ORIGIN)));
    expect(opened.sentAt).toBe(ahead);
  });

  it("is told apart from any other fragment", () => {
    expect(isCardLinkHash("#k=s1.abc")).toBe(true);
    expect(isCardLinkHash("#s1.abc")).toBe(false);
    expect(isCardLinkHash("#notes")).toBe(false);
    expect(isCardLinkHash("")).toBe(false);
  });
});

describe("a link that isn't a good card", () => {
  const linkOf = async (tool: string, data: unknown) =>
    CARD_LINK_HASH + (await encodeSnapshot({ tool, schema: 1, data }));

  it.each([
    ["another tool's snapshot", "retro", { toName: "Sara" }],
    ["an unknown theme", "kudos-card", { ...card(), theme: "nope" }],
    ["an episode past the book", "kudos-card", { ...card(), episode: 27 }],
    ["no message", "kudos-card", { ...card(), message: "" }],
    ["a bad date", "kudos-card", { ...card(), sentAt: "soon" }],
    ["a list", "kudos-card", [card()]],
  ])("is refused: %s", async (_label, tool, data) => {
    await expect(readCardLink(await linkOf(tool, data))).rejects.toThrow(
      "This link doesn't hold a kudos card."
    );
  });

  it("is refused when damaged or not a card link at all", async () => {
    await expect(readCardLink("#k=s1.!!!")).rejects.toThrow();
    await expect(readCardLink("#k=garbage")).rejects.toThrow();
    await expect(readCardLink("#notes")).rejects.toThrow("This isn't a kudos link.");
  });
});
