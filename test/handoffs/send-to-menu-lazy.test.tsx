/**
 * "Send to…" draws its trigger without the hand-off registry: the menu's
 * items (the registry, every target and the sender) load the first time a
 * menu shows them, and the menu says it is loading until they are in. Once
 * loaded, every menu opens with its items at once.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadSendToMenuItems, SendToMenu } from "@/components/handoff/send-to-menu";
import type { HandoffLink } from "@/lib/handoffs/types";

const item = { tool: "retro", id: "c1", title: "Fix the flaky deploy" };

const renderMenu = (sentTo: HandoffLink[] = []) =>
  render(
    <SendToMenu routes={["backlog-story"]} item={item} sentTo={sentTo} onLinksChange={() => {}} />
  );
const open = () =>
  fireEvent.keyDown(screen.getByRole("button", { name: "Send to… Fix the flaky deploy" }), {
    key: "Enter",
  });

describe("Send to… loads its items with the menu", () => {
  // First in the file: nothing has loaded the items yet.
  it("says it is loading, then shows the items as they arrive", async () => {
    renderMenu();
    open();
    const loading = screen.getByRole("menuitem", { name: "Loading…" });
    expect(loading).toHaveAttribute("aria-disabled", "true");
    expect(await screen.findByRole("menuitem", { name: "Backlog story" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Loading…" })).toBeNull();
  });

  it("opens with its items at once once they have loaded", async () => {
    await loadSendToMenuItems();
    renderMenu();
    open();
    expect(screen.getByRole("menuitem", { name: "Backlog story" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Loading…" })).toBeNull();
  });
});
