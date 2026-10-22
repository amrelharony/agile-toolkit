import { getSectionForTool } from "@/lib/constants/sections";
import type { ToolGuide } from "./types";

export type { ToolGuide } from "./types";

type GuideModule = { GUIDES: ToolGuide[] };

/** One chunk per navigation section, so a tool page loads only its own section's text. */
const SECTION_GUIDES: Record<string, () => Promise<GuideModule>> = {
  plan: () => import("./plan"),
  ceremonies: () => import("./ceremonies"),
  prioritize: () => import("./prioritize"),
  delivery: () => import("./delivery"),
  team: () => import("./team"),
  outcomes: () => import("./outcomes"),
  quality: () => import("./quality"),
  ai: () => import("./ai"),
};

/**
 * Whether `toolId` has a guide, known without loading any guide text, so
 * the panel can render its header immediately. Every tool in a section
 * has one (see test/constants/guides.test.ts).
 */
export function hasGuide(toolId: string): boolean {
  const section = getSectionForTool(toolId);
  return Boolean(section && SECTION_GUIDES[section.id]);
}

/**
 * The "How this works" guide for a tool, if it has one. Guides are loaded on
 * demand so their text never adds to a page's JavaScript up front. The 16
 * most-used tools live in ./core; the rest in their section's chunk.
 */
export async function getGuide(toolId: string): Promise<ToolGuide | undefined> {
  const { CORE_GUIDES } = await import("./core");
  const core = CORE_GUIDES.find((g) => g.toolId === toolId);
  if (core) return core;
  const section = getSectionForTool(toolId);
  const load = section ? SECTION_GUIDES[section.id] : undefined;
  if (!load) return undefined;
  const { GUIDES } = await load();
  return GUIDES.find((g) => g.toolId === toolId);
}

/** Every guide, for tests and search indexing. Loads all chunks. */
export async function getAllGuides(): Promise<ToolGuide[]> {
  const { CORE_GUIDES } = await import("./core");
  const chunks = await Promise.all(Object.values(SECTION_GUIDES).map((load) => load()));
  return [...CORE_GUIDES, ...chunks.flatMap((m) => m.GUIDES)];
}
