"use client";

import { useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  FileText,
  MessageSquare,
  ArrowRight,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { RFC_TRACKER_ACTIONS } from "@/lib/history/event-actions";
import { generateRfcTrackerPrompts } from "@/lib/ai-prompts/rfc-tracker";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { toast } from "@/lib/utils/toast";
import { decisionLabel } from "@/lib/decisions/model";
import { pushRfcDecision } from "./push-decision";

type RfcStatus = "draft" | "in_review" | "decided" | "withdrawn";

interface Comment {
  id: string;
  author: string;
  ts: string;
  text: string;
}

interface Rfc {
  id: string;
  title: string;
  author: string;
  status: RfcStatus;
  openedAt: string;
  decidedAt?: string;
  decision?: string;
  reviewers: string[];
  comments: Comment[];
  description?: string;
}

const STATUS_LABEL: Record<RfcStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  decided: "Decided",
  withdrawn: "Withdrawn",
};

function daysSince(iso: string): number {
  // BUG-T7-rfc-tracker-4: anchor both sides on LOCAL midnight so a PDT
  // user opening an RFC at 23:30 doesn't see "day 1" 30 minutes later
  // when UTC-parsed midnight (May 24) is 17 local-hours past local
  // creation time (May 23 23:30).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 0;
  const opened = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.floor((today - opened) / (1000 * 60 * 60 * 24)));
}

