import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeaturedComicBanner } from "@/components/comic/featured-comic-banner";

/**
 * The home-page comic banner: one labelled region, one link to the reader,
 * and no download link (a missing PDF must never be offered as a file).
 */
describe("FeaturedComicBanner", () => {
  it("renders a labelled region with a single CTA to the reader", () => {
    const { container } = render(<FeaturedComicBanner />);

    expect(screen.getByRole("region", { name: "Agile at Work" })).toBeInTheDocument();
    expect(
      screen.getByText("A comic book about agile at work — read it free in your browser.")
    ).toBeInTheDocument();

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/agile-at-work");
    expect(links[0]).toHaveAccessibleName("Read the comic");
    expect(container.querySelector("a[download]")).toBeNull();
  });
});
