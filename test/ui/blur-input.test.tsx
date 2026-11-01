import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BlurInput } from "@/components/shared/blur-fields";

/**
 * BlurInput passes a number box's keyboard, bounds and describing note
 * through to the input, and still commits only on blur or Enter.
 */
describe("BlurInput", () => {
  it("passes aria-describedby, inputMode, min, max and step to the input", () => {
    render(
      <>
        <BlurInput
          value="5"
          onCommit={() => {}}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          aria-label="Dollars"
          aria-describedby="dollars-note"
        />
        <p id="dollars-note">Capped at the amount left.</p>
      </>
    );
    const box = screen.getByRole("spinbutton", { name: "Dollars" });
    expect(box).toHaveAttribute("inputmode", "numeric");
    expect(box).toHaveAttribute("min", "0");
    expect(box).toHaveAttribute("max", "100");
    expect(box).toHaveAttribute("step", "1");
    expect(box).toHaveAccessibleDescription("Capped at the amount left.");
  });

  it("leaves them off when not given", () => {
    render(<BlurInput value="" onCommit={() => {}} aria-label="Name" />);
    const box = screen.getByRole("textbox", { name: "Name" });
    for (const attr of ["inputmode", "min", "max", "step", "aria-describedby"]) {
      expect(box).not.toHaveAttribute(attr);
    }
  });

  it("commits once on blur or Enter, never per keystroke", () => {
    const onCommit = vi.fn();
    render(<BlurInput value="5" onCommit={onCommit} type="number" aria-label="Dollars" />);
    const box = screen.getByRole("spinbutton", { name: "Dollars" });
    fireEvent.change(box, { target: { value: "1" } });
    fireEvent.change(box, { target: { value: "12" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(box);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith("12");
    box.focus();
    fireEvent.change(box, { target: { value: "20" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith("20");
  });
});
