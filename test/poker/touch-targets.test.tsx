import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StoryQueueItem } from "@/app/(tools)/planning-poker/story-queue-item";
import { AcceptEstimate } from "@/app/(tools)/planning-poker/accept-estimate";
import { AddStoryForm } from "@/app/(tools)/planning-poker/add-story-form";
import type { Story } from "@/app/(tools)/planning-poker/types";

/**
 * Planning Poker's small controls are 44px tap targets on a touch screen of
 * any width (phone, landscape phone, tablet) and keep their dense size for a
 * mouse. jsdom has no layout, so these check the classes that decide it:
 * a `pointer-coarse:` minimum, repeated at `md:` wherever an `md:` reset
 * (the icon size's `md:min-h-0`) would otherwise win, because `md:` rules
 * come later in the stylesheet than `pointer-coarse:` ones.
 */

const noop = () => {};

function expectTouchTarget(el: Element, axes: readonly ("h" | "w")[] = ["h", "w"]) {
  const classes = Array.from(el.classList);
  for (const axis of axes) {
    expect(classes, el.className).toContain(`pointer-coarse:min-${axis}-11`);
    if (classes.some((c) => c.startsWith(`md:min-${axis}-`))) {
      expect(classes, el.className).toContain(`md:pointer-coarse:min-${axis}-11`);
    }
  }
}

const story: Story = { id: "s1", title: "Login page", finalEstimate: null };

describe("story queue item", () => {
  it("gives the host's Edit and Delete a 44px tap area on touch, 28px for a mouse", () => {
    render(
      <StoryQueueItem story={story} current isHost onSelect={noop} onEdit={noop} onDelete={noop} />
    );
    for (const name of ["Edit Login page", "Delete Login page"]) {
      const button = screen.getByRole("button", { name });
      expectTouchTarget(button);
      // The desktop density is untouched.
      expect(button).toHaveClass("h-7", "w-7", "md:h-7", "md:w-7");
    }
    // The 44px buttons fill the row on touch instead of padding it taller.
    const actions = screen.getByRole("button", { name: "Edit Login page" }).parentElement!;
    expect(actions).toHaveClass("py-1", "pointer-coarse:py-0");
  });

  it("shows no Edit or Delete to a guest", () => {
    render(
      <StoryQueueItem
        story={story}
        current={false}
        isHost={false}
        onSelect={noop}
        onEdit={noop}
        onDelete={noop}
      />
    );
    expect(screen.queryByRole("button", { name: /^(Edit|Delete) / })).toBeNull();
  });
});

describe("accept estimate", () => {
  it("keeps the compact chips for a mouse and makes each card 44px on touch", () => {
    render(
      <AcceptEstimate
        deck={["1", "2", "3", "5", "8", "13", "21", "?"]}
        suggested="8"
        onAccept={noop}
      />
    );
    const group = screen.getByRole("radiogroup", { name: "Estimate to accept" });
    expect(group).toHaveClass(
      "pointer-coarse:[&>button]:min-h-11",
      "pointer-coarse:[&>button]:min-w-11",
      "pointer-coarse:[&>button]:text-sm"
    );
    // The child selector reaches every card: they are the group's own children.
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["1", "2", "3", "5", "8", "13", "21"]);
    for (const radio of radios) {
      expect(radio.parentElement).toBe(group);
      // The sm size still decides the desktop look.
      expect(radio).toHaveClass("min-h-8", "text-xs");
    }

    expectTouchTarget(screen.getByRole("button", { name: "Accept 8" }), ["h"]);
  });
});

describe("add story form", () => {
  it("makes the title field and Add story 44px on touch, 36px for a mouse", () => {
    render(<AddStoryForm storyCount={0} onAdd={noop} onPaste={noop} />);
    const title = screen.getByRole("textbox", { name: "New story title" });
    expectTouchTarget(title, ["h"]);
    expect(title).toHaveClass("h-9");
    expectTouchTarget(screen.getByRole("button", { name: "Add story" }), ["h"]);
  });
});
