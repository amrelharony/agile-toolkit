import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { KudosHowTo } from "@/app/(tools)/kudos/components/kudos-how-to";
import { printTheme } from "@/lib/comics/print-themes";

/**
 * "How kudos cards work" on /kudos: the printed Scrum Master guide's words,
 * word for word, and its four colours as a real table filled like the print.
 */

const INTRO = "Saw someone do something the book talks about? Say thank you.";
const STEPS = [
  "Pick the card that matches what they did. The colour shows the theme. If nothing matches, use a “Thank you!” or “Great teamwork!” card.",
  "On the back, write who it is for and exactly what they did. One sentence is enough, for example: “You told the customer about the delay on Monday, not on Friday.”",
  "Sign it, then give it in person or pin it on the kudos wall.",
];
const OWNER_ONLINE = "Online, Send kudos pins it on your squad's wall.";
const VISITOR_ONLINE = "Online, Send kudos gives you a link and an image to pass on.";
const TIPS = [
  "Keep a stack at every retro and next to the kudos wall.",
  "Anyone can give a card to anyone, including their manager.",
  "Thank what the person did, not who they are. “You asked what could wait” means more than “You’re great.”",
  "In each retro, take five minutes to read out the week’s kudos.",
  "Don’t count or rank kudos. They are thanks, not a scoreboard, and they never feed into performance reviews.",
  "Restock the cards your team gives most.",
];
const COLOURS = [
  ["Teal", "Focus", "Choosing priorities, leaving room, finishing before starting"],
  ["Coral", "Ownership", "Seeing work through, fixing causes, owning mistakes"],
  ["Blue", "Real needs", "Testing with real people and checking that the work helped"],
  ["Mustard", "Trust", "Sharing decisions, asking why, letting others decide, speaking up"],
] as const;
const BOOK =
  "Every card names an episode. The book is the full story. Borrow it from your Scrum Master.";
const PRIVACY = "First names and general thanks only. No customer names or internal details.";

/** jsdom reads a hex colour back as rgb(). */
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe("How kudos cards work", () => {
  it("has every line of the guide, in its sections", () => {
    render(<KudosHowTo isOwner />);
    expect(screen.getByRole("heading", { name: "How kudos cards work" })).toBeInTheDocument();
    for (const line of [INTRO, ...STEPS, OWNER_ONLINE, ...TIPS, BOOK, PRIVACY]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    expect(screen.queryByText(VISITOR_ONLINE)).toBeNull();

    const give = screen.getByRole("heading", { name: "How to give one" });
    const steps = give.parentElement!.querySelector("ol")!;
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(STEPS);

    const sm = screen.getByRole("heading", { name: "For Scrum Masters" });
    const tips = sm.parentElement!.querySelector("ul")!;
    expect(
      within(tips)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(TIPS);
  });

  it("tells a visitor what Send kudos does for them", () => {
    render(<KudosHowTo isOwner={false} />);
    expect(screen.getByText(VISITOR_ONLINE)).toBeInTheDocument();
    expect(screen.queryByText(OWNER_ONLINE)).toBeNull();
  });

  it("puts the four colours in a real table, each row in its habit's colour and ink", () => {
    render(<KudosHowTo isOwner />);
    // A labelled, focusable box, so the table can scroll sideways on a phone.
    const region = screen.getByRole("region", { name: "The four colours" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
    const table = within(region).getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent)
    ).toEqual(["Colour", "Theme", "What it thanks"]);
    const body = table.querySelector("tbody")!;
    const rows = within(body).getAllByRole("row");
    expect(rows).toHaveLength(4);
    rows.forEach((row, i) => {
      const [colour, habit, thanks] = COLOURS[i];
      const cells = Array.from(row.children) as HTMLElement[];
      expect(cells.map((c) => c.textContent)).toEqual([colour, habit, thanks]);
      expect(within(row).getByRole("rowheader")).toHaveTextContent(colour);
      const print = printTheme(habit);
      for (const cell of cells) {
        expect(cell.style.backgroundColor).toBe(rgb(print.colour));
        expect(cell.style.color).toBe(rgb(print.ink));
      }
    });
  });
});
