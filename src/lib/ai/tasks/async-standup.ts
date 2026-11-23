/**
 * The Async Standup's AI task, the def: a short summary of one day's
 * written updates (a headline, a paragraph, who to ask for what, the risks
 * and the hand-overs between places). It gets the posters' names, their
 * updates and blockers (the page says so beside the button), and nothing
 * is saved from it: the page shows it and can copy it into the digest.
 * Without AI the page's own rules answer (lib/standup/digest-ai, through
 * `async-standup.lite.ts`, which pages import). The prompt is in
 * `async-standup.server.ts`.
 */

import { z } from "zod";
import { STANDUP_FORMATS } from "@/lib/stores/workspace-types";
import { DIGEST_MAX } from "@/lib/standup/digest-ai";
import { defineAiTask } from "../define-task";
import { asyncStandupDigestFallback } from "./async-standup.lite";

const M = DIGEST_MAX;
const name = z.string().trim().min(1).max(M.member);

const input = z.object({
  date: z
    .string()
    .max(10)
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z
    .array(
      z.object({
        member: name,
        format: z.enum(STANDUP_FORMATS),
        site: z.string().trim().min(1).max(M.site).optional(),
        done: z.string().max(M.field),
        next: z.string().max(M.field),
        problem: z.string().max(M.field),
        dri: z.string().trim().min(1).max(M.dri).optional(),
        handoff: z.string().max(M.handoff).optional(),
        notes: z.string().max(M.notes).optional(),
      })
    )
    .min(1)
    .max(M.entries),
  notPosted: z.array(name).max(M.notPosted),
  olderBlockers: z
    .array(
      z.object({
        member: name,
        text: z.string().trim().min(1).max(M.olderText),
        ageDays: z.number().int().min(1).max(M.ageDays),
        dri: z.string().trim().min(1).max(M.dri).optional(),
      })
    )
    .max(M.olderBlockers),
  shifts: z.array(z.string().trim().min(1).max(M.site)).max(M.shifts),
});

const output = z.object({
  headline: z.string().trim().min(1).max(M.headline),
  summary: z.string().trim().max(M.summary),
  asks: z
    .array(
      z.object({
        who: z.string().trim().min(1).max(M.member),
        text: z.string().trim().min(1).max(M.askText),
      })
    )
    .max(M.asks),
  risks: z.array(z.string().trim().min(1).max(M.risk)).max(M.risks),
  handoffs: z
    .array(
      z.object({
        from: z.string().trim().min(1).max(M.site),
        to: z.string().trim().min(1).max(M.site),
        text: z.string().trim().min(1).max(M.handoffText),
      })
    )
    .max(M.handoffs),
});

export type DigestAiInput = z.infer<typeof input>;
export type DigestAiOutput = z.infer<typeof output>;

export const asyncStandupDigestTask = defineAiTask({
  id: "async-standup.digest",
  toolId: "async-standup",
  tier: "flash",
  effort: "low",
  maxTokens: 4096,
  input,
  output,
  fallback: asyncStandupDigestFallback,
  sample: {
    date: "2026-11-17",
    entries: [
      {
        member: "Lee (iOS)",
        format: "ppp",
        site: "Sydney",
        done: "Wallet button wired to the sandbox.",
        next: "Test the saved card picker.",
        problem: "Still waiting on sandbox keys from the payments team.",
        dri: "Priya (PM)",
        handoff: "The picker build is on staging; please run the retry case.",
      },
      {
        member: "Ana (Backend)",
        format: "classic",
        site: "Cairo",
        done: "Found the double charge.",
        next: "Ship the retry fix to staging.",
        problem: "",
      },
    ],
    notPosted: ["Sam (QA)"],
    olderBlockers: [
      { member: "Ana (Backend)", text: "The index migration needs a DBA review.", ageDays: 4 },
    ],
    shifts: ["Sydney", "Cairo", "London office", "Toronto"],
  },
});
