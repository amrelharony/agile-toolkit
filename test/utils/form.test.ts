import { describe, expect, it } from "vitest";
import {
  focusFirstInvalid,
  hasErrors,
  isBlank,
  parseNumber,
  requiredErrors,
} from "@/lib/utils/form";

describe("form helpers", () => {
  it("treats empty, whitespace, null, undefined and NaN as blank, but not 0", () => {
    expect([undefined, null, "", "   ", Number.NaN].every(isBlank)).toBe(true);
    expect([0, "0", false, "x"].some(isBlank)).toBe(false);
  });

  it("returns a message only for blank fields that have one", () => {
    expect(
      requiredErrors(
        { title: " ", owner: "", points: 0 },
        { title: "Enter a title.", points: "Enter points." }
      )
    ).toEqual({ title: "Enter a title." });
  });

  it("parses a typed number without turning a cleared field into 0", () => {
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("  ")).toBeUndefined();
    expect(parseNumber(null)).toBeUndefined();
    expect(parseNumber("4.5")).toBe(4.5);
    expect(parseNumber("0")).toBe(0);
    expect(parseNumber("abc")).toBeNaN();
  });

  it("knows when any field has an error", () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ a: undefined })).toBe(false);
    expect(hasErrors({ a: "Enter a." })).toBe(true);
  });

  it("focuses the first invalid input, or the tab stop of an invalid scale", () => {
    document.body.innerHTML = `
      <form id="f">
        <input id="ok" />
        <div data-scale-invalid="true"><button role="radio" tabindex="-1"></button><button id="stop" role="radio" tabindex="0"></button></div>
        <input id="bad" aria-invalid="true" />
      </form>`;
    focusFirstInvalid(document.getElementById("f"));
    expect(document.activeElement?.id).toBe("stop");

    document.body.innerHTML = `<form id="g"><input id="bad" aria-invalid="true" /></form>`;
    focusFirstInvalid(document.getElementById("g"));
    expect(document.activeElement?.id).toBe("bad");
    expect(() => focusFirstInvalid(null)).not.toThrow();
  });
});
