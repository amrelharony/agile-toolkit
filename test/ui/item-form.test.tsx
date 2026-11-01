import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker } from "@/components/shared/scale-picker";
import type { Validation } from "@/lib/utils/form";

/**
 * Draft-then-save: nothing reaches onSave until the draft is valid, a
 * failed save names each problem and focuses the first, and fixing a
 * field clears its message as you type.
 */

interface Draft {
  title: string;
  size: number | null;
}
type Values = { title: string; size: number };

const validate = (d: Draft): Validation<Values, keyof Draft> => {
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!d.title.trim()) errors.title = "Enter a title.";
  if (d.size === null) errors.size = "Pick a size.";
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, values: { title: d.title.trim(), size: d.size as number } };
};

function Harness({ onSave, onCancel }: { onSave: (v: Values) => void; onCancel?: () => void }) {
  const form = useItemForm<Draft, Values, keyof Draft>({
    initial: { title: "", size: null },
    validate,
    onSave,
  });
  return (
    <ItemForm form={form} submitLabel="Add story" onCancel={onCancel}>
      <Field label="Title" error={form.errors.title}>
        {(p) => (
          <Input
            {...p}
            value={form.draft.title}
            onChange={(e) => form.update({ title: e.target.value })}
          />
        )}
      </Field>
      <ScalePicker
        label="Size"
        steps={[
          { value: 1, meaning: "Small" },
          { value: 3, meaning: "Large" },
        ]}
        value={form.draft.size}
        onValueChange={(size) => form.update({ size })}
        onClear={() => form.update({ size: null })}
        error={form.errors.size}
      />
    </ItemForm>
  );
}

describe("useItemForm + ItemForm", () => {
  it("shows no errors before the first save attempt", () => {
    render(<Harness onSave={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks an incomplete save, names every problem and focuses the first", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      "Enter a title.",
      "Pick a size.",
    ]);
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  it("clears a field's error as soon as it's fixed, then saves and resets", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Login  " } });
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Pick a size."]);

    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    expect(onSave).toHaveBeenCalledWith({ title: "Login", size: 3 }, expect.anything());
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves on Enter in a field", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Login" } });
    fireEvent.click(screen.getByRole("radio", { name: "1" }));
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    expect(onSave).toHaveBeenCalledWith({ title: "Login", size: 1 }, expect.anything());
  });

  it("cancels on Escape when there is a Cancel button", () => {
    const onCancel = vi.fn();
    render(<Harness onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("lets a picked scale value go back to unset with Clear", () => {
    render(<Harness onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Clear/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    expect(screen.getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Clear Size" }));
    expect(screen.getByRole("radio", { name: "3" })).toHaveAttribute("aria-checked", "false");
  });

  it("describes a scale's radio group by its error, as a Field's control", () => {
    render(<Harness onSave={vi.fn()} />);
    const size = screen.getByRole("radiogroup", { name: "Size" });
    expect(size).not.toHaveAttribute("aria-describedby");
    fireEvent.click(screen.getByRole("button", { name: "Add story" }));
    expect(size).toHaveAccessibleDescription("Pick a size.");
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    expect(size).not.toHaveAttribute("aria-describedby");
  });
});

describe("ScalePicker", () => {
  it("describes its radio group by the hint and the error, showing them as before", () => {
    const steps = [{ value: 1 }, { value: 2 }];
    const { rerender } = render(
      <ScalePicker
        label="Impact"
        steps={steps}
        value={null}
        onValueChange={vi.fn()}
        hint="1 low, 2 high"
      />
    );
    const group = screen.getByRole("radiogroup", { name: "Impact" });
    expect(group).toHaveAccessibleDescription("1 low, 2 high");
    rerender(
      <ScalePicker
        label="Impact"
        steps={steps}
        value={null}
        onValueChange={vi.fn()}
        hint="1 low, 2 high"
        error="Pick an impact."
      />
    );
    expect(group).toHaveAccessibleDescription("1 low, 2 high Pick an impact.");
    expect(screen.getByText("1 low, 2 high")).toHaveClass("text-xs", "text-sub");
    expect(screen.getByRole("alert")).toHaveTextContent("Pick an impact.");
  });
});
