"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import {
  CheckCircle2,
  ClipboardCheck,
  Handshake,
  History,
  ListChecks,
  Plus,
  Send,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { generateWorkingAgreementPrompts } from "@/lib/ai-prompts/working-agreement";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { WORKING_AGREEMENT_ACTIONS } from "@/lib/history/event-actions";
import type { HandoffLink } from "@/lib/handoffs/types";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import { sprintsNewestFirst, todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  CharterCheckIn,
  CharterConsentVote,
  CharterRule,
  CharterRuleCategory,
  RetroBoard,
  Sprint,
  WorkingAgreement,
  Workspace,
} from "@/lib/stores/workspace-types";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { plural } from "@/lib/charts/chart-text";
import { toast } from "@/lib/utils/toast";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import {
  WA_ID,
  adherencePhrase,
  agreementConsent,
  agreementVerdict,
  canPublish,
  checkInAdherence,
  consentEntries,
  dayLabel,
  draftCheckIn,
  draftCount,
  emptyAgreement,
  hasUnpublishedChanges,
  lastCheckIn,
  latestVersion,
  needsSnapshot,
  normalizeAgreement,
  published,
  quotablePct,
  slippingRun,
  withCheckIn,
  withConsent,
  withoutDraft,
  type CheckInMark,
} from "@/lib/working-agreement/model";
import { CATEGORIES, CATEGORY_CLASS, CATEGORY_LABEL, STARTER_CATALOG, ruleKey } from "./catalog";
import { CheckInHistory, SaveRoundForm } from "./check-in-panel";
import { buildExample, type WorkingAgreementExample } from "./example";
import type { CheckInValues, RuleValues } from "./form";
import { agreementMarkdown } from "./markdown";
import { AddRuleForm } from "./rule-form";
import { RuleCard } from "./rule-card";
import { VOTE_LABEL } from "./consent-panel";
import { VersionsPanel } from "./versions-panel";
import { cn } from "@/lib/utils";

export const TOOL_ID = "working-agreement";

const NO_SPRINTS: Sprint[] = [];
const NO_BOARDS: RetroBoard[] = [];
const NO_LINKS: HandoffLink[] = [];

/** A change to the agreement, applied to the document as it is when it runs. */
type DocUpdate = (doc: WorkingAgreement) => WorkingAgreement;

/**
 * Writes the workspace's agreement, read fresh from the store at the moment
 * it writes (never a render's copy, which may be stale), in the shape the
 * model reads: the page, the charter and the agent all see the same doc.
 */
function writeStore(update: DocUpdate) {
  const { workingAgreements, upsertWorkingAgreement } = useWorkspaceStore.getState();
  const current = normalizeAgreement((workingAgreements ?? []).find((d) => d.id === WA_ID));
  upsertWorkingAgreement(update(current));
}

const noLog = () => undefined;

/** Focus what `find` returns once React has re-rendered (a deleted or moved card took focus with it). */
function focusSoon(find: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => find()?.focus());
}