export function RfcTrackerClient() {
  const [rfcs, setRfcs] = usePersisted<Rfc[]>("agile-toolkit:rfc-tracker", []);
  const { log } = useHistoryLogger("rfc-tracker");
  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  const [newTitle, setNewTitle] = useState("");
  const [newAuthor, setNewAuthor] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Per-RFC reviewer-add and comment-add transient input state.
  const [reviewerInputs, setReviewerInputs] = useState<Record<string, string>>({});
  const [commentInputs, setCommentInputs] = useState<
    Record<string, { author: string; text: string }>
  >({});

  const addRfc = () => {
    const title = newTitle.trim();
    const author = newAuthor.trim();
    if (!title || !author) return;
    const description = newDescription.trim() || undefined;
    const rfc: Rfc = {
      id: crypto.randomUUID(),
      title,
      author,
      status: "draft",
      openedAt: todayLocalISO(),
      reviewers: [],
      comments: [],
      description,
    };
    setRfcs((prev) => [rfc, ...prev]);
    log(RFC_TRACKER_ACTIONS.RFC_ADDED, {
      rfcId: rfc.id,
      title,
      author,
    });
    setNewTitle("");
    setNewAuthor("");
    setNewDescription("");
  };

  const removeRfc = (id: string) => {
    const rfc = rfcs.find((r) => r.id === id);
    setRfcs((prev) => prev.filter((r) => r.id !== id));
    log(RFC_TRACKER_ACTIONS.RFC_REMOVED, { rfcId: id, title: rfc?.title });
  };

  const setStatus = (id: string, status: RfcStatus) => {
    // BUG-T7-rfc-tracker-1: compute the decision BEFORE dispatching the
    // setState. The prior pattern assigned `logged = true` inside the
    // updater and read it synchronously after — React 18 does not
    // guarantee eager invocation of updaters, so `RFC_DECIDED` would
    // intermittently never fire.
    const prev = rfcs.find((r) => r.id === id);
    const isFirstDecide = status === "decided" && !!prev && !prev.decidedAt;
    setRfcs((arr) =>
      arr.map((r) => {
        if (r.id !== id) return r;
        const next: Rfc = { ...r, status };
        // R-STATUS-PRESERVE: stamp decidedAt on first transition to "decided",
        // but never clear it on transition out — preserves the historical
        // record (e.g. if a decided RFC is re-opened to "in_review").
        if (status === "decided" && !r.decidedAt) {
          next.decidedAt = todayLocalISO();
        }
        return next;
      })
    );
    if (isFirstDecide) {
      log(RFC_TRACKER_ACTIONS.RFC_DECIDED, { rfcId: id });
    } else {
      log(RFC_TRACKER_ACTIONS.RFC_UPDATED, { rfcId: id, fields: ["status"] });
    }
  };

  const setDecision = (id: string, decision: string) => {
    const trimmed = decision.trim() || undefined;
    setRfcs((prev) => prev.map((r) => (r.id === id ? { ...r, decision: trimmed } : r)));
  };

  const addReviewer = (id: string) => {
    const name = (reviewerInputs[id] ?? "").trim();
    if (!name) return;
    setRfcs((prev) =>
      prev.map((r) =>
        r.id === id
          ? r.reviewers.some((x) => x.toLowerCase() === name.toLowerCase())
            ? r
            : { ...r, reviewers: [...r.reviewers, name] }
          : r
      )
    );
    setReviewerInputs((prev) => ({ ...prev, [id]: "" }));
    log(RFC_TRACKER_ACTIONS.RFC_UPDATED, { rfcId: id, fields: ["reviewers"] });
  };

  const removeReviewer = (id: string, name: string) => {
    setRfcs((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, reviewers: r.reviewers.filter((n) => n !== name) } : r
      )
    );
    log(RFC_TRACKER_ACTIONS.RFC_UPDATED, { rfcId: id, fields: ["reviewers"] });
  };

  const addComment = (id: string) => {
    const draft = commentInputs[id] ?? { author: "", text: "" };
    const author = draft.author.trim();
    const text = draft.text.trim();
    if (!author || !text) return;
    const comment: Comment = {
      id: crypto.randomUUID(),
      author,
      ts: new Date().toISOString(),
      text,
    };
    setRfcs((prev) =>
      prev.map((r) => (r.id === id ? { ...r, comments: [...r.comments, comment] } : r))
    );
    setCommentInputs((prev) => ({
      ...prev,
      [id]: { author: "", text: "" },
    }));
    log(RFC_TRACKER_ACTIONS.RFC_UPDATED, { rfcId: id, fields: ["comments"] });
  };

  // A decided RFC becomes an accepted decision record (./push-decision).
  const pushToDecisionLog = (rfc: Rfc) => {
    if (rfc.status !== "decided") return;
    const result = pushRfcDecision(rfc);
    if (result.ok) {
      toast.success(`Pushed to the Decision Log as ${decisionLabel(result.decision)}`);
    } else if (result.reason === "already-pushed") {
      toast.error(`This RFC is in the Decision Log already, as ${decisionLabel(result.existing)}.`);
    } else {
      toast.error("A decision with this title already exists in the log.");
    }
  };

  const counts = useMemo(() => {
    const c: Record<RfcStatus, number> = {
      draft: 0,
      in_review: 0,
      decided: 0,
      withdrawn: 0,
    };
    for (const r of rfcs) c[r.status] += 1;
    return c;
  }, [rfcs]);

  const decidedThisMonth = useMemo(() => {
    // BUG-T7-rfc-tracker-3: substring-compare on local "yyyy-mm" instead
    // of `new Date(...).getMonth()`. r.decidedAt is local "yyyy-mm-dd"
    // (from todayLocalISO), but `new Date("2026-05-01")` is UTC midnight
    // — for users west of UTC that's local April 30, mis-bucketing every
    // first-of-month decision.
    const todayPrefix = todayLocalISO().slice(0, 7); // "yyyy-mm"
    return rfcs.filter((r) => r.decidedAt?.slice(0, 7) === todayPrefix).length;
  }, [rfcs]);

  const avgTimeToDecide = useMemo(() => {
    const times: number[] = [];
    for (const r of rfcs) {
      if (r.decidedAt) {
        const d =
          (new Date(r.decidedAt).getTime() - new Date(r.openedAt).getTime()) /
          (1000 * 60 * 60 * 24);
        if (d >= 0) times.push(d);
      }
    }
    if (times.length === 0) return null;
    return times.reduce((a, b) => a + b, 0) / times.length;
  }, [rfcs]);

  const promptConfig = useMemo(
    () => ({
      toolName: "RFC Tracker",
      prompts: generateRfcTrackerPrompts(
        {
          rfcs: rfcs.map((r) => ({
            title: r.title,
            author: r.author,
            status: r.status,
            openedAt: r.openedAt,
            decidedAt: r.decidedAt,
            decision: r.decision,
            reviewers: r.reviewers,
            commentCount: r.comments.length,
            description: r.description,
          })),
          drafts: counts.draft,
          inReview: counts.in_review,
          decidedThisMonth,
          avgTimeToDecide,
        },
        workspace
      ),
    }),
    [rfcs, counts, decidedThisMonth, avgTimeToDecide, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="rfc-tracker"
      title="RFC Tracker"
      description="Pre-decision pipeline (draft → review → decided) that feeds the decision log."
      category="Risk & Governance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="rfc-tracker"
          csvData={{
            headers: [
              "Title",
              "Author",
              "Status",
              "Opened",
              "Decided",
              "Reviewers",
              "Comments",
              "Decision",
              "Description",
            ],
            rows: rfcs.map((r) => [
              r.title,
              r.author,
              r.status,
              r.openedAt,
              r.decidedAt ?? "",
              r.reviewers.join("; "),
              r.comments.length,
              (r.decision ?? "").replace(/\n/g, " "),
              (r.description ?? "").replace(/\n/g, " "),
            ]),
          }}
          jsonData={rfcs}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard variant="compact" icon={FileText} label="Drafts" value={counts.draft} />
        <StatCard
          variant="compact"
          icon={MessageSquare}
          label="In review"
          value={counts.in_review}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="Decided this month"
          value={decidedThisMonth}
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Avg time-to-decide"
          value={avgTimeToDecide !== null ? `${avgTimeToDecide.toFixed(1)}d` : "—"}
        />
      </KpiGrid>

      {/* New RFC form */}
      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2">
            <div>
              <Label htmlFor="rfc-new-title" className="text-xs text-sub">
                Title
              </Label>
              <Input
                id="rfc-new-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="RFC-0001: Replace polling with SSE"
                className="bg-bg border-border"
                aria-label="RFC title"
              />
            </div>
            <div>
              <Label htmlFor="rfc-new-author" className="text-xs text-sub">
                Author
              </Label>
              <Input
                id="rfc-new-author"
                value={newAuthor}
                onChange={(e) => setNewAuthor(e.target.value)}
                placeholder="Jane Doe"
                className="bg-bg border-border"
                aria-label="RFC author"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={addRfc}
                className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
              >
                <Plus className="w-4 h-4" />
                New RFC
              </Button>
            </div>
          </div>
          <Textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description / problem statement (optional)..."
            rows={2}
            className="bg-bg border-border resize-none text-xs"
            aria-label="Description"
          />
        </CardContent>
      </Card>

      {rfcs.length === 0 ? (
        <EmptyState icon={FileText}>
          No RFCs yet. Open your first one above to start the discussion.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rfcs.map((r) => {
            const ageDays = daysSince(r.openedAt);
            const reviewerInput = reviewerInputs[r.id] ?? "";
            const commentDraft = commentInputs[r.id] ?? { author: "", text: "" };
            return (
              <Card key={r.id} className="bg-surface border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-text break-words">{r.title}</div>
                      <div className="text-xs text-sub mt-0.5">
                        by {r.author} · opened {r.openedAt} · day {ageDays}
                        {r.decidedAt && ` · decided ${r.decidedAt}`}
                      </div>
                      {r.description && (
                        <div className="text-xs text-sub mt-1 whitespace-pre-wrap">
                          {r.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={r.status}
                        onValueChange={(v) => setStatus(r.id, v as RfcStatus)}
                      >
                        <SelectTrigger
                          className="bg-bg border-border h-8 text-xs w-32"
                          aria-label={`Status for ${r.title}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["draft", "in_review", "decided", "withdrawn"] as RfcStatus[]).map(
                            (s) => (
                              <SelectItem key={s} value={s} className="text-xs">
                                {STATUS_LABEL[s]}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRfc(r.id)}
                        className="text-sub hover:text-danger min-touch-coarse"
                        aria-label={`Remove ${r.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Reviewers */}
                  <div>
                    <Label htmlFor={`rfc-${r.id}-reviewer`} className="text-xs text-sub mb-1">
                      Reviewers
                    </Label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {r.reviewers.length === 0 && (
                        <span className="text-xs text-sub italic">None yet</span>
                      )}
                      {r.reviewers.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-text"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => removeReviewer(r.id, name)}
                            className="text-sub hover:text-danger min-touch-coarse inline-flex items-center justify-center"
                            aria-label={`Remove ${name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        id={`rfc-${r.id}-reviewer`}
                        value={reviewerInput}
                        onChange={(e) =>
                          setReviewerInputs((prev) => ({
                            ...prev,
                            [r.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addReviewer(r.id);
                        }}
                        placeholder="Add reviewer name..."
                        className="bg-bg border-border h-8 text-xs"
                        aria-label="Reviewer name"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addReviewer(r.id)}
                        aria-label="Add reviewer"
                        className="h-8"
                      >
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Comments */}
                  <div>
                    <Label htmlFor={`rfc-${r.id}-comment`} className="text-xs text-sub mb-1">
                      Comments ({r.comments.length})
                    </Label>
                    {r.comments.length > 0 && (
                      <div className="space-y-1.5 mb-2 max-h-48 overflow-y-auto">
                        {r.comments.map((c) => (
                          <div
                            key={c.id}
                            className="rounded-md border border-border bg-bg p-2 text-xs"
                          >
                            <div className="flex items-baseline justify-between gap-2 mb-0.5">
                              <span className="font-semibold text-text">{c.author}</span>
                              <span className="text-xs text-sub font-data">
                                {new Date(c.ts).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sub whitespace-pre-wrap break-words">{c.text}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        value={commentDraft.author}
                        onChange={(e) =>
                          setCommentInputs((prev) => ({
                            ...prev,
                            [r.id]: {
                              author: e.target.value,
                              text: commentDraft.text,
                            },
                          }))
                        }
                        placeholder="Your name"
                        className="bg-bg border-border h-8 text-xs sm:w-32"
                        aria-label="Comment author"
                      />
                      <Textarea
                        id={`rfc-${r.id}-comment`}
                        value={commentDraft.text}
                        onChange={(e) =>
                          setCommentInputs((prev) => ({
                            ...prev,
                            [r.id]: {
                              author: commentDraft.author,
                              text: e.target.value,
                            },
                          }))
                        }
                        placeholder="Comment..."
                        rows={2}
                        className="bg-bg border-border text-xs resize-none flex-1"
                        aria-label="Comment text"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addComment(r.id)}
                        aria-label="Post comment"
                        className="h-8 self-end"
                      >
                        Post
                      </Button>
                    </div>
                  </div>

                  {/* Decision (only when decided) */}
                  {r.status === "decided" && (
                    <div>
                      <Label htmlFor={`rfc-${r.id}-decision`} className="text-xs text-sub mb-1">
                        Decision
                      </Label>
                      {/* Commit on blur, not per keystroke: `setDecision` trims,
                          so a keystroke that only adds whitespace produced an
                          identical state object, React bailed out of the
                          re-render, and its controlled-input restore wrote the
                          old value back — every space typed was swallowed
                          ("We will use SSE" became "WewilluseSSE"). */}
                      <BlurTextarea
                        id={`rfc-${r.id}-decision`}
                        value={r.decision ?? ""}
                        onCommit={(next) => setDecision(r.id, next)}
                        placeholder="What was decided and why..."
                        rows={3}
                        className="bg-bg border-border text-sm min-h-[80px]"
                        aria-label="Decision text"
                      />
                      <div className="flex justify-end mt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pushToDecisionLog(r)}
                          className="gap-2 border-accent/40 text-accent hover:bg-accent/10"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          Push to Decision Log
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </ToolPageWrapper>
  );
}
