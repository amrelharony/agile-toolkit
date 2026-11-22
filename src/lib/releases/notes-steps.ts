/**
 * Release Readiness's release-notes next steps, appended to its eager rule.
 * A stub while the tool is built (tools plan, phase 2): its builder fills
 * it, keeping this function and its argument (lib/tools/next-steps.ts calls
 * it). Pure: no store, no React, no "use client" module.
 */

import type { ReleaseReadiness, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";

/** What the rule reads from the workspace. */
export interface ReleaseNotesStepsInput {
  /** The Release Readiness document, when there is one. */
  doc: ReleaseReadiness | undefined;
  /** The stories a release can link (example rows left out). */
  stories: readonly Story[];
  /** YYYY-MM-DD. */
  today: string;
}

/** Release Readiness's release-notes steps. None until the tool is built. */
export function releaseNotesSteps(s: ReleaseNotesStepsInput): NextStep[] {
  void s;
  return [];
}
