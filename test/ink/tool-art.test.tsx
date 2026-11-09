/**
 * Every tool has its own ink drawing (lib/ink/drawings/tools), handed to its
 * page by a generated route layout (scripts/generate-tool-art.mjs), so the
 * drawing reaches the browser as data and no tool page downloads the others.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { tools } from "@/lib/constants/tools";
import { getSectionForTool } from "@/lib/constants/sections";
import { SECTION_TONE } from "@/lib/ink/drawings/section-tone";
import { TOOL_ART } from "@/lib/ink/drawings/tools";
import { INK_TONES, SPOT_VIEWBOX } from "@/lib/ink/types";
import { ToolArtProvider } from "@/components/ink/tool-art-context";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";
import { drawingIds, plannedFiles, registryTools } from "../../scripts/generate-tool-art.mjs";

const ROOT = process.cwd();
const ART_DIR = path.join(ROOT, "src/lib/ink/drawings/tools");
const PATH = /^M[\d.\s,MLHVQTCSAZmlhvqtcsaz-]+$/;

/** Tools whose drawing is their existing page drawing, re-exported. */
const REUSED = new Set(
  readdirSync(ART_DIR)
    .filter(
      (f) =>
        f !== "index.ts" &&
        /export \{ \w+ as default \} from "\.\.\/pages\//.test(
          readFileSync(path.join(ART_DIR, f), "utf8")
        )
    )
    .map((f) => f.slice(0, -3))
);

describe("tool drawings", () => {
  it("reads every registry tool's id and path", () => {
    const parsed = (registryTools() as { id: string; path: string }[]).map(
      (t) => `${t.id} ${t.path}`
    );
    expect(parsed).toEqual(tools.map((t) => `${t.id} ${t.path}`));
  });

  it("gives every registry tool a drawing, and nothing else", () => {
    expect([...drawingIds()].sort()).toEqual(tools.map((t) => t.id).sort());
    expect(Object.keys(TOOL_ART).sort()).toEqual(tools.map((t) => t.id).sort());
  });

  it("keeps the drawing map and every tool's layout as the generator writes them", async () => {
    for (const { file, content } of (await plannedFiles()) as { file: string; content: string }[]) {
      expect(readFileSync(file, "utf8"), path.relative(ROOT, file)).toBe(content);
    }
  });

  it.each(tools.filter((t) => !REUSED.has(t.id)).map((t) => [t.id] as const))(
    "%s is a spot drawing in its section's wash, within budget",
    (id) => {
      const d = TOOL_ART[id];
      expect(d.name).toBe(id);
      expect(d.viewBox).toBe(SPOT_VIEWBOX);
      expect(d.strokes.length).toBeGreaterThan(0);
      expect(d.strokes.length).toBeLessThanOrEqual(24);
      const bytes = d.strokes.reduce((n, s) => n + s.d.length + (s.fillD?.length ?? 0), 0);
      expect(bytes).toBeLessThanOrEqual(2048);
      expect(d.washes).toHaveLength(1);
      expect(d.washes![0].tone).toBe(SECTION_TONE[getSectionForTool(id)!.id]);
      for (const s of d.strokes) {
        expect(s.d).toMatch(PATH);
        if (s.fillD) expect(s.fillD).toMatch(PATH);
        for (const tone of [s.tone, s.fill]) if (tone) expect(INK_TONES).toContain(tone);
      }
      expect(JSON.stringify(d)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  );

  it("never lets a client file import the whole map", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(t|j)sx?$/.test(name)) {
          const src = readFileSync(full, "utf8");
          if (/["']use client["']/.test(src) && /["']@\/lib\/ink\/drawings\/tools["']/.test(src)) {
            offenders.push(path.relative(ROOT, full));
          }
        }
      }
    };
    walk(path.join(ROOT, "src"));
    expect(offenders).toEqual([]);
    expect(readFileSync(path.join(ART_DIR, "index.ts"), "utf8")).toContain('import "server-only";');
  });

  it("keeps the section set out of ToolPageWrapper, which every tool page downloads", () => {
    const src = readFileSync(
      path.join(ROOT, "src/components/layout/tool-page-wrapper.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/drawings\/sections/);
    expect(src).not.toMatch(/SECTION_ART/);
  });
});

describe("ToolPageWrapper's art", () => {
  const page = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

  it("shows the drawing its tool's layout provides", () => {
    const { container } = page(
      <ToolArtProvider art={TOOL_ART["retro"]}>
        <ToolPageWrapper title="Retro Board" description="Run a retro" toolId="retro">
          <p>Board</p>
        </ToolPageWrapper>
      </ToolArtProvider>
    );
    expect(container.querySelector("header svg[data-ink]")?.getAttribute("data-ink")).toBe("retro");
  });

  it("lets a page's own art win, and null leave the header bare", () => {
    const own = page(
      <ToolArtProvider art={TOOL_ART["retro"]}>
        <ToolPageWrapper title="Book" description="The book" art={TOOL_ART["book"]}>
          <p>Body</p>
        </ToolPageWrapper>
      </ToolArtProvider>
    );
    expect(own.container.querySelector("header svg[data-ink]")?.getAttribute("data-ink")).toBe(
      "book"
    );
    const bare = page(
      <ToolArtProvider art={TOOL_ART["retro"]}>
        <ToolPageWrapper title="Retro Board" description="Run a retro" art={null}>
          <p>Body</p>
        </ToolPageWrapper>
      </ToolArtProvider>
    );
    expect(bare.container.querySelector("header svg[data-ink]")).toBeNull();
  });

  it("draws nothing outside a tool's route when no art is passed", () => {
    const { container } = page(
      <ToolPageWrapper title="Somewhere" description="Not a tool">
        <p>Body</p>
      </ToolPageWrapper>
    );
    expect(container.querySelector("header svg[data-ink]")).toBeNull();
  });
});
