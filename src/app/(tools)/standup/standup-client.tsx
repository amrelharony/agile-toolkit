"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calendar, Mail, Mic } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, hasExampleItems, isExampleId } from "@/components/tool-frame/example-data";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateAsyncStandupPrompts } from "@/lib/ai-prompts/async-standup";
import { generateStandupPrompts } from "@/lib/ai-prompts/standup";
import { ASYNC_STANDUP_ACTIONS, STANDUP_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryStore } from "@/lib/history/history-store";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  allStandupEntries,
  entryFor,
  hasBlocker,
  notPostedYet,
  previousEntry,
} from "@/lib/standup/entries";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { AsyncUpdate, StandupEntry, StandupMode } from "@/lib/stores/workspace-types";
import { findRosterMember, useTeamRoster } from "@/lib/team/use-team-roster";
import { copyToClipboard } from "@/lib/utils/export";
import { todayLocalISO } from "@/lib/utils/formatters";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import { usePersistedLocal } from "@/lib/utils/use-persisted";
import { BoardWalk } from "./board-walk";
import { type EntryCardActions, type LinksUpdate } from "./entry-card";
import { EntryForm, useEntryForm, type YesterdaySuggestion } from "./entry-form";
import { EXAMPLE_MEMBERS, buildExample, buildExampleBoard } from "./example";
import { toMarkdown, weeklyMarkdown } from "./markdown";
import {
  CSV_HEADERS,
  NO_ONE_AWAY,
  awayOn,
  csvRows,
  editedEntry,
  emptyDraft,
  longDay,
  personKey,
  postedEntry,
  sameEntryText,
  speakingOrder,
  withAway,
  type AwayDay,
  type EntryDraft,
  type EntryValues,
} from "./model";
import { ModeSwitch } from "./mode-switch";
import { NotPostedPanel } from "./people";
import { standupVerdict } from "./verdict";
import { BlockersView, HistoryView, TodayView } from "./views";
import { publishTurn, useStandupWalk } from "./walk";

/** Who is out of today's standup, per browser (removes nothing; see model.AwayDay). */
export const AWAY_KEY = "agile-toolkit:standup:away";

const NO_ENTRIES: StandupEntry[] = [];
const NO_UPDATES: AsyncUpdate[] = [];

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Same person, same day: one entry each, across both modes. */
const dayKey = (e: Pick<StandupEntry, "date" | "member">) => `${e.date} ${personKey(e.member)}`;

/** Every entry as stored right now, old async updates included. */
function currentEntries(): StandupEntry[] {
  const s = useWorkspaceStore.getState();
  return allStandupEntries(s.standupEntries, s.asyncUpdates);
}

/** Nothing typed yet beyond the suggested "yesterday". */
function isPristine(d: EntryDraft, suggestion: YesterdaySuggestion | null): boolean {
  const y = d.yesterday.trim();
  return (
    !d.today.trim() &&
    !d.blockers.trim() &&
    !d.notes.trim() &&
    (!y || y === (suggestion?.text.trim() ?? ""))
  );
}

const PAGE: Record<StandupMode, { toolId: string; title: string; description: string }> = {
  live: {
    toolId: "standup",
    title: "Standup Tracker",
    description:
      "Run the Daily Scrum over the sprint board: each person's turn shows their stories, with a timer, skip and next. Blockers become impediments in one click.",
  },
  async: {
    toolId: "async-standup",
    title: "Async Standup Digest",
    description:
      "Written standup updates, one per person per day: see who hasn't posted, and copy the daily digest with blockers first.",
  },
};

/**
 * The standup, live or async, over one set of entries (StandupEntry with
 * `mode`; lib/standup/entries). /standup opens the live mode and
 * /async-standup the async one; the switch at the top moves between them.
 * The old async tool's AsyncUpdate rows show alongside, and editing one
 * writes a StandupEntry under its id.
 */
