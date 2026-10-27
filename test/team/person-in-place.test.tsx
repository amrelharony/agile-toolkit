/**
 * components/team/person-in-place: the shared in-place person editor
 * (promoted from the Decision Log in Phase 8 for the Risk Register's
 * owner). Enter saves, an emptied name clears, a name over `maxLength`
 * isn't saved, and the Decision Log's old path re-exports the same
 * component.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PERSON_NAME_MAX, PersonInPlace } from "@/components/team/person-in-place";
import { PersonInPlace as DecisionLogPersonInPlace } from "@/app/(tools)/decision-log/person-in-place";

function edit(label: RegExp, value: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form")!);
}

describe("PersonInPlace", () => {
  it("is the Decision Log's component, with the roster's cap by default", () => {
    expect(DecisionLogPersonInPlace).toBe(PersonInPlace);
    expect(PERSON_NAME_MAX).toBe(120);
  });

  it("saves the trimmed name; an emptied one clears it", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <PersonInPlace label="Owner" name="" offerAddToRoster={false} onSave={onSave} />
    );
    edit(/Owner: Nobody yet/, "  Ana  ");
    expect(onSave).toHaveBeenLastCalledWith("Ana");

    rerender(<PersonInPlace label="Owner" name="Ana" offerAddToRoster={false} onSave={onSave} />);
    edit(/Owner: Ana/, "");
    expect(onSave).toHaveBeenLastCalledWith("");
  });

  it("refuses a name over maxLength, saying so", () => {
    const onSave = vi.fn();
    render(
      <PersonInPlace label="Owner" name="" maxLength={5} offerAddToRoster={false} onSave={onSave} />
    );
    edit(/Owner: Nobody yet/, "Alexandra");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Keep the name to 5 characters.")).toBeInTheDocument();
  });
});
