import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FavoriteButton } from "@/components/tool-frame/favorite-button";

beforeEach(() => {
  window.localStorage.clear();
});

describe("FavoriteButton", () => {
  it("stars and unstars the tool from its own page", () => {
    render(
      <TooltipProvider>
        <FavoriteButton toolId="retro" toolName="Retro Board" />
      </TooltipProvider>
    );
    const add = screen.getByRole("button", { name: "Add Retro Board to favorites" });
    expect(add).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(add);
    const remove = screen.getByRole("button", { name: "Remove Retro Board from favorites" });
    expect(remove).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("agile-toolkit:tool-prefs:v1")).toContain("retro");

    fireEvent.click(remove);
    expect(
      screen.getByRole("button", { name: "Add Retro Board to favorites" })
    ).toBeInTheDocument();
  });
});
