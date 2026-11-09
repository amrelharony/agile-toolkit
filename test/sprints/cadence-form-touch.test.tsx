import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CadenceForm } from "@/components/sprints/cadence-form";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";

/**
 * The ceremony times' weekday checkboxes (team charter, sprint start flow,
 * next-ceremony card) are 16px boxes; on touch each one's label is the
 * 44px target, and nothing changes with a mouse.
 */
describe("ceremony times weekdays", () => {
  it("wrap each checkbox in a label that is 44px tall on touch, and still toggle by it", () => {
    const onChange = vi.fn();
    render(<CadenceForm cadence={DEFAULT_CADENCE} onChange={onChange} />);
    // The fieldset and the row inside it are both named by the legend.
    const group = screen.getAllByRole("group", { name: "Daily Scrum on" }).at(-1)!;
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes).toHaveLength(7);
    for (const box of boxes) {
      const label = box.closest("label")!;
      expect(label).toHaveClass("pointer-coarse:min-h-11", "inline-flex", "items-center");
      for (const c of label.className.split(/\s+/)) {
        if (/min-[hw]-/.test(c)) expect(c).toMatch(/^pointer-coarse:/);
      }
    }
    fireEvent.click(within(group).getByText("Sat"));
    expect(onChange).toHaveBeenCalledWith({ dailyWeekdays: [1, 2, 3, 4, 5, 6] });
  });
});