/** The control that carries `attr` = `id` (data-rule-edit, data-rule-category, data-round-delete). */
const controlFor = (attr: string, id: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`)).find(
    (el) => el.getAttribute(attr) === id
  );

/** `rule` with its text and description as edited; an emptied description goes. */
function withText(rule: CharterRule, text: string, description: string | undefined): CharterRule {
  const next: CharterRule = { ...rule, text };
  if (description !== undefined) {
    if (description.trim()) next.description = description.trim();
    else delete next.description;
  }
  return next;
}

/**
 * Working Agreement: the team's charter of rules, each person's consent to
 * each rule (from the roster), dated check-in rounds with adherence over
 * time, and published versions that can be compared. Everything is one
 * workspace document, so the Team charter and agents read the same thing.
 */
export function WorkingAgreementClient() {
  const hydrated = useWorkspaceHydrated();
  const stored = useWorkspaceStore(
    useShallow((s) => (s.workingAgreements ?? []).find((d) => d.id === WA_ID))
  );
  const workspaceRoster = useTeamRoster();
  const sprintList = useWorkspaceStore((s) => s.sprints) ?? NO_SPRINTS;
  const retroBoards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<WorkingAgreementExample | null>(null);
  const preview = example !== null;
  const doc = useMemo(() => normalizeAgreement(example?.doc ?? stored), [example, stored]);
  const roster = example?.roster ?? workspaceRoster;
  const sprints = useMemo(
    () => (preview ? NO_SPRINTS : sprintsNewestFirst(sprintList)),
    [preview, sprintList]
  );
  const resetSnapshot = useRef<WorkingAgreement | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const roundRef = useRef<HTMLDivElement>(null);

  // Fixed for the render an edit starts in, so its Undo goes back to the
  // same place even if the example is loaded or cleared in between. The
  // example's edits aren't the team's history, so they aren't logged.
  const write: (update: DocUpdate) => void = preview
    ? (update) => setExample((ex) => (ex ? { ...ex, doc: update(normalizeAgreement(ex.doc)) } : ex))
    : writeStore;
  const record: typeof log = preview ? noLog : log;
  const newId = () => (preview ? exampleId(nanoid(8)) : crypto.randomUUID());

  const sprintName = (id: string | undefined) =>
    id ? (example?.sprintNames[id] ?? sprintList.find((s) => s.id === id)?.name) : undefined;

  /** The current retro's cards that came from a rule: the rule's "sent" links. */
  const sentTo = useMemo(() => {
    const board = retroBoards.find((b) => b.id === RETRO_CURRENT_ID);
    const links = new Map<string, HandoffLink[]>();
    for (const card of board?.cards ?? []) {
      if (card.sourceRef?.tool !== TOOL_ID) continue;
      const list = links.get(card.sourceRef.id) ?? [];
      list.push({ route: "retro-topic", targetId: card.id, at: "" });
      links.set(card.sourceRef.id, list);
    }
    return links;
  }, [retroBoards]);

  /* ── Numbers ──────────────────────────────────────────────────────── */

  const verdict = agreementVerdict(doc, roster);
  const consent = agreementConsent(doc, roster);
  const answered = doc.rules.some((r) => consentEntries(r).length > 0);
  const last = lastCheckIn(doc);
  const lastAdherence = last ? checkInAdherence(last) : null;
  const marked = draftCount(doc);
  const unpublished = hasUnpublishedChanges(doc);
  const noSnapshot = needsSnapshot(doc);
  const markdown = agreementMarkdown(doc, roster, { verdict, sprintName });
  const byCategory = CATEGORIES.map((c) => ({
    ...c,
    rules: doc.rules.filter((r) => r.category === c.id),
  })).filter((c) => c.rules.length > 0);
  const catalog = STARTER_CATALOG.filter(
    (s) => !doc.rules.some((r) => ruleKey(r.text) === ruleKey(s.text))
  );

  /* ── Rules ────────────────────────────────────────────────────────── */

  const add = (values: RuleValues, source: "custom" | "catalog") => {
    const rule: CharterRule = {
      id: newId(),
      category: values.category,
      text: values.text,
      agreedBy: [],
      consent: [],
      ...(values.description ? { description: values.description } : {}),
    };
    write((d) => ({ ...d, rules: [...d.rules, rule] }));
    record(WORKING_AGREEMENT_ACTIONS.RULE_ADDED, {
      ruleId: rule.id,
      category: rule.category,
      text: rule.text,
      source,
    });
    announce(`Added “${rule.text}” under ${CATEGORY_LABEL[rule.category]}`);
  };

  const patchRule = (id: string, change: (r: CharterRule) => CharterRule) =>
    write((d) => ({ ...d, rules: d.rules.map((r) => (r.id === id ? change(r) : r)) }));

  const editText = (rule: CharterRule, text: string, description: string | undefined) => {
    // The add form and update_rule refuse a second copy; so does an edit in place.
    if (doc.rules.some((r) => r.id !== rule.id && ruleKey(r.text) === ruleKey(text))) {
      toast.error(`“${text}” is already in the charter.`);
      return;
    }
    patchRule(rule.id, (r) => withText(r, text, description));
    record(WORKING_AGREEMENT_ACTIONS.RULE_UPDATED, { ruleId: rule.id, text });
  };

  const setCategory = (rule: CharterRule, category: CharterRuleCategory) => {
    if (category === rule.category) return;
    patchRule(rule.id, (r) => ({ ...r, category }));
    record(WORKING_AGREEMENT_ACTIONS.RULE_UPDATED, { ruleId: rule.id, category });
    announce(`Moved “${rule.text}” to ${CATEGORY_LABEL[category]}`);
    // The card mounts again under its new category; its category stays focused.
    focusSoon(() => controlFor("data-rule-category", rule.id));
  };

  const mark = (rule: CharterRule, stillWorking: CheckInMark | undefined) => {
    patchRule(rule.id, (r) => {
      const next = { ...r };
      if (stillWorking === undefined) delete next.stillWorking;
      else next.stillWorking = stillWorking;
      return next;
    });
    announce(
      `“${rule.text}”: ${
        stillWorking === undefined
          ? "not checked"
          : stillWorking === "partly"
            ? "partly working"
            : stillWorking
              ? "working"
              : "not working"
      }`
    );
  };

  const vote = (rule: CharterRule, name: string, v: CharterConsentVote | null, note?: string) => {
    const at = new Date().toISOString();
    patchRule(rule.id, (r) => withConsent(r, name, v, at, note));
    record(WORKING_AGREEMENT_ACTIONS.RULE_UPDATED, { ruleId: rule.id, consent: name, vote: v });
    announce(
      v
        ? `${name}: ${VOTE_LABEL[v]} on “${rule.text}”`
        : `Cleared ${name}'s answer on “${rule.text}”`
    );
  };

  const remove = (rule: CharterRule) => {
    // Focus moves to the next rule as listed (or the one before, or the add form).
    const listed = byCategory.flatMap((c) => c.rules);
    const at = listed.findIndex((r) => r.id === rule.id);
    const near = listed[at + 1] ?? listed[at - 1];
    removeWithUndo<CharterRule>({
      label: `Deleted “${rule.text}”`,
      update: (fn) => write((d) => ({ ...d, rules: fn(d.rules) })),
      match: (r) => r.id === rule.id,
    });
    record(WORKING_AGREEMENT_ACTIONS.RULE_REMOVED, { ruleId: rule.id, text: rule.text });
    announce(`Deleted “${rule.text}”`);
    focusSoon(() =>
      near
        ? controlFor("data-rule-edit", near.id)
        : addRef.current?.querySelector<HTMLElement>("input")
    );
  };

  /* ── Check-ins ────────────────────────────────────────────────────── */

  /** Each rule's mark as it is now, so an Undo can put the round's marks back. */
  const marksNow = () => new Map(doc.rules.map((r) => [r.id, r.stillWorking]));
  const restoreMarks = (marks: Map<string, CheckInMark | undefined>) => (d: WorkingAgreement) => ({
    ...d,
    rules: d.rules.map((r) =>
      marks.get(r.id) !== undefined && r.stillWorking === undefined
        ? { ...r, stillWorking: marks.get(r.id) }
        : r
    ),
  });

  const saveRound = (values: CheckInValues) => {
    const id = preview ? exampleId(`check-${nanoid(8)}`) : `checkIn_${nanoid(8)}`;
    const marks = marksNow();
    const label = `Saved the check-in of ${dayLabel(values.date, true)}`;
    undoable({
      label,
      apply: () => {
        write((d) => {
          const round = draftCheckIn(d, { id, ...values });
          return round ? withCheckIn(d, round) : d;
        });
        record(WORKING_AGREEMENT_ACTIONS.CHECK_IN_SAVED, {
          checkInId: id,
          date: values.date,
          rules: marked,
        });
      },
      revert: () =>
        write((d) =>
          restoreMarks(marks)({ ...d, checkIns: (d.checkIns ?? []).filter((c) => c.id !== id) })
        ),
    });
    announce(label);
  };

  const discardMarks = () => {
    const marks = marksNow();
    undoable({
      label: "Cleared this round's marks",
      apply: () => write(withoutDraft),
      revert: () => write(restoreMarks(marks)),
    });
    announce("Cleared this round's marks");
  };

  const editRound = (round: CharterCheckIn, patch: Partial<CharterCheckIn>) =>
    write((d) => {
      const current = (d.checkIns ?? []).find((c) => c.id === round.id);
      if (!current) return d;
      const next = { ...current, ...patch };
      if (!next.note?.trim()) delete next.note;
      return withCheckIn(d, next, { clearDraft: false });
    });

  const removeRound = (round: CharterCheckIn) => {
    const label = `Deleted the check-in of ${dayLabel(round.date, true)}`;
    // Rounds are listed newest first: focus moves to the next one down (or up, or the save form).
    const listed = [...(doc.checkIns ?? [])].reverse();
    const at = listed.findIndex((c) => c.id === round.id);
    const near = listed[at + 1] ?? listed[at - 1];
    undoable({
      label,
      apply: () => {
        write((d) => ({ ...d, checkIns: (d.checkIns ?? []).filter((c) => c.id !== round.id) }));
        record(WORKING_AGREEMENT_ACTIONS.CHECK_IN_REMOVED, {
          checkInId: round.id,
          date: round.date,
        });
      },
      revert: () => write((d) => withCheckIn(d, round, { clearDraft: false })),
    });
    announce(label);
    focusSoon(() =>
      near
        ? controlFor("data-round-delete", near.id)
        : roundRef.current?.querySelector<HTMLElement>("input")
    );
  };

  /* ── Versions ─────────────────────────────────────────────────────── */

  const publish = () => {
    if (!canPublish(doc)) return;
    const at = new Date().toISOString();
    const before = { version: doc.meta.version, publishedAt: doc.meta.publishedAt };
    const next = doc.meta.version + 1;
    undoable({
      label: `Published v${next}`,
      apply: () => {
        write((d) => (canPublish(d) ? published(d, at) : d));
        record(WORKING_AGREEMENT_ACTIONS.CHARTER_PUBLISHED, {
          version: next,
          ruleCount: doc.rules.length,
          teamName: doc.meta.teamName,
        });
      },
      // Only this publish comes back off: a later one is left alone.
      revert: () =>
        write((d) => {
          if (latestVersion(d)?.publishedAt !== at) return d;
          const meta = { ...d.meta, version: before.version };
          if (before.publishedAt) meta.publishedAt = before.publishedAt;
          else delete meta.publishedAt;
          return { ...d, meta, versions: (d.versions ?? []).slice(0, -1) };
        }),
    });
    announce(`Published v${next}`);
  };

  const setMeta = (key: "teamName" | "description", value: string) =>
    write((d) => {
      const meta = { ...d.meta };
      if (value.trim()) meta[key] = value.trim();
      else delete meta[key];
      return { ...d, meta };
    });

  /* ── Example and reset ────────────────────────────────────────────── */

  const loadExample = () => setExample(buildExample(today));
  const clearExample = () => setExample(null);

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
  const promptConfig = useMemo(() => {
    const latest = lastCheckIn(doc);
    const a = latest ? checkInAdherence(latest) : null;
    return {
      toolName: "Working Agreement Builder",
      prompts: generateWorkingAgreementPrompts(
        {
          // Each rule's mark in the round in progress, Partly included, and
          // what the saved rounds found for it, as its card says it (a
          // rule no saved round checked has no run).
          rules: doc.rules.map((r) =>
            (doc.checkIns ?? []).some((c) => c.results[r.id] !== undefined)
              ? { ...r, slipping: slippingRun(doc, r.id) }
              : r
          ),
          meta: doc.meta,
          // Published or not, and changes since, as the verdict says it.
          unpublishedChanges: hasUnpublishedChanges(doc),
          // The last round as the KPI says it: its percentage only when quotable.
          lastCheckIn: a
            ? { summary: adherencePhrase(a), pct: quotablePct(a) ? a.pct : null }
            : null,
        },
        workspace
      ),
    };
  }, [doc, workspace]);

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId={TOOL_ID}
        title="Working Agreement Builder"
        description="The team's charter: rules everyone consents to, check-ins on whether they work, and published versions you can compare."
        category="Workshops & Facilitation"
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the working agreement…
        </p>
      </ToolPageWrapper>
    );
  }

  const hasRules = doc.rules.length > 0;

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Working Agreement Builder"
      description="The team's charter: rules everyone consents to, check-ins on whether they work, and published versions you can compare."
      category="Workshops & Facilitation"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="working-agreement"
          markdown={markdown}
          clipboardText={markdown}
          csvData={{
            headers: ["Category", "Rule", "Description", "Consented", "Concerns", "Objections"],
            rows: doc.rules.map((r) => {
              const entries = consentEntries(r);
              const names = (v: CharterConsentVote) =>
                entries
                  .filter((e) => e.vote === v)
                  .map((e) => e.name)
                  .join("; ");
              return [
                CATEGORY_LABEL[r.category],
                r.text,
                r.description ?? "",
                names("consent"),
                names("concern"),
                names("object"),
              ];
            }),
          }}
          jsonData={doc}
        />
      </ActionRow>

      {preview && (
        <div>
          <ExampleNotice onClear={clearExample} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: a checkout team&apos;s charter, two versions in. Nothing in it is saved, and
            your own agreement stays as it is.
          </p>
        </div>
      )}

      {!hasRules && !preview && (
        <EmptyState
          icon={Handshake}
          className="mb-4"
          action={<LoadExampleButton onLoad={loadExample} />}
        >
          No rules yet. Add your first one below or pick from the starter catalog; then ask each
          person on the team for consent, publish v1, and check in every few sprints on whether
          it&apos;s working.
        </EmptyState>
      )}

      {hasRules && (
        <>
          <p className="mb-3 text-sm font-medium text-text">{verdict}</p>
          <KpiGrid cols={4} gap="lg">
            <StatCard
              variant="compact"
              icon={ListChecks}
              label="Rules"
              value={doc.rules.length}
              valueClassName="text-accent"
            />
            <StatCard
              variant="compact"
              icon={Send}
              label="Version"
              value={doc.meta.version > 0 ? `v${doc.meta.version}` : "—"}
              hint={
                doc.meta.version === 0
                  ? "not published"
                  : noSnapshot
                    ? "no snapshot kept yet"
                    : unpublished
                      ? "changes not published"
                      : `published ${dayLabel(doc.meta.publishedAt)}`
              }
            />
            <StatCard
              variant="compact"
              icon={Handshake}
              label="Everyone's consent"
              value={answered ? `${consent.fullyConsented} of ${consent.rules}` : "—"}
              hint={
                !answered
                  ? "no answers yet"
                  : consent.withObjection > 0
                    ? `${consent.withObjection} with an objection`
                    : "rules"
              }
              tone={consent.withObjection > 0 ? "warning" : "default"}
            />
            <StatCard
              variant="compact"
              icon={CheckCircle2}
              label="Last check-in"
              value={lastAdherence ? `${lastAdherence.working} of ${lastAdherence.checked}` : "—"}
              hint={
                last && lastAdherence
                  ? `working${lastAdherence.partly > 0 ? `, ${lastAdherence.partly} partly` : ""} · ${dayLabel(last.date)}${quotablePct(lastAdherence) ? ` · ${lastAdherence.pct}%` : ""}`
                  : "no check-in yet"
              }
            />
          </KpiGrid>
        </>
      )}

      <div className="space-y-6">
        <SectionCard title="Add a rule" icon={Plus}>
          <div ref={addRef}>
            <AddRuleForm rules={doc.rules} onAdd={(v) => add(v, "custom")} />
          </div>
          {catalog.length > 0 && (
            <details className="mt-4 rounded-md border border-border bg-card">
              <summary className="min-h-10 cursor-pointer px-3 py-2 text-sm font-medium text-text">
                Starter catalog ({catalog.length})
              </summary>
              <div className="flex flex-wrap gap-2 border-t border-border p-3">
                {catalog.map((s) => (
                  <button
                    key={`${s.category}::${s.text}`}
                    type="button"
                    onClick={() => add({ category: s.category, text: s.text }, "catalog")}
                    className="max-w-full rounded-lg border border-border bg-bg px-3 py-2 text-left transition hover:border-accent/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:max-w-[320px]"
                  >
                    <Badge
                      variant="outline"
                      className={cn("mb-1 text-xs", CATEGORY_CLASS[s.category])}
                    >
                      {CATEGORY_LABEL[s.category]}
                    </Badge>
                    <span className="block text-xs text-text">{s.text}</span>
                    <span className="sr-only"> (add to the charter)</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </SectionCard>

        {hasRules && (
          <SectionCard title="The rules" icon={ClipboardCheck}>
            <p className="mb-3 text-xs text-sub">
              Open a rule&apos;s consent to record each person&apos;s answer. Mark each rule
              Working, Partly or Not working during a check-in, then save the round below.
            </p>
            <div className="space-y-5">
              {byCategory.map((cat) => (
                <section key={cat.id} aria-label={cat.label} className="space-y-2">
                  <h3 className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("text-xs", cat.className)}>
                      {cat.label}
                    </Badge>
                    <span className="font-data text-xs text-sub">{cat.rules.length}</span>
                  </h3>
                  <ul className="space-y-2">
                    {cat.rules.map((rule) => (
                      <RuleCard
                        key={rule.id}
                        rule={rule}
                        roster={roster}
                        preview={preview}
                        slipping={slippingRun(doc, rule.id)}
                        sentTo={sentTo.get(rule.id) ?? NO_LINKS}
                        onText={editText}
                        onCategory={setCategory}
                        onMark={mark}
                        onVote={vote}
                        onDelete={remove}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </SectionCard>
        )}

        {hasRules && (
          <SectionCard title="Check-in round" icon={CheckCircle2}>
            <div ref={roundRef}>
              <SaveRoundForm
                marked={marked}
                total={doc.rules.length}
                today={today}
                sprints={sprints}
                onSave={saveRound}
                onDiscard={discardMarks}
              />
            </div>
          </SectionCard>
        )}

        {(hasRules || (doc.checkIns ?? []).length > 0) && (
          <SectionCard title="Adherence by check-in" icon={History}>
            <CheckInHistory
              rounds={doc.checkIns ?? []}
              today={today}
              sprintName={sprintName}
              onDate={(round, date) => editRound(round, { date })}
              onNote={(round, note) => editRound(round, { note })}
              onDelete={removeRound}
            />
          </SectionCard>
        )}

        {(hasRules || doc.meta.version > 0) && (
          <SectionCard title="Publish and versions" icon={Send}>
            <VersionsPanel
              doc={doc}
              onTeamName={(name) => setMeta("teamName", name)}
              onDescription={(description) => setMeta("description", description)}
              onPublish={publish}
            />
          </SectionCard>
        )}

        {!preview && (hasRules || (doc.versions ?? []).length > 0) && (
          <div className="flex justify-end">
            <ResetButton
              label="Clear the charter"
              title="Clear the whole working agreement?"
              description={`${
                doc.rules.length === 1
                  ? "The one rule and everyone's answers to it"
                  : `All ${doc.rules.length} rules and everyone's answers to them`
              }, ${plural((doc.checkIns ?? []).length, "saved check-in")} and ${plural(
                (doc.versions ?? []).length,
                "published version"
              )}.`}
              confirmLabel="Clear charter"
              doneLabel="Cleared the working agreement"
              onReset={() => {
                const { workingAgreements } = useWorkspaceStore.getState();
                resetSnapshot.current =
                  (workingAgreements ?? []).find((d) => d.id === WA_ID) ?? null;
                writeStore(() => emptyAgreement());
                log(WORKING_AGREEMENT_ACTIONS.CHARTER_RESET, { ruleCount: doc.rules.length });
              }}
              onUndo={() => {
                const snapshot = resetSnapshot.current;
                if (snapshot) writeStore(() => snapshot);
              }}
            />
          </div>
        )}
      </div>
    </ToolPageWrapper>
  );
}
