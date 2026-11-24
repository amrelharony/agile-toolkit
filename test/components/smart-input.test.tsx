import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SmartInput } from "@/components/shared/smart-input";

/**
 * The chip under a predicted value says where the value came from in words:
 * a predictor's fallback id ("default", "default (no history …)") reads as
 * the usual start, never as a raw key; a source in words shows as it is.
 */
function chipFor(source: string) {
  render(
    <SmartInput<number>
      predicted={{ value: 3, confidence: "low", source }}
      onAccept={() => {}}
      render={({ chip }) => <>{chip}</>}
    />
  );
  return screen.getByRole("button", { name: "Suggested: 3, accept" });
}

describe("SmartInput's source line", () => {
  it("reads a fallback id as the usual start", () => {
    expect(chipFor("default")).toHaveTextContent("· usual start");
  });

  it("reads a fallback id with its reason as the usual start too", () => {
    expect(chipFor("default (no historical pages in workspace)")).toHaveTextContent(
      "· usual start"
    );
  });

  it("keeps a source already in words", () => {
    expect(chipFor("Mean across 4 prior sprints")).toHaveTextContent(
      "· Mean across 4 prior sprints"
    );
  });
});
