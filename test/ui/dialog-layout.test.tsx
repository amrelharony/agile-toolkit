import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CommandDialog, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { YourDataDialog } from "@/components/data/your-data-dialog";

beforeAll(() => {
  // cmdk measures and scrolls items; jsdom implements neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

// Guards the phone layout of the shared overlays (2026-11 mobile audit,
// findings 25, 26, 73 and 74). jsdom computes no Tailwind, so these check the
// structure and the classes the layout depends on.
function classesOf(el: Element | null): string[] {
  return (el?.getAttribute("class") ?? "").split(/\s+/);
}

describe("DialogContent", () => {
  function renderDialog(onOpenChange = vi.fn()) {
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl" bodyClassName="gap-6">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Pick a provider.</DialogDescription>
          <input aria-label="API key" />
          <DialogFooter>
            <button type="button">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const body = dialog.querySelector("[data-dialog-body]");
    return { dialog, body, onOpenChange };
  }

  it("keeps the box from scrolling and scrolls a body inside it", () => {
    const { dialog, body } = renderDialog();
    const box = classesOf(dialog);
    expect(box).toEqual(expect.arrayContaining(["flex", "flex-col", "overflow-hidden"]));
    expect(box).toContain("max-h-[calc(100dvh-2rem)]");
    expect(box).not.toContain("overflow-y-auto");
    expect(box).not.toContain("grid");

    expect(body).not.toBeNull();
    expect(classesOf(body)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto", "overscroll-contain"])
    );
  });

  it("makes the body the containing block of its out-of-flow children", () => {
    // Without `relative`, sr-only text and hidden inputs inside the body hang
    // off the fixed box: they don't scroll with the body and stretch the box
    // into a second scroller that can carry the close button away.
    const { body } = renderDialog();
    expect(classesOf(body)).toContain("relative");
  });

  it("lets a click focus the body so the keyboard can scroll it, without a Tab stop", () => {
    const { dialog, body } = renderDialog();
    expect(body).toHaveAttribute("tabindex", "-1");
    expect(classesOf(body)).toContain("outline-none");
    // Radix still focuses the first control, not the body.
    expect(within(dialog).getByLabelText("API key")).toHaveFocus();
  });

  it("gives the close button an opaque fill so scrolled content can't show through", () => {
    const { dialog } = renderDialog();
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    const cls = classesOf(close);
    expect(cls).toContain("bg-inherit");
    // Dimming the whole button would make that fill translucent: only the icon dims.
    expect(cls).not.toContain("opacity-70");
    expect(classesOf(close.querySelector("svg"))).toContain("opacity-70");
    // The hover tint layers on the fill instead of replacing it.
    expect(cls).not.toContain("hover:bg-accent/10");
    expect(cls).toEqual(
      expect.arrayContaining([
        "hover:bg-gradient-to-r",
        "hover:from-accent/10",
        "hover:to-accent/10",
      ])
    );
  });

  it("sends closeClassName to the close button", () => {
    render(
      <Dialog open>
        <DialogContent closeClassName="bg-transparent">
          <DialogTitle>Plain</DialogTitle>
          <DialogDescription>No fill.</DialogDescription>
        </DialogContent>
      </Dialog>
    );
    const close = within(screen.getByRole("dialog", { name: "Plain" })).getByRole("button", {
      name: "Close dialog",
    });
    expect(classesOf(close)).toContain("bg-transparent");
    expect(classesOf(close)).not.toContain("bg-inherit");
  });

  it("bounds the grid track so wide children can't widen the dialog", () => {
    const { body } = renderDialog();
    expect(classesOf(body)).toEqual(expect.arrayContaining(["grid", "grid-cols-[minmax(0,1fr)]"]));
  });

  it("puts the close button outside the scroll body, after it", () => {
    const { dialog, body } = renderDialog();
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    expect(body!.contains(close)).toBe(false);
    expect(close.parentElement).toBe(dialog);
    expect(body!.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Children live in the body.
    expect(body!.contains(within(dialog).getByLabelText("API key"))).toBe(true);
  });

  it("sends className to the box and bodyClassName to the body", () => {
    const { dialog, body } = renderDialog();
    expect(classesOf(dialog)).toContain("max-w-2xl");
    expect(classesOf(dialog)).not.toContain("max-w-lg");
    expect(classesOf(body)).toContain("gap-6");
    expect(classesOf(body)).not.toContain("gap-4");
  });

  it("keeps Radix focus, naming and close behaviour", () => {
    const { dialog, onOpenChange } = renderDialog();
    expect(dialog).toHaveAccessibleDescription("Pick a provider.");
    // First control in the body gets focus, not the close button.
    expect(within(dialog).getByLabelText("API key")).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("SheetContent", () => {
  it("scrolls a body inside the panel and keeps the close button out of it", () => {
    render(
      <Sheet open>
        <SheetContent className="w-full sm:max-w-md" bodyClassName="p-0">
          <SheetTitle>Tool history</SheetTitle>
          <SheetDescription>No events yet.</SheetDescription>
        </SheetContent>
      </Sheet>
    );
    const panel = screen.getByRole("dialog", { name: "Tool history" });
    const body = panel.querySelector("[data-sheet-body]");
    const close = within(panel).getByRole("button", { name: "Close panel" });

    expect(classesOf(panel)).toEqual(expect.arrayContaining(["overflow-hidden", "sm:max-w-md"]));
    expect(classesOf(panel)).not.toContain("overflow-y-auto");
    expect(classesOf(body)).toEqual(
      expect.arrayContaining(["relative", "min-h-0", "flex-1", "overflow-y-auto", "p-0"])
    );
    expect(classesOf(body)).not.toContain("p-4");
    expect(body).toHaveAttribute("tabindex", "-1");
    expect(body!.contains(close)).toBe(false);
    expect(close.parentElement).toBe(panel);
    // Above positioned content scrolling under it.
    expect(classesOf(close)).toContain("z-10");
  });
});

describe("CommandDialog", () => {
  function renderPalette() {
    render(
      <CommandDialog open onOpenChange={() => {}} title="Search tools">
        <CommandInput aria-label="Search tools" placeholder="What do you need to do?" />
        <CommandList>
          <CommandItem>Retro Board</CommandItem>
          <CommandItem>Planning Poker</CommandItem>
        </CommandList>
      </CommandDialog>
    );
    const dialog = screen.getByRole("dialog", { name: "Search tools" });
    return {
      dialog,
      body: dialog.querySelector("[data-dialog-body]"),
      root: dialog.querySelector("[cmdk-root]"),
      list: dialog.querySelector("[cmdk-list]"),
      inputWrapper: dialog.querySelector("[cmdk-input-wrapper]"),
    };
  }

  it("lays the body out as a shrinking column, not a scrolling grid", () => {
    const { body } = renderPalette();
    const cls = classesOf(body);
    expect(cls).toEqual(expect.arrayContaining(["flex", "flex-col", "overflow-hidden", "p-0"]));
    expect(cls).not.toContain("grid");
    expect(cls).not.toContain("overflow-y-auto");
    expect(cls).not.toContain("p-4");
    // Desktop keeps its padding.
    expect(cls).toContain("sm:p-6");
  });

  it("lets the Command root and list shrink below 300px", () => {
    const { root, list } = renderPalette();
    expect(classesOf(root)).toEqual(expect.arrayContaining(["min-h-0", "flex-1", "flex-col"]));
    expect(classesOf(list)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "max-h-[300px]", "overflow-y-auto"])
    );
  });

  it("pads the input row clear of the close button", () => {
    const { dialog, inputWrapper } = renderPalette();
    expect(classesOf(inputWrapper)).toEqual(
      expect.arrayContaining(["pr-12", "pointer-coarse:pr-14"])
    );
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    expect(inputWrapper!.contains(close)).toBe(false);
    expect(within(dialog).getByRole("combobox")).toHaveFocus();
  });

  it("keeps the close button see-through over the input row's own fill", () => {
    const { dialog } = renderPalette();
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    expect(classesOf(close)).toContain("bg-transparent");
    expect(classesOf(close)).not.toContain("bg-inherit");
  });

  describe("with an on-screen keyboard", () => {
    // jsdom has no visualViewport; a stand-in with the fields the hook reads.
    class FakeVisualViewport extends EventTarget {
      height = 640;
      offsetTop = 0;
    }
    let vv: FakeVisualViewport;
    beforeEach(() => {
      vv = new FakeVisualViewport();
      Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
    });
    afterEach(() => {
      Reflect.deleteProperty(window, "visualViewport");
    });

    it("centres on and caps to the visible area, following it as it changes", () => {
      const { dialog } = renderPalette();
      // No keyboard: the same as the CSS (top 50%, 100dvh - 2rem).
      expect(dialog.style.top).toBe("320px");
      expect(dialog.style.maxHeight).toBe("calc(640px - 2rem)");

      // The keyboard takes the bottom 300px and the page pans 20px.
      act(() => {
        vv.height = 340;
        vv.offsetTop = 20;
        vv.dispatchEvent(new Event("resize"));
      });
      expect(dialog.style.top).toBe("190px");
      expect(dialog.style.maxHeight).toBe("calc(340px - 2rem)");

      act(() => {
        vv.offsetTop = 0;
        vv.dispatchEvent(new Event("scroll"));
      });
      expect(dialog.style.top).toBe("170px");
    });

    it("stops listening once closed and reads afresh on reopen", () => {
      const remove = vi.spyOn(vv, "removeEventListener");
      const palette = (open: boolean) => (
        <CommandDialog open={open} onOpenChange={() => {}} title="Search tools">
          <CommandInput aria-label="Search tools" />
        </CommandDialog>
      );
      const { rerender } = render(palette(true));
      act(() => {
        vv.height = 340;
        vv.dispatchEvent(new Event("resize"));
      });
      rerender(palette(false));
      expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
      expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));

      // The keyboard went away while it was closed.
      vv.height = 640;
      rerender(palette(true));
      const dialog = screen.getByRole("dialog", { name: "Search tools" });
      expect(dialog.style.top).toBe("320px");
      expect(dialog.style.maxHeight).toBe("calc(640px - 2rem)");
    });
  });

  it("leaves placement to the CSS where there is no visualViewport", () => {
    expect(window.visualViewport).toBeFalsy();
    const { dialog } = renderPalette();
    expect(dialog.style.top).toBe("");
    expect(dialog.style.maxHeight).toBe("");
  });
});

describe("YourDataDialog", () => {
  it("ends with a Done button that closes it", () => {
    const onOpenChange = vi.fn();
    render(<YourDataDialog open onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole("dialog", { name: "Your data" });
    const body = dialog.querySelector("[data-dialog-body]")!;
    const done = within(dialog).getByRole("button", { name: "Done" });
    // In the scroll body, after every section: the last thing you reach.
    expect(body.contains(done)).toBe(true);
    const buttons = within(body as HTMLElement).getAllByRole("button");
    expect(buttons[buttons.length - 1]).toBe(done);
    fireEvent.click(done);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
