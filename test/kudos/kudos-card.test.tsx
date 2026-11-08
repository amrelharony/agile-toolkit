/**
 * A kudos card drawn as the printed Agile at Work card: both faces at full
 * size (the band's headline, the panel, the EP chip; To / Thank you for /
 * From / Date, the lesson and where to read it), one small face on the wall,
 * and the "Thank you!" card for anything that isn't one of the 28 designs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { KudosCard } from "@/app/(tools)/kudos/components/kudos-card";
import { CARD_PANEL_PATHS } from "@/lib/kudos/card-panels";
import type { Kudos } from "@/lib/stores/workspace-types";

const BASE = "https://ref.supabase.co/storage/v1/object/public/comic-panels";
const url = (path: string) => `${BASE}/${path}`;

const EP7: Kudos = {
  id: "kud_7",
  theme: "ownership",
  episode: 7,
  toName: "Sara",
  fromName: "Mia",
  teamName: "Payments",
  message: "staying with the release until it shipped",
  sentAt: "2026-11-06T10:00:00.000Z",
};

const OPEN: Kudos = {
  id: "kud_open",
  theme: "open-thank-you",
  toName: "Sam",
  fromName: "Ada",
  message: "the review",
  sentAt: "2026-11-06T10:00:00.000Z",
};

const EP7_ALT = "Episode 7: Captain Blocker Ox says “I’ll own this job until it’s fixed.”";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Says each of these once, as getByText insists. */
function once(...texts: string[]) {
  for (const t of texts) expect(screen.getByText(t)).toBeInTheDocument();
}

