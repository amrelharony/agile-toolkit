/**
 * The panel a visitor gets after sending a kudos: it starts fetching the
 * card image's sharper panel as soon as the card is on screen, and Share
 * waits for that file only briefly, since a browser opens the share sheet
 * only within a few seconds of the click. Download waits the usual time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Kudos } from "@/lib/stores/workspace-types";

const h = vi.hoisted(() => ({
  cardImage: vi.fn(),
  shareCardImage: vi.fn(),
  downloadBlob: vi.fn(),
  warmCardImage: vi.fn(),
  stopWarming: vi.fn(),
}));

vi.mock("@/lib/kudos/card-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kudos/card-image")>()),
  canShareImage: () => true,
  cardImage: h.cardImage,
  shareCardImage: h.shareCardImage,
  downloadBlob: h.downloadBlob,
  warmCardImage: h.warmCardImage,
}));
vi.mock("@/lib/kudos/card-link", () => ({
  cardLink: async () => "https://toolkit.example/kudos#k=s1.abc",
}));

import { KudosSent } from "@/app/(tools)/kudos/components/kudos-sent";
import { SHARE_IMAGE_OPTIONS } from "@/lib/kudos/card-image";

const EP7: Kudos = {
  id: "kud_7",
  theme: "ownership",
  episode: 7,
  toName: "Sara",
  fromName: "Mia",
  message: "staying with the release until it shipped",
  sentAt: "2026-11-06T10:00:00.000Z",
};

const BLOB = new Blob(["png"], { type: "image/png" });

beforeEach(() => {
  h.cardImage.mockReset().mockResolvedValue(BLOB);
  h.shareCardImage.mockReset().mockResolvedValue(true);
  h.downloadBlob.mockReset();
  h.stopWarming.mockReset();
  h.warmCardImage.mockReset().mockReturnValue(h.stopWarming);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KudosSent", () => {
  it("starts fetching the sharper panel for the card on screen, and stops waiting when it closes", () => {
    const { unmount } = render(<KudosSent kudos={EP7} kept onDone={() => {}} />);
    expect(h.warmCardImage).toHaveBeenCalledTimes(1);
    const card = h.warmCardImage.mock.calls[0][0] as HTMLElement;
    expect(card).toBeInstanceOf(HTMLElement);
    expect(card).toHaveTextContent("Sara");
    unmount();
    expect(h.stopWarming).toHaveBeenCalledTimes(1);
  });

  it("shares an image made within the share sheet's few seconds", async () => {
    render(<KudosSent kudos={EP7} kept onDone={() => {}} />);
    await screen.findByLabelText("Link to this card");
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() => expect(h.shareCardImage).toHaveBeenCalledTimes(1));
    expect(h.cardImage).toHaveBeenCalledWith(expect.any(HTMLElement), SHARE_IMAGE_OPTIONS);
    expect(h.shareCardImage).toHaveBeenCalledWith(
      BLOB,
      "kudos-to-sara.png",
      "https://toolkit.example/kudos#k=s1.abc"
    );
  });

  it("puts the link and Copy link / Share above the card on a phone, and below it from sm up", async () => {
    // jsdom does no layout, so this reads the order: on a phone the actions
    // come first in the page (which a screen reader follows too), and the
    // group's sm:order-last puts the card back first on wider screens.
    const { container } = render(<KudosSent kudos={EP7} kept onDone={() => {}} />);
    const linkBox = await screen.findByLabelText("Link to this card");
    const copy = screen.getByRole("button", { name: /copy link/i });
    const share = screen.getByRole("button", { name: /share/i });
    const card = container.querySelector("[data-kudos-id]")!;
    expect(card).toHaveTextContent("Sara");
    for (const el of [linkBox, copy, share]) {
      expect(el.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    const actions = copy.closest('[class~="sm:order-last"]')!;
    expect(actions).not.toBeNull();
    expect(actions).toContainElement(linkBox);
    expect(actions).toContainElement(share);
    expect(actions.contains(card)).toBe(false);
    // The group and the card sit side by side in the panel's column, so the
    // order class reorders exactly these two, under the heading and status.
    const section = screen.getByRole("region", { name: /your kudos for sara is ready/i });
    expect(actions.parentElement).toBe(section);
    expect(section).toHaveClass("flex", "flex-col");
    expect(section.lastElementChild).toContainElement(card as HTMLElement);
    expect(screen.getByRole("status").compareDocumentPosition(actions)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("downloads an image that waited the usual time", async () => {
    render(<KudosSent kudos={EP7} kept onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    await waitFor(() => expect(h.downloadBlob).toHaveBeenCalledWith(BLOB, "kudos-to-sara.png"));
    expect(h.cardImage).toHaveBeenCalledWith(expect.any(HTMLElement), undefined);
  });
});
