import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResetButton } from "@/components/shared/reset-button";

/** A bulk reset asks first, then still offers Undo. */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));

describe("ResetButton", () => {
  it("asks first, then resets with Undo; Cancel changes nothing", () => {
    const onReset = vi.fn();
    const onUndo = vi.fn();
    render(
      <ResetButton
        title="Reset the estimation guide?"
        description="Your notes for 13 cards will be removed."
        confirmLabel="Reset guide"
        doneLabel="Reset the estimation guide"
        onReset={onReset}
        onUndo={onUndo}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("dialog", { name: "Reset the estimation guide?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset guide" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    const [label, opts] = toastSpy.mock.calls[0];
    expect(label).toBe("Reset the estimation guide");
    opts.action.onClick();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
