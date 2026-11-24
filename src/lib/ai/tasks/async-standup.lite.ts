/**
 * The Async Standup's AI task, the lite half pages import (no zod; the def,
 * with its schemas, is `async-standup.ts` and loads on first AI use). The
 * facts, the fitter and the no-AI summary live in lib/standup/digest-ai.
 */

import { lazyAiTask } from "../task-ref";
import {
  DIGEST_MAX,
  cleanDigestOutput,
  digestFallback,
  digestInput,
  digestWithSummary,
  fitDigestInput,
} from "@/lib/standup/digest-ai";
import type { DigestAiInput, DigestAiOutput } from "./async-standup";
export type { DigestAiInput, DigestAiOutput } from "./async-standup";

export { DIGEST_MAX, cleanDigestOutput, digestInput, digestWithSummary, fitDigestInput };

/**
 * The summary without AI: the counts, who is blocked, the oldest open
 * blocker, who hasn't posted, an ask per problem, the old blockers as risks
 * and each hand-over to the next place. An input with no updates, which
 * the schema refuses, throws: the button then asks to post first.
 */
export const asyncStandupDigestFallback = (i: DigestAiInput): DigestAiOutput => digestFallback(i);

export const asyncStandupDigestTask = lazyAiTask<DigestAiInput, DigestAiOutput>(
  {
    id: "async-standup.digest",
    toolId: "async-standup",
    fallback: asyncStandupDigestFallback,
  },
  () => import("./async-standup").then((m) => m.asyncStandupDigestTask)
);