export function StandupClient({ mode = "live" }: { mode?: StandupMode }) {
  const isAsync = mode === "async";
  const page = PAGE[mode];
  const stored = useWorkspaceStore((s) => s.standupEntries ?? NO_ENTRIES);
  const legacy = useWorkspaceStore((s) => s.asyncUpdates ?? NO_UPDATES);
  const entries = useMemo(() => allStandupEntries(stored, legacy), [stored, legacy]);
  const roster = useTeamRoster();
  const rosterNames = useMemo(() => roster.map((m) => m.name), [roster]);
  const upsertStandupEntry = useWorkspaceStore((s) => s.upsertStandupEntry);
  const { log } = useHistoryLogger(page.toolId);
  const announce = useAnnounce();

  // Re-render every minute so "today" rolls over at midnight without a reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = todayLocalISO();
  // Who has the floor in today's live walk (walk.ts), if one is on.
  const walk = useStandupWalk((s) => s.walk);
  const speaker = walk && walk.date === today ? walk.current : null;

  /* -- Who's in today ------------------------------------------------------ */

  const [awayState, setAwayState] = usePersistedLocal<AwayDay>(AWAY_KEY, NO_ONE_AWAY);
  const away = useMemo(() => awayOn(awayState, today), [awayState, today]);
  const expected = useMemo(
    () => rosterNames.filter((n) => !away.some((a) => personKey(a) === personKey(n))),
    [rosterNames, away]
  );
  const notYet = useMemo(() => notPostedYet(entries, expected, today), [entries, expected, today]);
  const order = useMemo(
    () => speakingOrder(rosterNames, entries, today, away),
    [rosterNames, entries, today, away]
  );

  // Out for the day only: the team, and everyone's stories and links, stay.
  const markAway = (name: string) =>
    undoable({
      label: `${shortName(name)} is out of today's standup`,
      apply: () => setAwayState((s) => withAway(s, today, name, true)),
      revert: () => setAwayState((s) => withAway(s, today, name, false)),
    });
  const markBack = (name: string) => {
    setAwayState((s) => withAway(s, today, name, false));
    announce(`${name} is back in today's standup`);
  };

  /* -- The post form ------------------------------------------------------- */

  const [suggestion, setSuggestion] = useState<YesterdaySuggestion | null>(null);
  const [pending, setPending] = useState<EntryValues | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  // Who "Post for" picked in async mode. With the speaker mid-walk in live
  // mode, it's who the form should be for next.
  const [postingFor, setPostingFor] = useState<string | null>(null);
  const wanted = isAsync ? postingFor : speaker;
  const form = useEntryForm(
    () => emptyDraft(todayLocalISO()),
    today,
    (values) => post(values)
  );
  const focusToday = () =>
    form.formRef.current?.querySelector<HTMLElement>('[data-entry-field="today"]')?.focus();

  /** What `member` said they'd do the last time before `date`. */
  const suggestFor = (member: string, date: string): YesterdaySuggestion | null => {
    const prev = previousEntry(entries, member, date);
    return prev && prev.today.trim() ? { date: prev.date, text: prev.today.trim() } : null;
  };

  // Prefill "yesterday" from the person's last plan, unless something else
  // has been typed there.
  const choose = (member: string, date: string) => {
    const next = suggestFor(member, date);
    const typed = form.draft.yesterday.trim();
    const own = typed !== "" && typed !== (suggestion?.text.trim() ?? "");
    form.update({ member, date, ...(own ? {} : { yesterday: next?.text ?? "" }) });
    setSuggestion(next);
  };
  const fillFor = (member: string) => {
    const next = suggestFor(member, today);
    form.reset({ ...emptyDraft(today, member), yesterday: next?.text ?? "" });
    setSuggestion(next);
  };
  // "Post for" starts that person's update for today. Notes already typed
  // for someone else are never handed to them: the banner above the form
  // asks first ("These notes are for Ana. Save them, or start Bo's").
  const postFor = (member: string) => {
    setPostingFor(member);
    const typedFor = form.draft.member.trim();
    if (isPristine(form.draft, suggestion)) fillFor(member);
    else if (!typedFor) choose(member, today);
    else if (personKey(typedFor) !== personKey(member)) return;
    focusToday();
  };

  // The old async tool posted a fresh row on every post, so a person can
  // have more than one for a day. Replacing them writes the one entry and
  // drops the extra rows, with Undo.
  const replaceAll = (entry: StandupEntry, extras: readonly StandupEntry[]) => {
    const s = useWorkspaceStore.getState();
    const ids = new Set(extras.map((e) => e.id));
    const before = (s.standupEntries ?? []).find((e) => e.id === entry.id);
    const extraEntries = (s.standupEntries ?? []).filter((e) => ids.has(e.id));
    const extraUpdates = (s.asyncUpdates ?? []).filter((u) => ids.has(u.id));
    undoable({
      label: `Replaced ${extras.length + 1} updates from ${shortName(entry.member)} with one`,
      apply: () => {
        const st = useWorkspaceStore.getState();
        st.upsertStandupEntry(entry);
        for (const e of extraEntries) st.removeStandupEntry(e.id);
        for (const u of extraUpdates) st.removeAsyncUpdate(u.id);
      },
      revert: () => {
        const st = useWorkspaceStore.getState();
        // An old async update replaced under its own id shows again.
        if (before) st.upsertStandupEntry(before);
        else st.removeStandupEntry(entry.id);
        for (const e of extraEntries) st.upsertStandupEntry(e);
        for (const u of extraUpdates) st.upsertAsyncUpdate(u);
      },
    });
  };

  function commitPost(values: EntryValues) {
    const all = currentEntries();
    const existing = entryFor(all, values.member, values.date);
    const entry = postedEntry(values, mode, existing, Date.now());
    const extras = existing
      ? all.filter((e) => e.id !== existing.id && dayKey(e) === dayKey(existing))
      : [];
    if (extras.length > 0) replaceAll(entry, extras);
    else upsertStandupEntry(entry);
    if (isAsync) {
      log(ASYNC_STANDUP_ACTIONS.UPDATE_POSTED, {
        updateId: entry.id,
        member: entry.member,
        date: entry.date,
        hasBlockers: hasBlocker(entry),
        description: entry.description,
      });
    } else {
      log(STANDUP_ACTIONS.ENTRY_ADDED, {
        member: entry.member,
        date: entry.date,
        hasBlocker: hasBlocker(entry),
      });
    }
    announce(`${existing ? "Replaced" : "Posted"} ${entry.member}'s update`);
    // The form moves on to whoever it's wanted for now: the speaker
    // mid-walk, or the person "Post for" picked.
    if (wanted && personKey(wanted) !== personKey(entry.member)) fillFor(wanted);
    else {
      form.reset(emptyDraft(today));
      setSuggestion(null);
      setPostingFor(null);
    }
  }

  function post(values: EntryValues) {
    // A roster name is stored with the roster's spelling, so "alice" and
    // "Alice" stay one person. Typing a new name never adds them to the
    // team; the picker offers that as its own click.
    const member = findRosterMember(roster, values.member)?.name.trim() ?? values.member;
    const clean = { ...values, member };
    if (entryFor(currentEntries(), member, clean.date)) {
      // One entry per person per day: ask before replacing. The form keeps
      // its values if the user backs out.
      setPending(clean);
      setReplaceOpen(true);
      return;
    }
    commitPost(clean);
  }

  /* -- Editing, deleting, blockers ---------------------------------------- */

  const [editingId, setEditingId] = useState<string | null>(null);

  const saveEdit = (entry: StandupEntry, values: EntryValues) => {
    setEditingId(null);
    if (sameEntryText(entry, values)) return;
    // Re-read: a blocker resolved or sent since the editor opened is kept.
    const fresh = currentEntries().find((e) => e.id === entry.id) ?? entry;
    upsertStandupEntry(editedEntry(fresh, values));
    announce(`Saved ${entry.member}'s update`);
  };

  // An old async update may sit under the same id as its replacement; both go.
  const remove = (entry: StandupEntry) => {
    const s = useWorkspaceStore.getState();
    const saved = (s.standupEntries ?? []).find((e) => e.id === entry.id);
    const update = (s.asyncUpdates ?? []).find((u) => u.id === entry.id);
    // What that person had for the day when it went (an old async row can
    // be one of two), so Undo can tell a post made since.
    const sameDay = new Set(
      allStandupEntries(s.standupEntries, s.asyncUpdates)
        .filter((e) => dayKey(e) === dayKey(entry))
        .map((e) => e.id)
    );
    if (editingId === entry.id) setEditingId(null);
    undoable({
      label: `Deleted ${shortName(entry.member)}'s update`,
      apply: () => {
        const st = useWorkspaceStore.getState();
        if (saved) st.removeStandupEntry(entry.id);
        if (update) st.removeAsyncUpdate(entry.id);
        if (isAsync) {
          log(ASYNC_STANDUP_ACTIONS.UPDATE_REMOVED, {
            updateId: entry.id,
            member: entry.member,
            date: entry.date,
          });
        } else {
          log(STANDUP_ACTIONS.ENTRY_REMOVED, { member: entry.member, date: entry.date });
        }
      },
      revert: () => {
        // One entry per person per day: a post made since the delete wins.
        if (currentEntries().some((e) => dayKey(e) === dayKey(entry) && !sameDay.has(e.id))) {
          toast(
            `${shortName(entry.member)} posted again since, so the deleted update wasn't put back`
          );
          return;
        }
        const st = useWorkspaceStore.getState();
        if (saved) st.upsertStandupEntry(saved);
        if (update) st.upsertAsyncUpdate(update);
      },
    });
  };

  const setResolved = (entry: StandupEntry, resolved: boolean) => {
    const cur = currentEntries().find((e) => e.id === entry.id);
    if (!cur) return;
    const next: StandupEntry = { ...cur };
    if (resolved) next.blockerResolved = true;
    else delete next.blockerResolved;
    upsertStandupEntry(next);
    announce(`${resolved ? "Resolved" : "Reopened"} ${entry.member}'s blocker`);
  };

  // Where a blocker was sent. Reads the entry fresh, so an edit made since
  // the last render isn't overwritten.
  const updateBlockerLinks = (id: string, update: LinksUpdate) => {
    const cur = currentEntries().find((e) => e.id === id);
    if (cur) upsertStandupEntry({ ...cur, sentTo: update(cur.sentTo) });
  };

  const actions: EntryCardActions = {
    onEdit: (e) => setEditingId(e.id),
    onCancelEdit: () => setEditingId(null),
    onSave: saveEdit,
    onDelete: remove,
    onResolve: (e) => setResolved(e, true),
    onReopen: (e) => setResolved(e, false),
    onLinksChange: updateBlockerLinks,
  };

  /* -- Clear everything (confirm, then Undo) ------------------------------ */

  // Each clear's Undo puts back what that clear took. The snapshot lives in
  // this render's closures, not a shared ref: a clear empties the store,
  // which always draws the page again, so a second clear inside the first
  // one's Undo window gets its own (and the first toast still has its own).
  let cleared: { entries: StandupEntry[]; updates: AsyncUpdate[] } | null = null;
  const clearAll = () => {
    const s = useWorkspaceStore.getState();
    cleared = { entries: s.standupEntries ?? [], updates: s.asyncUpdates ?? [] };
    useWorkspaceStore.setState({ standupEntries: [], asyncUpdates: [] });
    setEditingId(null);
    log(isAsync ? ASYNC_STANDUP_ACTIONS.ASYNC_STANDUP_RESET : STANDUP_ACTIONS.STANDUP_RESET, {});
  };
  // Entries posted since the clear are kept, and win over a restored entry
  // for the same person and day (one entry per person per day).
  const restoreAll = () => {
    if (!cleared) return;
    const snapshot = cleared;
    useWorkspaceStore.setState((s) => {
      const nowEntries = s.standupEntries ?? [];
      const nowUpdates = s.asyncUpdates ?? [];
      const taken = new Set(allStandupEntries(nowEntries, nowUpdates).map(dayKey));
      const ids = new Set([...nowEntries, ...nowUpdates].map((x) => x.id));
      const back = <T extends Pick<StandupEntry, "id" | "date" | "member">>(list: T[]) =>
        list.filter((x) => !taken.has(dayKey(x)) && !ids.has(x.id));
      return {
        standupEntries: [...back(snapshot.entries), ...nowEntries],
        asyncUpdates: [...back(snapshot.updates), ...nowUpdates],
      };
    });
  };

  /* -- Example ------------------------------------------------------------ */

  const exampleLoaded = hasExampleItems(entries);
  const exampleStories = useMemo(
    () => (exampleLoaded ? buildExampleBoard() : null),
    [exampleLoaded]
  );
  const isExamplePerson = (name: string) =>
    exampleLoaded &&
    EXAMPLE_MEMBERS.some((m) => personKey(m) === personKey(name)) &&
    entries.some((e) => isExampleId(e.id) && personKey(e.member) === personKey(name));

  // Example entries are written like any other entry but never logged, so
  // they don't count as a submitted standup in history, XP or streaks. The
  // shared team roster is left alone; clearing removes only example entries.
  const loadExample = () => {
    for (const e of buildExample(new Date(), mode)) upsertStandupEntry(e);
    form.reset(emptyDraft(today));
    setSuggestion(null);
  };
  const clearExample = () => {
    const s = useWorkspaceStore.getState();
    for (const e of s.standupEntries ?? []) if (isExampleId(e.id)) s.removeStandupEntry(e.id);
    for (const u of s.asyncUpdates ?? []) if (isExampleId(u.id)) s.removeAsyncUpdate(u.id);
    const w = useStandupWalk.getState().walk;
    if (w?.current && EXAMPLE_MEMBERS.some((m) => personKey(m) === personKey(w.current))) {
      useStandupWalk.getState().setWalk(null);
      publishTurn(null);
    }
  };

  /* -- Read-outs ---------------------------------------------------------- */

  const verdict = standupVerdict({ entries, expected, today });
  const markdown = useMemo(
    () => toMarkdown(entries, new Date(), { notPosted: notYet }),
    [entries, notYet]
  );
  const weekly = useMemo(() => weeklyMarkdown(entries), [entries]);
  const csvData = useMemo(() => ({ headers: CSV_HEADERS, rows: csvRows(entries) }), [entries]);
  const openCount = entries.filter((e) => hasBlocker(e) && !e.blockerResolved).length;

  const promptConfig = useMemo(() => {
    if (isAsync) {
      const updates = entries
        .filter((e) => e.mode === "async")
        .sort((a, b) => b.date.localeCompare(a.date) || b.timestamp - a.timestamp)
        .map((e) => ({
          id: e.id,
          member: e.member,
          date: e.date,
          yesterday: e.yesterday,
          today: e.today,
          blockers: e.blockers || undefined,
          description: e.description,
        }));
      return {
        toolName: "Async Standup Digest",
        prompts: generateAsyncStandupPrompts({ updates }),
      };
    }
    const resolvedBlockers = entries.filter((e) => e.blockerResolved).map((e) => e.id);
    return {
      toolName: "Daily Standup",
      prompts: generateStandupPrompts({ entries, members: rosterNames, resolvedBlockers }),
    };
  }, [isAsync, entries, rosterNames]);

  const copyDigest = async (digest: string) => {
    const ok = await copyToClipboard(digest);
    if (ok) toast.success("Digest copied to clipboard");
    else toast.error("Failed to copy digest");
    const day = entries.filter((e) => e.date === today);
    log(ASYNC_STANDUP_ACTIONS.DIGEST_GENERATED, {
      date: today,
      updateCount: day.length,
      blockerCount: day.filter(hasBlocker).length,
    });
  };

  // ── Cross-tool signal: blockers raised in the Impediments tool ────────
  // Counted over the last 7 days so the facilitator sees outside activity
  // at a glance. Subscribes to the history store's events so logging
  // elsewhere shows up.
  const events = useHistoryStore((s) => s.events);
  const recentBlockerCount = useMemo(
    () =>
      selectEvents({
        toolId: "impediments",
        action: "impediment_raised",
        sinceDays: 7,
        limit: 100,
      }).length,
    // `events` is the trigger: selectEvents reads the store itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events]
  );

  /* -- The live walk and the form ---------------------------------------- */

  const pristine = isPristine(form.draft, suggestion);
  // The form follows the speaker, but never over notes not saved yet.
  const onTurn = (name: string | null) => {
    if (name && isPristine(form.draft, suggestion)) fillFor(name);
  };
  // Notes typed for someone other than who the form is wanted for (the
  // speaker, or who "Post for" picked): ask, never hand them over.
  const otherNotes = Boolean(
    wanted &&
    !pristine &&
    form.draft.member.trim() &&
    personKey(form.draft.member) !== personKey(wanted)
  );

  const entryForm = (
    <>
      {otherNotes && wanted && (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text"
        >
          <span className="min-w-0 flex-1">
            These notes are for {form.draft.member}. Save them, or start {wanted}&apos;s.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              fillFor(wanted);
              // The banner (and this button) go: carry on in their update.
              focusToday();
            }}
          >
            Start {wanted}&apos;s notes
          </Button>
        </div>
      )}
      <EntryForm
        form={form}
        today={today}
        submitLabel={isAsync ? "Post update" : "Submit Standup"}
        suggestion={suggestion}
        onMemberChange={(name) => {
          // Picking someone by hand is an answer to "Post for" too.
          setPostingFor(null);
          choose(name, form.draft.date || today);
        }}
        onDateChange={(date) => choose(form.draft.member, date)}
      />
    </>
  );

  const n = entries.length;
  const nEntries = `${n} standup ${n === 1 ? "entry" : "entries"}`;
  // Rows the pending post would replace (more than one from the old async tool).
  const replacing = pending ? entries.filter((e) => dayKey(e) === dayKey(pending)).length : 0;

  return (
    <ToolPageWrapper
      toolId={page.toolId}
      title={page.title}
      description={page.description}
      category="Ceremonies"
    >
      {exampleLoaded && <ExampleNotice onClear={clearExample} />}
      <div className="space-y-6">
        {/* ---- Mode, day, actions ---- */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <ModeSwitch mode={mode} />
            <span className="flex items-center gap-2 text-sm text-sub">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              {longDay(today)}
            </span>
            {recentBlockerCount > 0 && (
              <Badge
                className="gap-1.5 border-danger/30 bg-danger/15 text-danger"
                title="Blockers logged in the Impediments tool in the last 7 days. Bring these up during standup."
              >
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                Recent blocker activity: {recentBlockerCount}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ResetButton
              label="Clear Entries"
              variant="danger-ghost"
              title={`Delete all ${nEntries}?`}
              description="Every day's entries and blockers will be removed, live and async. Team members stay on the roster."
              confirmLabel="Delete entries"
              doneLabel={`Deleted ${nEntries}`}
              onReset={clearAll}
              onUndo={restoreAll}
              disabled={n === 0}
            />
            <AiPromptGenerator config={promptConfig} />
            {/* Named apart from the digests' own Export menus below. */}
            <div role="group" aria-label="All entries" className="flex">
              <ExportButton
                filename="standup-all"
                csvData={csvData}
                clipboardText={weekly}
                markdown={markdown}
              />
            </div>
          </div>
        </div>

        <p className="text-sm font-medium text-text">{verdict}</p>

        {/* ---- Mode panel + form ---- */}
        {isAsync ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <SectionCard
              title={`Post your update for ${longDay(today)}`}
              icon={Mail}
              className="min-w-0 lg:col-span-2"
            >
              {entryForm}
            </SectionCard>
            <NotPostedPanel
              rosterSize={roster.length}
              notYet={notYet}
              away={away}
              onPostFor={postFor}
              onAway={markAway}
              onBack={markBack}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              <BoardWalk
                order={order}
                away={away}
                entries={entries}
                today={today}
                exampleStories={exampleStories}
                isExamplePerson={isExamplePerson}
                onTurn={onTurn}
                onAway={markAway}
                onBack={markBack}
              />
            </div>
            <SectionCard title="Today's Standup" icon={Mic} className="min-w-0 lg:col-span-2">
              {entryForm}
            </SectionCard>
          </div>
        )}

        {/* ---- Today, history, blockers ---- */}
        <Tabs defaultValue="today">
          <TabsList className="h-10 border border-border bg-surface-deep">
            <TabsTrigger
              value="today"
              className="text-sub data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              Today
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="text-sub data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              History
            </TabsTrigger>
            <TabsTrigger
              value="blockers"
              className="text-sub data-[state=active]:bg-surface data-[state=active]:text-text"
            >
              Blockers
              {openCount > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-danger/30 bg-danger/15 px-1 font-data text-xs text-danger">
                  {openCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="today" className="mt-4">
            <TodayView
              mode={mode}
              entries={entries}
              today={today}
              notYet={notYet}
              editingId={editingId}
              actions={actions}
              onLoadExample={loadExample}
              onCopyDigest={copyDigest}
            />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <HistoryView
              entries={entries}
              today={today}
              teamSize={expected.length}
              editingId={editingId}
              actions={actions}
            />
          </TabsContent>
          <TabsContent value="blockers" className="mt-4">
            <BlockersView entries={entries} today={today} actions={actions} />
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        title={`Replace ${pending?.member ?? ""}'s standup?`}
        description={
          replacing > 1
            ? `${pending?.member ?? "This member"} already has ${replacing} updates for ${
                pending?.date ?? "today"
              }. Submitting again replaces them with this one.`
            : `${pending?.member ?? "This member"} already submitted a standup for ${
                pending?.date ?? "today"
              }. Submitting again replaces that entry.`
        }
        confirmLabel="Replace entry"
        onConfirm={() => {
          if (pending) commitPost(pending);
        }}
      />
    </ToolPageWrapper>
  );
}
