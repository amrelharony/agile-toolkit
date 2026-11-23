import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The shared tabs on touch screens (P2.0c): the list was `h-9` and a trigger
 * `py-1`, about 24-28 px tall on a phone. On a coarse pointer each trigger
 * gets the 44 px floor and the list grows to fit it; a mouse keeps the
 * compact bar. A call site's own height (`h-10`, `h-auto`) still merges.
 */

function renderTabs(listClass?: string, triggerClass?: string) {
  return render(
    <Tabs defaultValue="a">
      <TabsList className={listClass}>
        <TabsTrigger value="a" className={triggerClass}>
          First
        </TabsTrigger>
        <TabsTrigger value="b">Second</TabsTrigger>
      </TabsList>
      <TabsContent value="a">One</TabsContent>
      <TabsContent value="b">Two</TabsContent>
    </Tabs>
  );
}

const classesOf = (el: HTMLElement) => Array.from(el.classList);

describe("shared tabs on touch screens", () => {
  it("gives every trigger a 44 px floor on a coarse pointer only", () => {
    renderTabs();
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveClass("pointer-coarse:min-h-11");
      // No plain min-height: a mouse keeps the compact bar.
      expect(classesOf(tab).filter((c) => /^min-h-/.test(c))).toEqual([]);
    }
  });

  it("lets the list grow to fit the triggers on a coarse pointer, keeping h-9 for a mouse", () => {
    renderTabs();
    const list = screen.getByRole("tablist");
    expect(list).toHaveClass("h-9", "pointer-coarse:h-auto");
  });

  it("keeps a call site's own list height beside the touch growth", () => {
    renderTabs("h-10 border");
    const list = screen.getByRole("tablist");
    expect(list).toHaveClass("h-10", "pointer-coarse:h-auto");
    expect(list).not.toHaveClass("h-9");
  });

  it("keeps the touch growth when a call site already sets h-auto", () => {
    renderTabs("h-auto flex-wrap");
    expect(screen.getByRole("tablist")).toHaveClass("h-auto", "pointer-coarse:h-auto");
  });

  it("holds the floor once when a call site repeats it", () => {
    renderTabs(undefined, "gap-2 pointer-coarse:min-h-11");
    const first = screen.getByRole("tab", { name: "First" });
    expect(classesOf(first).filter((c) => c === "pointer-coarse:min-h-11")).toHaveLength(1);
  });
});
