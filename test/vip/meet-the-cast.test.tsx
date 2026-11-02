/** Meet the Cast: cards, the name filter, links between cards, and no other art. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import { MeetTheCastClient } from "@/app/(tools)/meet-the-cast/meet-the-cast-client";
import { CAST } from "@/lib/vip/cast.generated";

afterEach(cleanup);

const filter = () => screen.getByRole("searchbox", { name: "Filter by name" });
const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("Meet the Cast", () => {
  it("shows all 30 cards with what the bible says about each", () => {
    render(<MeetTheCastClient cast={CAST} />);
    expect(headings()).toEqual(CAST.map((c) => c.name));
    expect(screen.getByText("30 colleagues")).toBeInTheDocument();
    const beaver = CAST.find((c) => c.name === "Dependable Beaver")!;
    expect(screen.getByText(beaver.human_want)).toBeInTheDocument();
    expect(screen.getByText(beaver.strength)).toBeInTheDocument();
    expect(screen.getByText(beaver.overused_strength)).toBeInTheDocument();
  });

  it("filters by name and says when nobody matches", () => {
    render(<MeetTheCastClient cast={CAST} />);
    fireEvent.change(filter(), { target: { value: "owl" } });
    expect(headings()).toEqual(["Perfectionist Owl"]);
    expect(screen.getByText("1 of 30 colleagues")).toBeInTheDocument();
    fireEvent.change(filter(), { target: { value: "nobody" } });
    expect(screen.getByText("No colleague has that name.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show everyone" }));
    expect(headings()).toHaveLength(30);
  });

  it("links a relationship to the other card, clearing a filter that hides it", () => {
    render(<MeetTheCastClient cast={CAST} />);
    fireEvent.change(filter(), { target: { value: "owl" } });
    const owlCard = screen.getByRole("heading", { name: "Perfectionist Owl" }).closest("li")!;
    const link = within(owlCard).getByRole("link", { name: "Experiment Mouse" });
    expect(link).toHaveAttribute("href", "#cast-aaw-17");
    fireEvent.click(link);
    expect(headings()).toHaveLength(30);
    expect(screen.getByRole("heading", { name: "Experiment Mouse" })).toHaveFocus();
  });

  it("links both names of a choice", () => {
    render(<MeetTheCastClient cast={CAST} />);
    const card = screen.getByRole("heading", { name: "Assurance Badger" }).closest("li")!;
    expect(within(card).getByRole("link", { name: "Automation Raccoon" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Overengineering Octopus" })).toBeInTheDocument();
  });

  it("uses no art but Amr's sprite, and no image element at all", () => {
    const { container } = render(<MeetTheCastClient cast={CAST} />);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    const sprites = Array.from(container.querySelectorAll<HTMLElement>("[style*='background']"));
    expect(sprites).toHaveLength(1);
    expect(sprites[0].style.backgroundImage).toContain("/mascot/amr.");
    expect(sprites[0].closest("li")?.textContent).toContain("Amr");
  });
});
