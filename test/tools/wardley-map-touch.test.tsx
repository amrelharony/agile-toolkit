import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Wardley Map's Remove buttons (a component, a link) stay 44 px on touch
 * screens of any width. They used to add `md:min-h-0 md:min-w-0`, which sorts
 * after the icon size's mouse-only reset and cleared its 44 px minimum on a
 * landscape phone or a tablet too, leaving 28 px and 24 px targets (mobile
 * audit #30). With a mouse on md+ the icon size's own `md-fine:` reset still
 * lets `md:h-7` / `md:h-6` make them as small as before.
 */

vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { WardleyMapClient } from "@/app/(tools)/wardley-map/wardley-map-client";

beforeEach(() => {
  useWorkspaceStore.setState({
    wardleyMaps: [
      {
        id: "wardleyMap:current",
        components: [
          { id: "c1", name: "User", evolution: 0.2, visibility: 0.9 },
          { id: "c2", name: "Database", evolution: 0.8, visibility: 0.2 },
        ],
        links: [{ id: "l1", fromId: "c1", toId: "c2" }],
      },
    ],
  });
});

describe("Wardley Map remove buttons on touch screens", () => {
  it.each([
    ["Remove User", "md:h-7"],
    ["Remove link User to Database", "md:h-6"],
  ])("%s keeps the 44 px minimum at every width", (name, mouseHeight) => {
    render(<WardleyMapClient />);
    const classes = screen.getByRole("button", { name }).className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["min-h-[44px]", "min-w-[44px]"]));
    // The compact size is for a mouse: the minimum is reset by md-fine: only.
    expect(classes).toEqual(
      expect.arrayContaining(["md-fine:min-h-0", "md-fine:min-w-0", mouseHeight])
    );
    expect(classes.filter((c) => /^(?:sm|md|lg|xl|2xl):min-[hw]-/.test(c))).toEqual([]);
  });
});
