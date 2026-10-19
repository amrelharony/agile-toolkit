import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ExampleNotice,
  LoadExampleButton,
  exampleId,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";

describe("example data helpers", () => {
  it("marks example rows by id so the user's own rows are never cleared", () => {
    expect(exampleId("r1")).toBe("example-r1");
    expect(isExampleId("example-r1")).toBe(true);
    expect(isExampleId("r1")).toBe(false);
    expect(isExampleId(undefined)).toBe(false);
    expect(hasExampleItems([{ id: "a" }, { id: exampleId(2) }])).toBe(true);
    expect(hasExampleItems([{ id: "a" }])).toBe(false);
    expect(hasExampleItems(null)).toBe(false);
  });

  it("offers loading and clearing as named buttons", () => {
    const onLoad = vi.fn();
    const onClear = vi.fn();
    render(
      <>
        <LoadExampleButton onLoad={onLoad} />
        <ExampleNotice onClear={onClear} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Example data.");
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
