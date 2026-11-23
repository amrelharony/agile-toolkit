/**
 * Bug Triage's AI task, the def: for up to 20 bugs waiting to be triaged,
 * suggest how bad each is (severity), how soon it needs fixing (priority),
 * why in a sentence, and the bug it repeats when it looks like another open
 * one. The person accepts each suggestion, which places the bug on the grid
 * through the page's store with Undo; nothing is written by the answer.
 *
 * Without AI it answers from the quick checks and the bugs' words, and the
 * near-duplicate finder (`fallbackSeverity`), which lives in
 * `bug-triage.lite.ts` with the caps and `fitSeverityInput`; pages import
 * that module. The prompt lives in `bug-triage.server.ts`. Who reported a
 * bug is never sent.
 */

import { z } from "zod";
import { defineAiTask } from "../define-task";
import { BUG_PRIORITIES, BUG_REACH, BUG_SEVERITIES } from "@/lib/stores/workspace-types";
import {
  SEVERITY_AREA_MAX,
  SEVERITY_BUGS_MAX,
  SEVERITY_DETAILS_MAX,
  SEVERITY_ID_MAX,
  SEVERITY_OPEN_MAX,
  SEVERITY_OPEN_TITLE_MAX,
  SEVERITY_REASON_MAX,
  SEVERITY_TASK_ID,
  SEVERITY_TITLE_MAX,
  fallbackSeverity,
} from "./bug-triage.lite";

export {
  SEVERITY_AREA_MAX,
  SEVERITY_BUGS_MAX,
  SEVERITY_DETAILS_MAX,
  SEVERITY_ID_MAX,
  SEVERITY_OPEN_MAX,
  SEVERITY_OPEN_TITLE_MAX,
  SEVERITY_REASON_MAX,
  SEVERITY_TASK_ID,
  SEVERITY_TITLE_MAX,
  fallbackSeverity,
  fitSeverityInput,
} from "./bug-triage.lite";

const id = z.string().trim().min(1).max(SEVERITY_ID_MAX);

const checks = z.object({
  dataLoss: z.boolean().optional(),
  security: z.boolean().optional(),
  workaround: z.boolean().optional(),
  blocksRelease: z.boolean().optional(),
  reach: z.enum(BUG_REACH).optional(),
});

const input = z.object({
  bugs: z
    .array(
      z.object({
        id,
        title: z.string().trim().min(1).max(SEVERITY_TITLE_MAX),
        /** The steps, what was expected, what happened and where, joined. */
        details: z.string().trim().max(SEVERITY_DETAILS_MAX).optional(),
        area: z.string().trim().max(SEVERITY_AREA_MAX).optional(),
        checks: checks.optional(),
      })
    )
    .min(1)
    .max(SEVERITY_BUGS_MAX),
  /** The other open bugs, for spotting duplicates. */
  open: z
    .array(z.object({ id, title: z.string().trim().min(1).max(SEVERITY_OPEN_TITLE_MAX) }))
    .max(SEVERITY_OPEN_MAX)
    .optional(),
});

const output = z.object({
  suggestions: z
    .array(
      z.object({
        id,
        severity: z.enum(BUG_SEVERITIES),
        priority: z.enum(BUG_PRIORITIES),
        reason: z.string().trim().min(1).max(SEVERITY_REASON_MAX),
        /** The bug this one repeats, by id. */
        duplicateOf: id.optional(),
      })
    )
    .max(SEVERITY_BUGS_MAX),
});

export type SeverityInput = z.infer<typeof input>;
export type SeverityOutput = z.infer<typeof output>;
export type SeveritySuggestion = SeverityOutput["suggestions"][number];

export const bugTriageSeverityTask = defineAiTask({
  id: SEVERITY_TASK_ID,
  toolId: "bug-triage",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: fallbackSeverity,
  sample: {
    bugs: [
      {
        id: "bug_a",
        title: "Payments over 1,000 fail at checkout",
        details: "What happened: the pay button spins, then an error. Where: web, all browsers",
        area: "Checkout",
        checks: { dataLoss: false, workaround: false, reach: "some" },
      },
      { id: "bug_b", title: "Typo on the delivery page", area: "Delivery" },
      { id: "bug_c", title: "Paying with a saved card fails", area: "Checkout" },
    ],
    open: [{ id: "bug_d", title: "Saved card payment fails" }],
  },
});