describe("an episode's card at full size", () => {
  it("has the printed front: the band's headline, the panel and the EP chip with the title", () => {
    render(<KudosCard kudos={EP7} excludeInteractive />);
    expect(
      screen.getByRole("heading", { name: "Thanks for seeing it through" })
    ).toBeInTheDocument();
    once("Thanks for", "seeing it through", "Nobody Owns It");
    const img = screen.getByRole("img", { name: EP7_ALT });
    expect(img).toHaveAttribute("src", url(CARD_PANEL_PATHS["ep-07"].large));
    expect(img).toHaveAttribute(
      "srcset",
      `${url(CARD_PANEL_PATHS["ep-07"].small)} 360w, ${url(CARD_PANEL_PATHS["ep-07"].large)} 720w`
    );
    expect(img).toHaveAttribute("sizes", "260px");
    expect(img).toHaveAttribute("crossorigin", "anonymous");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveAttribute("width", "720");
    expect(img).toHaveAttribute("height", "720");
    expect(img).not.toHaveAttribute("loading");
    // Front footer and back band.
    expect(screen.getAllByText("EP 07")).toHaveLength(2);
    expect(screen.getAllByText("Agile at Work")).toHaveLength(2);
  });

  it("has the printed back: To, Thank you for, From, Date, the lesson and its page", () => {
    render(<KudosCard kudos={EP7} excludeInteractive />);
    once(
      "Kudos",
      "Ownership",
      "To:",
      "Sara",
      "Thank you for:",
      "staying with the release until it shipped",
      "From:",
      "Mia, Payments",
      "Date:",
      "11/6/2026",
      "The lesson",
      "Own the outcome; you do not have to do every part yourself.",
      "Read Episode 07, “Nobody Owns It”, on page 47.",
      "Borrow the book from your Scrum Master.",
      "agile.amrelharony.com/comics"
    );
    expect(screen.queryByText("Which episode does this remind you of?")).toBeNull();
  });

  it("moves the Date down a line rather than splitting the From name mid-word", () => {
    // jsdom does no layout, so this reads the classes. With min-w-0 the From
    // item could shrink below its longest word next to the Date, and the name
    // broke mid-word on a phone ("Workspac / e owner"), in the image too.
    render(<KudosCard kudos={{ ...EP7, teamName: undefined, fromName: "Workspace owner" }} />);
    const from = screen.getByText("From:").parentElement!;
    expect(from).toHaveClass("flex-1", "max-w-full");
    expect(from).not.toHaveClass("min-w-0");
    // A single token longer than the whole row still breaks inside the line.
    expect(screen.getByText("Workspace owner")).toHaveClass("min-w-0", "break-words");
    const row = from.parentElement!;
    expect(row).toHaveClass("flex-wrap");
    expect(screen.getByText("Date:").parentElement).toHaveClass("shrink-0");
  });

  it("says a date it can't read as a dash", () => {
    render(<KudosCard kudos={{ ...EP7, sentAt: "lol" }} excludeInteractive />);
    once("—");
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("leaves Thank you for out of a reply, which thanks the sender back", () => {
    render(<KudosCard kudos={{ ...EP7, replyTo: "kud_0" }} excludeInteractive />);
    expect(screen.queryByText("Thank you for:")).toBeNull();
    once("staying with the release until it shipped");
  });

  it("names none of its parts To, Thank you for, From, Card or Team for a form to collide with", () => {
    const { container } = render(<KudosCard kudos={EP7} excludeInteractive />);
    for (const name of ["To", "Thank you for", "From", "Card", /Team/]) {
      expect(screen.queryByLabelText(name)).toBeNull();
    }
    expect(container.querySelector("label")).toBeNull();
  });
});

describe("an open card at full size", () => {
  it("is Thank you!, with a decorative panel, Open on its back, and no episode", () => {
    const { container } = render(<KudosCard kudos={OPEN} excludeInteractive />);
    expect(screen.getByRole("heading", { name: "Thank you!" })).toBeInTheDocument();
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("src", url(CARD_PANEL_PATHS["open-thank-you"].large));
    once("Open", "Sam", "Thank you for:", "the review", "Ada");
    expect(screen.queryByText(/^EP \d\d$/)).toBeNull();
    expect(screen.queryByText("The lesson")).toBeNull();
    expect(screen.queryByText("Which episode does this remind you of?")).toBeNull();
    expect(screen.getAllByText("Agile at Work")).toHaveLength(2);
  });

  it("names the episode it reminds the sender of", () => {
    render(
      <KudosCard kudos={{ ...OPEN, theme: "open-teamwork", episode: 7 }} excludeInteractive />
    );
    expect(screen.getByRole("heading", { name: "Great teamwork!" })).toBeInTheDocument();
    once("Which episode does this remind you of?", "Episode 07, “Nobody Owns It”");
    expect(screen.queryByText("The lesson")).toBeNull();
    expect(screen.queryByText(/^EP \d\d$/)).toBeNull();
  });

  it("is what a card saved under an original theme or a custom one is drawn as", () => {
    const { rerender } = render(
      <KudosCard kudos={{ ...OPEN, theme: "well-done", teamName: "Payments" }} excludeInteractive />
    );
    expect(screen.getByRole("heading", { name: "Thank you!" })).toBeInTheDocument();
    expect(screen.queryByText("Well Done")).toBeNull();
    once("Ada, Payments");

    rerender(
      <KudosCard
        kudos={{ ...OPEN, theme: { id: "trust", title: "Ship day", emoji: "🚀", hex: "#123456" } }}
        excludeInteractive
      />
    );
    expect(screen.getByRole("heading", { name: "Thank you!" })).toBeInTheDocument();
    expect(screen.queryByText("Ship day")).toBeNull();
    expect(screen.queryByText("Trust")).toBeNull();

    rerender(<KudosCard kudos={{ ...OPEN, theme: "focus" }} excludeInteractive />);
    expect(screen.getByRole("heading", { name: "Thank you!" })).toBeInTheDocument();
    expect(screen.queryByText("Focus")).toBeNull();
  });
});

describe("a compact card", () => {
  it("is one face: the band, a lazy thumbnail and the words, each once", () => {
    const { container } = render(<KudosCard kudos={EP7} compact />);
    expect(
      screen.getByRole("heading", { name: "Thanks for seeing it through" })
    ).toBeInTheDocument();
    const img = screen.getByRole("img", { name: EP7_ALT });
    expect(img).toHaveAttribute("src", url(CARD_PANEL_PATHS["ep-07"].small));
    expect(img).not.toHaveAttribute("srcset");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("width", "64");
    expect(img).toHaveAttribute("height", "64");
    expect(img).toHaveAttribute("crossorigin", "anonymous");
    once(
      "EP 07",
      "Sara",
      "Thank you for:",
      "staying with the release until it shipped",
      "Mia, Payments"
    );
    expect(container.textContent).toContain("From: Mia, Payments · 11/6/2026");
    // No back: no Kudos band, no lesson.
    expect(screen.queryByText("Kudos")).toBeNull();
    expect(screen.queryByText("The lesson")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("keeps the thumbnail 64 px square at the top of its row, whatever the words' height", () => {
    // jsdom does no layout, so this reads the classes: Tailwind emits h-auto
    // after h-16, so an h-auto here would win and let the row stretch it.
    render(<KudosCard kudos={EP7} compact />);
    const thumb = screen.getByRole("img", { name: EP7_ALT });
    expect(thumb).toHaveClass("h-16", "w-16", "shrink-0", "self-start");
    expect(thumb).not.toHaveClass("h-auto");
  });

  it("says which episode an open card reminds its sender of", () => {
    const { container } = render(<KudosCard kudos={{ ...OPEN, episode: 7 }} compact />);
    expect(screen.getByRole("heading", { name: "Thank you!" })).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    once("Reminds me of Episode 07");
    expect(screen.queryByText(/^EP \d\d$/)).toBeNull();
  });

  it("leaves Thank you for out of a reply", () => {
    render(<KudosCard kudos={{ ...OPEN, message: "Seconded!", replyTo: "kud_0" }} compact />);
    once("Seconded!");
    expect(screen.queryByText("Thank you for:")).toBeNull();
  });
});

describe("the card's interactive parts", () => {
  const reacted: Kudos = {
    ...EP7,
    reactions: [{ emoji: "🎉", byProfileId: "p-1", at: "2026-11-06T11:00:00.000Z" }],
  };
  const handlers = { onAddReaction: vi.fn(), onToggleReply: vi.fn() };

  it("shows the reply chevron and the reactions on the wall", () => {
    render(<KudosCard kudos={reacted} compact viewerProfileId="p-1" {...handlers} />);
    expect(screen.getByRole("button", { name: "Reply to this kudos" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "React with 🎉, 1 so far — you reacted" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a reaction" })).toBeInTheDocument();
  });

  it("puts a full card's reply chevron in its back band and its reactions under the faces", () => {
    const { container } = render(<KudosCard kudos={reacted} {...handlers} />);
    const chevron = screen.getByRole("button", { name: "Reply to this kudos" });
    expect(within(chevron.parentElement!).getByText("Ownership")).toBeInTheDocument();
    const faces = container.firstElementChild!.firstElementChild!;
    expect(faces.contains(screen.getByRole("button", { name: "Add a reaction" }))).toBe(false);
  });

  it("hides them all when the card is made into an image", () => {
    for (const compact of [true, false]) {
      const { unmount } = render(
        <KudosCard kudos={reacted} compact={compact} excludeInteractive {...handlers} />
      );
      expect(screen.queryByRole("button")).toBeNull();
      unmount();
    }
  });

  it("gives a reply no chevron of its own", () => {
    render(<KudosCard kudos={{ ...reacted, replyTo: "kud_0" }} compact {...handlers} />);
    expect(screen.queryByRole("button", { name: "Reply to this kudos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add a reaction" })).toBeInTheDocument();
  });
});

describe("without an address for the art", () => {
  it("draws a plain square where each panel would be", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    for (const compact of [false, true]) {
      const { container, unmount } = render(
        <KudosCard kudos={EP7} compact={compact} excludeInteractive />
      );
      expect(container.querySelector("img")).toBeNull();
      expect(screen.queryByRole("img")).toBeNull();
      expect(
        container.querySelectorAll("[aria-hidden='true'].aspect-square, [aria-hidden='true'].h-16")
      ).toHaveLength(1);
      unmount();
    }
  });
});
