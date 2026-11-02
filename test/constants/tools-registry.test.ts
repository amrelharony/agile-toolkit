// @vitest-environment node
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { categories, getToolByPath, tools } from "@/lib/constants/tools";

/**
 * Invariants of the tool registry that the sidebar, command palette, home
 * grid, breadcrumb and sitemap all rely on.
 *
 * Deliberately NOT asserted: "every category has at least one tool". About
 * half the categories are placeholders for future phases, and the sidebar and
 * home grid already skip empty ones.
 */

const toolsDir = path.resolve(__dirname, "../../src/app/(tools)");

function duplicates(values: string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

describe("tool registry", () => {
  it("has unique ids, codes and paths", () => {
    expect(duplicates(tools.map((t) => t.id))).toEqual([]);
    expect(duplicates(tools.map((t) => t.code))).toEqual([]);
    expect(duplicates(tools.map((t) => t.path))).toEqual([]);
  });

  it("lists each category once, and every tool's category is listed", () => {
    expect(duplicates(categories)).toEqual([]);
    const listed = new Set(categories);
    expect(tools.filter((t) => !listed.has(t.category)).map((t) => t.id)).toEqual([]);
  });

  it("uses single-segment, lowercase paths that resolve back to the tool", () => {
    for (const tool of tools) {
      expect(tool.path, tool.id).toMatch(/^\/[a-z0-9-]+$/);
      expect(getToolByPath(tool.path)?.id).toBe(tool.id);
    }
  });

  it("has a route folder under src/app/(tools)/ for every path", () => {
    const missing = tools
      .filter((t) => !existsSync(path.join(toolsDir, t.path.slice(1), "page.tsx")))
      .map((t) => t.path);
    expect(missing).toEqual([]);
  });

  it("files the Agile at Work comic as reading material in the Library", () => {
    const comic = tools.find((t) => t.id === "comics");
    expect(comic).toMatchObject({
      category: "Library",
      kind: "reading",
      path: "/comics",
      isRealtime: false,
      usesWorkspace: false,
    });
    expect(categories[0]).toBe("Library");
  });

  it("files the printed book beside it, as reading too", () => {
    expect(tools.find((t) => t.id === "book")).toMatchObject({
      category: "Library",
      kind: "reading",
      path: "/book",
      isRealtime: false,
      usesWorkspace: false,
    });
  });
});
