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
vi.mock("@/lib/kudos/llm/sentiment", () => ({
  analyseSentiment: vi.fn(async () => null),
}));

import { KudosSent } from "@/app/(tools)/kudos/components/kudos-sent";
import { KudosForm } from "@/app/(tools)/kudos/components/kudos-form";
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

  it("puts the link and Copy link / Share above the card on touch screens, and below it with a mouse from sm up", async () => {
    // jsdom does no layout, so this reads the order: on a phone the actions
    // come first in the page (which a screen reader follows too), and the
    // group's pointer-fine:sm:order-last puts the card back first only with a
    // mouse or trackpad. A landscape phone (812x375) and a tablet are wider
    // than sm but still touch, and the card would push the actions off them.
    const { container } = render(<KudosSent kudos={EP7} kept onDone={() => {}} />);
    const linkBox = await screen.findByLabelText("Link to this card");
    const copy = screen.getByRole("button", { name: /copy link/i });
    const share = screen.getByRole("button", { name: /share/i });
    const card = container.querySelector("[data-kudos-id]")!;
    expect(card).toHaveTextContent("Sara");
    for (const el of [linkBox, copy, share]) {
      expect(el.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    const actions = copy.closest('[class~="pointer-fine:sm:order-last"]')!;
    expect(actions).not.toBeNull();
    // Not by width alone: that puts the card first on a landscape phone.
    for (const byWidth of ["sm:order-last", "md:order-last", "lg:order-last"]) {
      expect(actions).not.toHaveClass(byWidth);
    }
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

describe("ink moment", () => {
  // A heart drawn once by the heading of the sent panel, never while the
  // kudos is still being written, and never on the card the image is made of.
  const heart = (c: ParentNode) => c.querySelector('[data-ink="heart"]');

  it("draws a heart by the heading, outside the card the image is made from", () => {
    const { container } = render(<KudosSent kudos={EP7} kept onDone={() => {}} />);
    const mark = heart(container)!;
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark.parentElement).toContainElement(screen.getByRole("heading", { name: /sara/i }));
    expect(container.querySelector("[data-kudos-id]")!.contains(mark)).toBe(false);
  });

  it("draws no heart while writing, and one once it's sent", async () => {
    const { container } = render(
      <KudosForm
        defaultFromName="Ada"
        recipients={[{ id: "team:1", displayName: "Sam", source: "team" }]}
        delivery="link"
        onSubmit={() => {}}
        onDownload={() => {}}
      />
    );
    expect(heart(container)).toBeNull();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "team:1" } });
    fireEvent.change(screen.getByLabelText("Thank you for"), { target: { value: "Thanks!" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /send kudos/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /send kudos/i }));
    await screen.findByRole("heading", { name: /your kudos for sam is ready/i });
    expect(heart(container)).not.toBeNull();
  });
});
