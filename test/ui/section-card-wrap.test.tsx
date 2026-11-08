import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";

/**
 * A SectionCard title keeps its own width and the actions wrap below it on a
 * narrow card: it used to shrink to "Te…" beside two buttons on a phone
 * (Capacity Planner's "Team Members"). jsdom has no layout, so these pin the
 * classes that do it.
 */

const renderCard = () =>
  render(
    <SectionCard
      title="Team Members"
      icon={Users}
      actions={
        <>
          <button type="button">AI Prompts</button>
          <button type="button">Export</button>
        </>
      }
    >
      <p>Body</p>
    </SectionCard>
  );

describe("SectionCard title beside actions", () => {
  it("sizes the title to its text, so the actions wrap instead of the title truncating", () => {
    renderCard();
    const title = screen.getByRole("heading", { name: "Team Members" });
    // flex: 1 1 auto. A 0 basis (flex-1) never let the row wrap.
    expect(title).toHaveClass("flex-auto", "min-w-0");
    expect(title).not.toHaveClass("flex-1");
    expect(title.parentElement).toHaveClass("flex", "flex-wrap");
  });

  it("keeps the actions cluster within the card once it wraps", () => {
    renderCard();
    const cluster = screen.getByRole("button", { name: "Export" }).parentElement!;
    expect(cluster).toHaveClass("max-w-full", "flex-wrap", "shrink-0");
    expect(cluster.previousElementSibling).toBe(
      screen.getByRole("heading", { name: "Team Members" })
    );
  });

  it("still truncates a title longer than the whole card, on its own line", () => {
    renderCard();
    expect(screen.getByText("Team Members")).toHaveClass("min-w-0", "truncate");
  });
});
