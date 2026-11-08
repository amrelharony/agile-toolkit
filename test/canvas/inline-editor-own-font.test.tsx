import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineEditor } from "@/app/(tools)/canvas/components/objects/object-render-primitives";

// On touch screens globals.css forces form fields to 16px so iOS doesn't zoom
// on focus. A canvas label that is already 16px or more opts out and keeps its
// own size while it is edited; smaller text stays guarded.
describe("canvas InlineEditor font size on touch screens", () => {
  it("opts a 16px+ editor out of the 16px guard", () => {
    render(<InlineEditor initialText="Big" onCommit={() => {}} fontSize={60} />);
    const box = screen.getByRole("textbox", { name: "Edit text" });
    expect(box).toHaveAttribute("data-own-font");
    expect(box.style.fontSize).toBe("60px");
  });

  it("leaves smaller or unset sizes under the guard", () => {
    const { unmount } = render(
      <InlineEditor initialText="Frame" onCommit={() => {}} fontSize={14} />
    );
    expect(screen.getByRole("textbox", { name: "Edit text" })).not.toHaveAttribute("data-own-font");
    unmount();
    render(<InlineEditor initialText="Plain" onCommit={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Edit text" })).not.toHaveAttribute("data-own-font");
  });
});
