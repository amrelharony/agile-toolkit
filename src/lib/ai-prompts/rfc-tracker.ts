import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface RfcSummaryData {
  title: string;
  author: string;
  status: "draft" | "in_review" | "decided" | "withdrawn";
  openedAt: string;
  decidedAt?: string;
  decision?: string;
  reviewers: string[];
  commentCount: number;
  description?: string;
}

export function generateRfcTrackerPrompts(
  data: {
    rfcs: RfcSummaryData[];
    drafts: number;
    inReview: number;
    decidedThisMonth: number;
    avgTimeToDecide: number | null;
  },
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.rfcs.length === 0) return [];
  const wsContext = workspace ? buildWorkspaceContext(workspace) : "";

  const rfcTable = formatTable(
    [
      "Title",
      "Author",
      "Status",
      "Opened",
      "Reviewers",
      "Comments",
      "Description",
    ],
    data.rfcs.slice(0, 15).map((r) => [
      r.title,
      r.author,
      r.status,
      r.openedAt,
      r.reviewers.length,
      r.commentCount,
      (r.description ?? "—").slice(0, 60),
    ])
  );

  const stale = data.rfcs.filter((r) => {
    if (r.status === "decided" || r.status === "withdrawn") return false;
    const ageDays =
      (Date.now() - new Date(r.openedAt).getTime()) / (1000 * 60 * 60 * 24);
    return ageDays > 14;
  });

  const staleTable =
    stale.length > 0
      ? formatTable(
          ["Title", "Author", "Status", "Opened"],
          stale.slice(0, 15).map((r) => [r.title, r.author, r.status, r.openedAt])
        )
      : "_No stale RFCs._";

  return [
    {
      id: "rfc-clarity",
      title: "RFC clarity check",
      description:
        "Critique active RFCs for clarity, framing, and missing trade-offs.",
      prompt:
        buildPreamble(
          "RFC Tracker",
          `${data.drafts} draft, ${data.inReview} in review, ${
            data.decidedThisMonth
          } decided this month. Avg time-to-decide ${
            data.avgTimeToDecide !== null
              ? data.avgTimeToDecide.toFixed(1) + "d"
              : "n/a"
          }.`
        ) +
        `## RFCs\n\n${rfcTable}\n\n## Questions\n\n1. Which RFC titles are vague or framed as solutions instead of problems?\n2. Are reviewers and comment counts proportionate to the scope of the change?\n3. Recommend 3 prompts each author should answer before opening the next RFC.` +
        wsContext,
    },
    {
      id: "rfc-stale",
      title: "Stale-RFC triage",
      description:
        "Identify open RFCs that have stalled and propose how to unblock each one.",
      prompt:
        buildPreamble(
          "RFC Tracker",
          "RFCs that linger in draft or review create indecision and shadow-IT workarounds."
        ) +
        `## Stale RFCs (open >14d)\n\n${staleTable}\n\n## All RFCs\n\n${rfcTable}\n\n## Questions\n\n1. For each stale RFC, suggest the most likely reason it stalled (no DRI, missing data, unclear scope, …).\n2. Recommend the next concrete action for each: split, decide-anyway, withdraw, or escalate.\n3. What policy change would prevent the next batch of RFCs from getting stuck?` +
        wsContext,
    },
  ];
}
