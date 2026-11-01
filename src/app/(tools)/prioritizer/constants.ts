/**
 * Backlog Prioritizer — how the MoSCoW buckets and the Value/Effort
 * quadrants are drawn. Theme tokens only: the bucket's tone comes from
 * the method registry (BucketDef.tone), never a stored or hard-coded hex.
 *
 * There is no seed and no new-item default: a new backlog starts empty
 * and offers "Load an example" (./example.ts), and "Add item" leaves every
 * method Not scored.
 */

import type { BucketTone } from "@/lib/prioritization/methods";
import { MOSCOW, VALUE_EFFORT } from "@/lib/prioritization/methods";
import { MOSCOW_LABEL } from "@/lib/prioritization/methods/moscow";
import type { MoSCoWCategory } from "./types";

/** Text, tint and border classes per tone. */
export const TONE_CLASS: Record<BucketTone, { text: string; bg: string; border: string }> = {
  success: { text: "text-success", bg: "bg-success/10", border: "border-success/30" },
  accent: { text: "text-accent", bg: "bg-accent/10", border: "border-accent/30" },
  warning: { text: "text-warning", bg: "bg-warning/10", border: "border-warning/30" },
  danger: { text: "text-danger", bg: "bg-danger/10", border: "border-danger/30" },
  muted: { text: "text-sub", bg: "bg-surface-deep", border: "border-border" },
};

const toneOf = (buckets: typeof MOSCOW.buckets, id: string): BucketTone =>
  buckets?.find((b) => b.id === id)?.tone ?? "muted";

/** The MoSCoW buckets in order, with their labels and tones. */
export const MOSCOW_CATEGORIES: readonly MoSCoWCategory[] = ["must", "should", "could", "wont"];

export const MOSCOW_CONFIG: Record<MoSCoWCategory, { label: string; tone: BucketTone }> = {
  must: { label: MOSCOW_LABEL.must, tone: toneOf(MOSCOW.buckets, "must") },
  should: { label: MOSCOW_LABEL.should, tone: toneOf(MOSCOW.buckets, "should") },
  could: { label: MOSCOW_LABEL.could, tone: toneOf(MOSCOW.buckets, "could") },
  wont: { label: MOSCOW_LABEL.wont, tone: toneOf(MOSCOW.buckets, "wont") },
};

/** A Value/Effort quadrant's tone (Quick Wins success … Time Wasters danger). */
export const quadrantTone = (id: string): BucketTone => toneOf(VALUE_EFFORT.buckets, id);
