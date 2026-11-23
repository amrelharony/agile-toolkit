import { getSectionForTool } from "@/lib/constants/sections";
import type { ToolGuide } from "./types";

export type { ToolGuide } from "./types";

type GuideModule = { GUIDES: ToolGuide[] };

/** The guide chunks, so a tool page loads only the text for its own job. */
const CHUNKS = {
  plan: () => import("./plan"),
  ceremonies: () => import("./ceremonies"),
  prioritize: () => import("./prioritize"),
  delivery: () => import("./delivery"),
  team: () => import("./team"),
  outcomes: () => import("./outcomes"),
  quality: () => import("./quality"),
  ai: () => import("./ai"),
} satisfies Record<string, () => Promise<GuideModule>>;

/**
 * Which chunk holds each navigation section's guides. "Run the sprint" and
 * "Retrospect & improve" share the ceremonies chunk. A section missing here
 * (the Library) has no guides.
 */
const SECTION_CHUNK: Record<string, keyof typeof CHUNKS> = {
  plan: "plan",
  run: "ceremonies",
  retro: "ceremonies",
  prioritize: "prioritize",
  delivery: "delivery",
  team: "team",
  outcomes: "outcomes",
  quality: "quality",
  ai: "ai",
};

/**
 * The "How this works" guide for a tool, if it has one. Every tool in a section
 * has one except the Library's reading and the VIP tools (see
 * test/constants/guides.test.ts). Guides are loaded on demand so their text
 * never adds to a page's JavaScript up front: a tool's page gets its own guide
 * from its route layout, on the server (components/tool-frame/tool-guide.tsx),
 * and Amr loads one in the browser when he explains a tool. The 16 most-used
 * tools live in ./core; the rest in their section's chunk.
 */
export async function getGuide(toolId: string): Promise<ToolGuide | undefined> {
  const { CORE_GUIDES } = await import("./core");
  const core = CORE_GUIDES.find((g) => g.toolId === toolId);
  if (core) return core;
  const section = getSectionForTool(toolId);
  const chunk = section ? SECTION_CHUNK[section.id] : undefined;
  if (!chunk) return undefined;
  const { GUIDES } = await CHUNKS[chunk]();
  return GUIDES.find((g) => g.toolId === toolId);
}

/** Every guide, for tests and search indexing. Loads each chunk once. */
export async function getAllGuides(): Promise<ToolGuide[]> {
  const { CORE_GUIDES } = await import("./core");
  const chunks = await Promise.all(Object.values(CHUNKS).map((load) => load()));
  return [...CORE_GUIDES, ...chunks.flatMap((m) => m.GUIDES)];
}
