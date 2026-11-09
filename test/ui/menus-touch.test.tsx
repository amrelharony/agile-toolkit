/**
 * Select and dropdown menus on a phone (mobile audit 2026-11-08, findings 11,
 * 48 and 75): a Select list never runs past the screen and wraps long options,
 * rows and triggers are 44 px on touch, and a dropdown keeps 8 px off the edge.
 * Desktop keeps its dense sizes, so the touch sizes ride on pointer-coarse.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Record the props DropdownMenuContent hands Radix: collision padding and
// alignment aren't visible in jsdom's DOM.
const h = vi.hoisted(() => ({
  contentProps: [] as Record<string, unknown>[],
  copyToClipboard: vi.fn(async () => true),
}));
vi.mock("@radix-ui/react-dropdown-menu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@radix-ui/react-dropdown-menu")>();
  const React = await import("react");
  const Content = React.forwardRef<
    HTMLDivElement,
    React.ComponentPropsWithoutRef<typeof actual.Content>
  >((props, ref) => {
    h.contentProps.push(props as Record<string, unknown>);
    return <actual.Content {...props} ref={ref} />;
  });
  Content.displayName = actual.Content.displayName;
  return { ...actual, Content };
});
vi.mock("@/lib/utils/export", () => ({
  exportToCSV: vi.fn(),
  exportToJSON: vi.fn(),
  exportToMarkdown: vi.fn(),
  exportToPNG: vi.fn(),
  copyToClipboard: h.copyToClipboard,
}));
vi.mock("@/lib/sonification/emit", () => ({ emitUiEvent: () => {} }));
vi.mock("@/lib/auth/use-is-owner", () => ({ useIsOwner: () => false }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/visits/visit-recorder", () => ({
  VisitRecorder: () => null,
  CountDisclosure: () => null,
}));

import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportButton, menuAlignFor } from "@/components/shared/export-button";
import { ComicsGallery } from "@/app/(tools)/comics/components/comics-gallery";
import type { StorySummary } from "@/lib/comics/types";

const SELECT_CAP =
  "max-w-[min(var(--radix-select-content-available-width,100vw),calc(100vw-1rem))]";
const lastContentProps = () => h.contentProps.at(-1) ?? {};

function classesOf(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/);
}

function tap(el: Element) {
  fireEvent.pointerDown(el, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

beforeAll(() => {
  // Radix Select leans on layout APIs jsdom doesn't have.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  h.contentProps.length = 0;
});

afterEach(cleanup);

describe("SelectTrigger", () => {
  it("is at least 44 px on touch and h-9 with a mouse", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Size">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
      </Select>
    );
    const cls = classesOf(screen.getByRole("combobox", { name: "Size" }));
    expect(cls).toContain("h-9");
    expect(cls).toContain("pointer-coarse:min-h-11");
  });

  it("keeps the touch floor when a caller shrinks it, responsive heights included", () => {
    // flow-board and tech-radar pass h-9 xs:h-7 / sm:h-7. Tailwind emits screen
    // variants after pointer-coarse, so only a min-height outlasts them.
    render(
      <Select>
        <SelectTrigger aria-label="Lane" className="h-8 xs:h-7 text-xs">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
      </Select>
    );
    const cls = classesOf(screen.getByRole("combobox", { name: "Lane" }));
    expect(cls).toEqual(expect.arrayContaining(["h-8", "xs:h-7", "pointer-coarse:min-h-11"]));
    expect(cls).not.toContain("h-9");
  });
});

describe("the comics Theme filter, with the canon's long theme names", () => {
  const story = (ep: number, themes: string[]): StorySummary => ({
    ep,
    title: `Story ${ep}`,
    lesson: "Lesson",
    castNames: ["Amr"],
    themes,
    cover: null,
    releaseAt: "2026-11-01T07:00:00.000Z",
    updatedAt: "2026-11-01T07:00:00.000Z",
  });
  const LONG = "Professional humility and a method that fits the need";

  function openThemes() {
    render(
      <ComicsGallery
        stories={[story(3, ["T11"]), story(2, ["T12"]), story(1, ["T01"])]}
        bookEpisodes={[]}
      />
    );
    tap(screen.getByRole("combobox", { name: "Theme" }));
    return screen.getByRole("listbox");
  }

  it("caps the list at the room beside the screen edges", () => {
    const listbox = openThemes();
    const cls = classesOf(listbox);
    expect(cls).toContain(SELECT_CAP);
    expect(cls).toContain("min-w-[8rem]");
  });

  it("wraps a long option instead of cutting it off, in 44 px touch rows", () => {
    const listbox = openThemes();
    const option = within(listbox).getByRole("option", { name: LONG });
    const cls = classesOf(option);
    expect(cls).toEqual(
      expect.arrayContaining([
        "break-words",
        "[&>span]:min-w-0",
        "py-1.5",
        "pointer-coarse:min-h-11",
        "pointer-coarse:py-2.5",
      ])
    );
    // The text span that [&>span]:min-w-0 reaches carries the whole label.
    const text = option.querySelector(":scope > span[id]");
    expect(text?.textContent).toBe(LONG);
    for (const row of within(listbox).getAllByRole("option")) {
      expect(classesOf(row)).toContain("pointer-coarse:min-h-11");
    }
  });

  it("still filters, and the trigger shows the chosen name on one clamped line", () => {
    const listbox = openThemes();
    fireEvent.click(within(listbox).getByRole("option", { name: LONG }));
    const trigger = screen.getByRole("combobox", { name: "Theme" });
    expect(trigger).toHaveTextContent(LONG);
    expect(classesOf(trigger)).toEqual(
      expect.arrayContaining(["whitespace-nowrap", "[&>span]:line-clamp-1"])
    );
    const weekly = screen.getByRole("region", { name: "Weekly stories" });
    expect(
      within(weekly)
        .getAllByRole("listitem")
        .map((li) => li.querySelector("h3")?.textContent)
    ).toEqual(["Story 3"]);
  });
});

describe("DropdownMenuContent", () => {
  function renderMenu(content: Partial<React.ComponentProps<typeof DropdownMenuContent>> = {}) {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent {...content}>
          <DropdownMenuItem>Copy</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Show done</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it("keeps 8 px off the screen edge by default", () => {
    renderMenu();
    expect(lastContentProps().collisionPadding).toBe(8);
    expect(lastContentProps().sideOffset).toBe(4);
  });

  it("lets a caller set its own padding", () => {
    renderMenu({ collisionPadding: 16 });
    expect(lastContentProps().collisionPadding).toBe(16);
  });

  it("keeps its width cap", () => {
    renderMenu();
    expect(classesOf(screen.getByRole("menu"))).toContain("max-w-[min(20rem,calc(100vw-1rem))]");
  });

  it("gives every row 44 px on touch and keeps py-1.5 with a mouse", () => {
    renderMenu();
    for (const row of [
      screen.getByRole("menuitem", { name: "Copy" }),
      screen.getByRole("menuitemcheckbox", { name: "Show done" }),
    ]) {
      const cls = classesOf(row);
      expect(cls).toEqual(
        expect.arrayContaining(["py-1.5", "pointer-coarse:min-h-11", "pointer-coarse:py-2.5"])
      );
      expect(cls).not.toContain("[@media(pointer:coarse)]:py-2.5");
    }
  });
});

describe("ExportButton's menu", () => {
  const realWidth = window.innerWidth;
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: realWidth, configurable: true });
  });

  function placeTrigger(left: number, width: number, viewport: number) {
    Object.defineProperty(window, "innerWidth", { value: viewport, configurable: true });
    const trigger = screen.getByRole("button", { name: /Export/ });
    trigger.getBoundingClientRect = () =>
      ({
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 32,
        height: 32,
        x: left,
        y: 0,
      }) as DOMRect;
    return trigger;
  }

  it("opens toward the middle of the screen", () => {
    // /standup at 360 px: the button wraps to the left, at x 12, 88 px wide.
    expect(menuAlignFor({ left: 12, width: 88 }, 360)).toBe("start");
    // A right-aligned action row on desktop.
    expect(menuAlignFor({ left: 1100, width: 88 }, 1280)).toBe("end");
    // A full-width button on a phone lines up either way; it keeps "end".
    expect(menuAlignFor({ left: 16, width: 328 }, 360)).toBe("end");
  });

  it("lines up with a left-hand button's start edge, and a right-hand one's end", () => {
    render(<ExportButton filename="standup" clipboardText="Done" />);

    tap(placeTrigger(12, 88, 360));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(lastContentProps().align).toBe("start");
    expect(lastContentProps().collisionPadding).toBe(8);

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    tap(placeTrigger(1100, 88, 1280));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(lastContentProps().align).toBe("end");
  });

  it("follows an align the caller sets", () => {
    render(<ExportButton filename="standup" clipboardText="Done" align="center" />);
    tap(placeTrigger(12, 88, 360));
    expect(lastContentProps().align).toBe("center");
  });

  it("still runs the item that's picked", async () => {
    render(<ExportButton filename="standup" clipboardText="Done" />);
    tap(placeTrigger(12, 88, 360));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy to Clipboard" }));
    await waitFor(() => expect(h.copyToClipboard).toHaveBeenCalledWith("Done"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
