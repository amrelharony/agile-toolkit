import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DayInput } from "@/components/shared/day-input";

/**
 * A stored day edited in place: saved when the edit ends, never mid-typing;
 * a refused day stays unsaved with its reason shown; Escape puts it back.
 */

const notAfter2026 = (day: string) =>
  day === "" ? "Pick a day." : day > "2026-12-31" ? "That day is in the future." : null;

function setup(value = "2026-03-01") {
  const onCommit = vi.fn();
  const view = render(
    <DayInput label="Taken on" value={value} onCommit={onCommit} validate={notAfter2026} />
  );
  return { onCommit, day: screen.getByLabelText("Taken on") as HTMLInputElement, ...view };
}

describe("DayInput", () => {
  it("saves on blur or Enter, never on each change", () => {
    const { onCommit, day } = setup();
    fireEvent.change(day, { target: { value: "0202-05-01" } });
    fireEvent.change(day, { target: { value: "2026-05-01" } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(day);
    expect(onCommit).toHaveBeenCalledWith("2026-05-01");

    fireEvent.change(day, { target: { value: "2026-06-01" } });
    fireEvent.keyDown(day, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith("2026-06-01");
  });

  it("leaving the stored day unchanged saves nothing", () => {
    const { onCommit, day } = setup();
    fireEvent.blur(day);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps a refused day unsaved, says why, and clears the reason once fixed", () => {
    const { onCommit, day } = setup();
    fireEvent.change(day, { target: { value: "2027-01-01" } });
    fireEvent.blur(day);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("That day is in the future.");

    fireEvent.change(day, { target: { value: "2026-04-20" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(day);
    expect(onCommit).toHaveBeenCalledWith("2026-04-20");
  });

  it("an emptied field reaches validate as an empty day", () => {
    const { onCommit, day } = setup();
    fireEvent.change(day, { target: { value: "" } });
    fireEvent.blur(day);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a day.");
  });

  it("Escape puts the stored day back", () => {
    const { onCommit, day } = setup();
    fireEvent.change(day, { target: { value: "2027-01-01" } });
    fireEvent.blur(day);
    fireEvent.keyDown(day, { key: "Escape" });
    expect(day.value).toBe("2026-03-01");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a change from elsewhere replaces the draft", () => {
    const { day, rerender, onCommit } = setup();
    fireEvent.change(day, { target: { value: "2026-05-01" } });
    rerender(
      <DayInput label="Taken on" value="2026-02-02" onCommit={onCommit} validate={notAfter2026} />
    );
    expect(day.value).toBe("2026-02-02");
  });
});
