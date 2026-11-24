/**
 * The CRUD schema of a sectioned document's `sections` (lib/sectioned):
 * Kickoff's and Product Canvas's items, keyed by their format's section ids.
 *
 * Zod lives here, with the CRUD, so the kit itself stays zod-free. Imported
 * only by the two CRUD entries in ./index.ts. The keys follow the kit's
 * section id rule; SECTION_KEY_PATTERN is declared here so the CRUD never
 * waits on the kit, and a test keeps it equal to lib/sectioned's
 * SECTION_ID_PATTERN.
 */

import { z } from "zod";
import {
  HANDOFF_ROUTE_IDS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type SectionItem,
} from "@/lib/stores/workspace-types";

/** A section id: a lowercase letter, then up to 31 lowercase letters, digits or hyphens. */
export const SECTION_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

// Mirrors the hand-off link schema of ./index.ts (workspace-types HandoffLink).
const HandoffLinkSchema = z.object({
  route: z.enum(HANDOFF_ROUTE_IDS),
  targetId: z.string(),
  at: z.string(),
});

/**
 * The schema of a document's sections: at most `sectionsMax` keys, each a
 * section id, each holding at most `perSectionMax` items, and at most
 * `totalMax` items over all of them when given. Each item is
 * `{id, text, owner?, sentTo?}` plus the tool's own `itemExtra` fields; its
 * text is capped at `itemMax`, its owner at TOOL_TEXT_MAX.short.
 */
export function sectionsSchema<E extends z.ZodRawShape = Record<never, never>>(opts: {
  itemMax: number;
  itemExtra?: E;
  /** Default TOOL_LIST_MAX.sections. */
  sectionsMax?: number;
  /** Default TOOL_LIST_MAX.sectionItems. */
  perSectionMax?: number;
  /** An optional cap over all sections together (Product Canvas: canvasItems). */
  totalMax?: number;
}): z.ZodType<Record<string, Array<SectionItem & z.infer<z.ZodObject<E>>>>> {
  const sectionsMax = opts.sectionsMax ?? TOOL_LIST_MAX.sections;
  const perSectionMax = opts.perSectionMax ?? TOOL_LIST_MAX.sectionItems;
  const { totalMax } = opts;
  const item = z.object({
    id: z.string().min(1).max(64),
    text: z.string().max(opts.itemMax),
    owner: z.string().max(TOOL_TEXT_MAX.short).optional(),
    sentTo: z.array(HandoffLinkSchema).optional(),
    ...(opts.itemExtra ?? ({} as E)),
  });
  const schema = z
    .record(
      z.string().regex(SECTION_KEY_PATTERN, "a section id, such as goal or risks"),
      z.array(item).max(perSectionMax)
    )
    .refine((sections) => Object.keys(sections).length <= sectionsMax, {
      message: `at most ${sectionsMax} sections`,
    })
    .refine(
      (sections) =>
        totalMax === undefined ||
        Object.values(sections).reduce((n, items) => n + items.length, 0) <= totalMax,
      { message: `at most ${totalMax} items in all` }
    );
  return schema as unknown as z.ZodType<
    Record<string, Array<SectionItem & z.infer<z.ZodObject<E>>>>
  >;
}
