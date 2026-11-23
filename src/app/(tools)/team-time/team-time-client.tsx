"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { Earth } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { ExampleNotice, LoadExampleButton, exampleId } from "@/components/tool-frame/example-data";
import { Field } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateTeamTimePrompts } from "@/lib/ai-prompts/team-time";
import { TEAM_TIME_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  CeremonyCadenceDoc,
  MeetingAudit,
  TeamTimePerson,
  TeamTimePoll,
  TeamTimeRotation,
  WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { personName, placeLabel } from "@/lib/team-time/format";
import { readPeople, readPolls, readRotations, savedCadence } from "@/lib/team-time/model";
import { scheduleNoteInput } from "@/lib/team-time/note";
import { canonicalZone, zoneLabel } from "@/lib/team-time/zones";
import { useTeamRoster, useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import type { TeamTimeCtx } from "./context";
import { buildTeamTimeExample, type TeamTimeExample } from "./example";
import { SELECT_CLASS } from "./fields";
import { peopleCsv, teamTimeMarkdown } from "./markdown";
import { OfficeTab } from "./office-tab";
import { PeopleTab } from "./people-tab";
import { PollTab } from "./poll-tab";
import { RotateTab } from "./rotate-tab";
import { SharedTab } from "./shared-tab";
import {
  TAB_LABEL,
  TEAM_TIME_TABS,
  exampleWriter,
  normalizeView,
  useTeamTimeView,
  workspaceWriter,
  type TeamTimeTab,
} from "./store";

export const TOOL_ID = "team-time";

const NO_PEOPLE: TeamTimePerson[] = [];
const NO_POLLS: TeamTimePoll[] = [];
const NO_ROTATIONS: TeamTimeRotation[] = [];
const NO_CADENCES: CeremonyCadenceDoc[] = [];
const NO_AGREEMENTS: WorkingAgreement[] = [];
const NO_AUDITS: MeetingAudit[] = [];
const noLog = () => {};

const TITLE = "Team Time";
const DESCRIPTION =
  "Find the hours a spread-out team shares, poll for a meeting time, rotate late calls fairly and pick office days.";

/** This browser's own zone, canonical (UTC when Intl can't say). */
function browserZone(): string {
  try {
    return canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Team Time: for a team spread across zones and offices, each person's
 * zone and hours (People), the hours they share (Shared hours), a poll for
 * a meeting time (Find a time), a meeting that rotates so the late calls
 * are shared (Rotate) and the offices' anchor days (Office days). The rows
 * are workspace entities, so Amr's verbs, the Working Agreement and the
 * Standup read the same; the example lives in this page's memory only.
 */
export function TeamTimeClient() {
  const hydrated = useWorkspaceHydrated();
  const storedPeople = useWorkspaceStore((s) => s.teamTimePeople) ?? NO_PEOPLE;
  const storedPolls = useWorkspaceStore((s) => s.teamTimePolls) ?? NO_POLLS;
  const storedRotations = useWorkspaceStore((s) => s.teamTimeRotations) ?? NO_ROTATIONS;
  const cadences = useWorkspaceStore((s) => s.ceremonyCadences) ?? NO_CADENCES;
  const agreements = useWorkspaceStore((s) => s.workingAgreements) ?? NO_AGREEMENTS;
  const audits = useWorkspaceStore((s) => s.meetingAudits) ?? NO_AUDITS;
  const workspaceRoster = useTeamRoster();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();

  const [viewReady, setViewReady] = useState(false);
  useEffect(() => {
    void Promise.resolve(useTeamTimeView.persist.rehydrate()).then(() => setViewReady(true));
  }, []);
  const storedView = useTeamTimeView((s) => s);
  const view = useMemo(() => normalizeView(storedView), [storedView]);

  // A minute tick: everyone's "now" and the poll nudges stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [viewerZone] = useState(browserZone);

  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<TeamTimeExample | null>(null);
  const preview = example !== null;
  const people = useMemo(
    () => readPeople(example?.people ?? storedPeople),
    [example, storedPeople]
  );
  const polls = useMemo(() => readPolls(example?.polls ?? storedPolls), [example, storedPolls]);
  const rotations = useMemo(
    () => readRotations(example?.rotations ?? storedRotations),
    [example, storedRotations]
  );
  const roster = example?.roster ?? workspaceRoster;
  const cadence = savedCadence(preview ? undefined : cadences);
  const holidays = useMemo(() => cadence?.holidays ?? [], [cadence]);

  const zone = view.displayZone ?? viewerZone;
  const writer = useMemo(
    () =>
      preview ? exampleWriter((fn) => setExample((ex) => (ex ? fn(ex) : ex))) : workspaceWriter,
    [preview]
  );
  const newId = useCallback(
    (prefix: string) => (preview ? exampleId(`${prefix}-${nanoid(8)}`) : `${prefix}_${nanoid(8)}`),
    [preview]
  );

  const ctx: TeamTimeCtx = useMemo(() => {
    const names = new Map(people.map((p) => [p.id, personName(p, roster)]));
    const places = new Map(people.map((p) => [p.id, placeLabel(p)]));
    return {
      people,
      roster,
      polls,
      rotations,
      name: (id) => names.get(id) ?? id,
      place: (id) => places.get(id) ?? "",
      writer,
      record: preview ? noLog : log,
      announce,
      now,
      viewerZone,
      zone,
      preview,
      newId,
      holidays,
      cadences: preview ? NO_CADENCES : cadences,
      agreements: preview ? NO_AGREEMENTS : agreements,
      meetingAudits: preview ? NO_AUDITS : audits,
    };
  }, [
    people,
    roster,
    polls,
    rotations,
    writer,
    preview,
    log,
    announce,
    now,
    viewerZone,
    zone,
    newId,
    holidays,
    cadences,
    agreements,
    audits,
  ]);

  const markdown = useMemo(
    () => teamTimeMarkdown({ people, roster, polls, rotations, zone, now, holidays }),
    [people, roster, polls, rotations, zone, now, holidays]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: TITLE,
      prompts: generateTeamTimePrompts(
        people.length > 0
          ? scheduleNoteInput({ people, now, zone: viewerZone, cadence, rotations, holidays })
          : null
      ),
    }),
    [people, now, viewerZone, cadence, rotations, holidays]
  );

  const hasRows = people.length + polls.length + rotations.length > 0;

  const clearAll = () => {
    const snapshot = {
      people: [...(useWorkspaceStore.getState().teamTimePeople ?? [])],
      polls: [...(useWorkspaceStore.getState().teamTimePolls ?? [])],
      rotations: [...(useWorkspaceStore.getState().teamTimeRotations ?? [])],
    };
    useWorkspaceStore.setState({ teamTimePeople: [], teamTimePolls: [], teamTimeRotations: [] });
    log(TEAM_TIME_ACTIONS.TEAM_TIME_RESET, {
      people: snapshot.people.length,
      polls: snapshot.polls.length,
      rotations: snapshot.rotations.length,
    });
    return snapshot;
  };
  const resetSnapshot = useRef<ReturnType<typeof clearAll> | null>(null);

  const loadExample = () => setExample(buildTeamTimeExample(new Date()));
  const clearExample = () => {
    const was = example;
    undoable({
      label: "Cleared the example",
      apply: () => setExample(null),
      revert: () => setExample(was),
    });
  };

  const zoneChoices = useMemo(() => {
    const out: { value: string; label: string }[] = [
      { value: "", label: `My time (${zoneLabel(viewerZone)})` },
    ];
    if (viewerZone !== "UTC") out.push({ value: "UTC", label: "UTC" });
    for (const z of Array.from(new Set(people.map((p) => p.timeZone)))) {
      if (z === viewerZone || z === "UTC") continue;
      const who = people.filter((p) => p.timeZone === z).map((p) => ctx.name(p.id));
      out.push({
        value: z,
        label: `${zoneLabel(z)} (${who.slice(0, 2).join(", ")}${who.length > 2 ? "…" : ""})`,
      });
    }
    if (view.displayZone && !out.some((o) => o.value === view.displayZone)) {
      out.push({ value: view.displayZone, label: zoneLabel(view.displayZone) });
    }
    return out;
  }, [viewerZone, people, ctx, view.displayZone]);

  if (!hydrated || !viewReady) {
    return (
      <ToolPageWrapper toolId="team-time" title={TITLE} description={DESCRIPTION}>
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading Team Time…
        </p>
      </ToolPageWrapper>
    );
  }

  return (
    <ToolPageWrapper toolId="team-time" title={TITLE} description={DESCRIPTION}>
      <div className="space-y-4">
        {preview && (
          <div>
            <ExampleNotice onClear={clearExample} />
            <p className="-mt-2 text-xs text-sub">
              Example: a checkout team from Toronto to Sydney. Nothing in it is saved, and your own
              Team Time stays as it is.
            </p>
          </div>
        )}

        <ActionRow>
          {people.length > 0 && <AiPromptGenerator config={promptConfig} />}
          {hasRows && (
            <ExportButton
              filename="team-time"
              markdown={markdown}
              clipboardText={markdown}
              csvData={peopleCsv(people, roster)}
              jsonData={{ people, polls, rotations }}
            />
          )}
          {hasRows && !preview && (
            <ResetButton
              label="Clear Team Time"
              title="Clear Team Time?"
              description="Every person's zone and hours, every poll and every rotation go. The roster stays. Export first to keep a copy."
              confirmLabel="Clear Team Time"
              doneLabel="Cleared Team Time"
              onReset={() => {
                resetSnapshot.current = clearAll();
              }}
              onUndo={() => {
                const was = resetSnapshot.current;
                if (!was) return;
                useWorkspaceStore.setState({
                  teamTimePeople: was.people,
                  teamTimePolls: was.polls,
                  teamTimeRotations: was.rotations,
                });
                resetSnapshot.current = null;
              }}
            />
          )}
        </ActionRow>

        {!hasRows && !preview && (
          <EmptyState icon={Earth} action={<LoadExampleButton onLoad={loadExample} />}>
            No one&apos;s time zone yet. Start on People: set each person&apos;s zone, hours and
            office days. Then see the hours you share, poll for a meeting time and rotate the late
            calls fairly.
          </EmptyState>
        )}

        <Field label="Show times on" className="max-w-xs">
          {(control) => (
            <select
              {...control}
              className={SELECT_CLASS}
              value={view.displayZone ?? ""}
              onChange={(e) => useTeamTimeView.setState({ displayZone: e.target.value || null })}
            >
              {zoneChoices.map((c) => (
                <option key={c.value || "mine"} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Tabs
          value={view.tab}
          onValueChange={(v) => useTeamTimeView.setState({ tab: v as TeamTimeTab })}
        >
          <TabsList aria-label="Team Time">
            {TEAM_TIME_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="people">
            <PeopleTab ctx={ctx} />
          </TabsContent>
          <TabsContent value="shared">
            <SharedTab ctx={ctx} />
          </TabsContent>
          <TabsContent value="find">
            <PollTab ctx={ctx} />
          </TabsContent>
          <TabsContent value="rotate">
            <RotateTab ctx={ctx} />
          </TabsContent>
          <TabsContent value="office">
            <OfficeTab ctx={ctx} />
          </TabsContent>
        </Tabs>
        <p className="text-xs text-sub">
          Follow-the-sun hand-overs between places live in the Async Standup.
        </p>
      </div>
    </ToolPageWrapper>
  );
}
