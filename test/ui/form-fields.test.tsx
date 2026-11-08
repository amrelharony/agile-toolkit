import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Phone form fields: 16 px text and 44 px height on touch at every width.
 * The denser 14 px / 36 px is for a mouse or trackpad at md+ only
 * (`pointer-fine:md:`), because a landscape phone (812-932px) is wider than
 * md but still touch, and iOS zooms the page on a focused field under 16 px.
 */

const classes = (el: Element) => el.getAttribute("class")!.split(/\s+/);

describe("Input", () => {
  it("keeps the phone size on touch and shrinks only for fine pointers at md+", () => {
    render(<Input aria-label="Name" />);
    const c = classes(screen.getByLabelText("Name"));
    expect(c).toEqual(expect.arrayContaining(["h-11", "text-base"]));
    expect(c).toEqual(expect.arrayContaining(["pointer-fine:md:h-9", "pointer-fine:md:text-sm"]));
    expect(c).not.toContain("md:h-9");
    expect(c).not.toContain("md:text-sm");
  });

  it("lets a caller change the desktop size with the same prefix", () => {
    render(<Input aria-label="Card" className="pointer-fine:md:h-8 pointer-fine:md:text-xs" />);
    const c = classes(screen.getByLabelText("Card"));
    expect(c).toEqual(expect.arrayContaining(["pointer-fine:md:h-8", "pointer-fine:md:text-xs"]));
    expect(c).not.toContain("pointer-fine:md:h-9");
    expect(c).not.toContain("pointer-fine:md:text-sm");
    // The touch size is untouched.
    expect(c).toEqual(expect.arrayContaining(["h-11", "text-base"]));
  });
});

describe("Textarea", () => {
  it("keeps 16 px text on touch and shrinks only for fine pointers at md+", () => {
    render(<Textarea aria-label="Notes" />);
    const c = classes(screen.getByLabelText("Notes"));
    expect(c).toContain("text-base");
    expect(c).toContain("pointer-fine:md:text-sm");
    expect(c).not.toContain("md:text-sm");
  });

  it("lets a caller change the desktop size with the same prefix", () => {
    render(<Textarea aria-label="Description" className="text-xs pointer-fine:md:text-xs" />);
    const c = classes(screen.getByLabelText("Description"));
    expect(c).toEqual(expect.arrayContaining(["text-xs", "pointer-fine:md:text-xs"]));
    expect(c).not.toContain("pointer-fine:md:text-sm");
    expect(c).not.toContain("text-base");
  });
});
