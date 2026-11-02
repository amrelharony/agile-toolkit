/**
 * Where /book is linked from: the VIP lock (for someone without the book yet),
 * a book episode's notes, and the comics gallery.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/use-is-owner", () => ({ useIsOwner: () => false }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/(tools)/comics/components/entry-beacon", () => ({
  EntryBeacon: () => null,
  CountDisclosure: () => null,
}));

import { ComicsGallery } from "@/app/(tools)/comics/components/comics-gallery";
import { EpisodeNotes } from "@/app/(tools)/comics/components/episode-notes";
import { VipLockedMessage } from "@/components/vip/vip-lock-panel";
import { BOOK } from "@/lib/book/book";
import type { StorySummary } from "@/lib/comics/types";

afterEach(cleanup);

const bookLink = () => screen.getByRole("link", { name: "About the book" });

describe("links to /book", () => {
  it("are on the VIP lock, for a visitor who hasn't got the book", () => {
    render(<VipLockedMessage />);
    expect(bookLink()).toHaveAttribute("href", "/book");
    expect(screen.getByRole("link", { name: "Back to tools" })).toHaveAttribute("href", "/");
  });

  it("are under a book episode's page number", () => {
    render(<EpisodeNotes lesson="L" question="Q" bookPage={9} />);
    expect(screen.getByText("Book page 9")).toBeTruthy();
    expect(bookLink()).toHaveAttribute("href", "/book");
  });

  it("aren't on a weekly story's notes, which has no page in the book", () => {
    render(<EpisodeNotes lesson="L" question="Q" bookPage={null} />);
    expect(screen.queryByRole("link", { name: "About the book" })).toBeNull();
  });

  it("are in the gallery before any story is out, with the back cover's words", () => {
    render(<ComicsGallery stories={[]} />);
    expect(screen.getByText(BOOK.blurb.join(" "))).toBeTruthy();
    expect(bookLink()).toHaveAttribute("href", "/book");
  });

  it("are under this week's story once one is out", () => {
    const story: StorySummary = {
      ep: 30,
      title: "The Unread Handover",
      lesson: "Lesson",
      castNames: [],
      themes: [],
      cover: null,
      releaseAt: "2026-11-02T07:00:00.000Z",
      updatedAt: "2026-11-02T07:00:00.000Z",
    };
    render(<ComicsGallery stories={[story]} />);
    expect(screen.getByText(/The first 26 stories are in the book\./)).toBeTruthy();
    expect(bookLink()).toHaveAttribute("href", "/book");
  });
});
