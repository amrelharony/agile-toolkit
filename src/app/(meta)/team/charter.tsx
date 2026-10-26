"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, ScrollText } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { SectionCard } from "@/components/shared/section-card";
import { ExportButton } from "@/components/shared/export-button";
import { CadenceForm } from "@/components/sprints/cadence-form";
import { getToolById } from "@/lib/constants/tools";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { useTeamRoster } from "@/lib/team/use-team-roster";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { todayIso } from "@/lib/sprints/series";
import { cn } from "@/lib/utils";
import { useDefinitionOfDone } from "@/lib/dod/use-definition-of-done";
import { WA_ID, normalizeAgreement } from "@/lib/working-agreement/model";
import { useRefinementStore } from "@/app/(tools)/refinement/store";
import { useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import { charterCards, charterMarkdown, type CharterDocs } from "./charter-view";

/** Empty lists, so a workspace without stories or sprints doesn't make the docs anew each render. */
const NO_STORIES: Story[] = [];
const NO_SPRINTS: Sprint[] = [];

/**
 * The team charter: the agreements the team works by, each a card with
 * what's there and the way to the tool that edits it, plus the ceremony
 * times and the whole charter as Markdown.
 */
export function TeamCharter() {
  const members = useTeamRoster();
  const storedAgreement = useWorkspaceStore((s) =>
    (s.workingAgreements ?? []).find((d) => d.id === WA_ID)
  );
  // Read as the Working Agreement page reads it (consent as agreedBy, an
  // old agent's never-published "version 1" as version 0).
  const agreement = useMemo(
    () => (storedAgreement ? normalizeAgreement(storedAgreement) : undefined),
    [storedAgreement]
  );
  // The workspace DoD, or the DoD builder's old blob until it has moved in
  // (a team that opens the charter first moves it from here).
  const { doc: dod } = useDefinitionOfDone();
  const dor = useRefinementStore(useShallow((s) => ({ criteria: s.criteria, history: s.history })));
  const estimation = useEstimationGuideStore(
    useShallow((s) => ({
      selectedScale: s.selectedScale,
      descriptions: s.descriptions,
      examples: s.examples,
      referenceStoryIds: s.referenceStoryIds,
    }))
  );
  // Refinement checks and DoD ticks live on the stories, and the guide pins
  // stories by id: those cards read the workspace's stories. The DoD card
  // reports on the latest completed sprint.
  const stories = useWorkspaceStore((s) => s.stories ?? NO_STORIES);
  const sprints = useWorkspaceStore((s) => s.sprints ?? NO_SPRINTS);
  // The guide's store waits to be asked (its page merges a shared link first).
  useEffect(() => {
    void useEstimationGuideStore.persist.rehydrate();
  }, []);
  const [cadence, updateCadence] = useCeremonyCadence();
  const [today] = useState(() => todayIso());

  const docs = useMemo<CharterDocs>(
    () => ({ members, cadence, agreement, dod, dor, estimation, stories, sprints }),
    [members, cadence, agreement, dod, dor, estimation, stories, sprints]
  );
  const cards = useMemo(() => charterCards(docs), [docs]);
  const markdown = useMemo(() => charterMarkdown(docs, today), [docs, today]);

  return (
    <div className="space-y-4">
      <SectionCard
        title="Team charter"
        icon={ScrollText}
        actions={
          <ExportButton filename="team-charter" markdown={markdown} clipboardText={markdown} />
        }
      >
        <p className="mb-3 text-sm text-sub">
          The agreements the team works by, each kept in its own tool. Export copies the whole
          charter as one document.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Charter documents">
          {cards.map((card) => {
            const tool = getToolById(card.toolId);
            const Icon = tool?.icon;
            return (
              <li
                key={card.id}
                data-charter={card.id}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border bg-card p-3",
                  card.empty ? "border-dashed border-border" : "border-border"
                )}
              >
                <div className="flex items-center gap-2">
                  {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
                  <h3 className="text-sm font-semibold text-text">{card.title}</h3>
                </div>
                <p className={cn("text-sm", card.empty ? "text-sub" : "text-text")}>
                  {card.status}
                </p>
                {card.detail && <p className="text-xs text-sub">{card.detail}</p>}
                {card.references && (
                  <ul aria-label="Reference stories by card" className="space-y-0.5 pt-0.5">
                    {card.references.map((ref) => (
                      <li key={ref.value} className="flex items-baseline gap-2 text-xs">
                        <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-text">
                          <span className="sr-only">Card </span>
                          {ref.value}
                        </span>
                        <span className="min-w-0 break-words text-sub">
                          {ref.stories.map((s, i) => (
                            <Fragment key={s.id}>
                              {i > 0 && "; "}
                              <Link
                                href={card.href}
                                className="text-accent underline-offset-2 hover:underline"
                              >
                                {s.title}
                              </Link>
                              {s.drift && <span className="text-warning"> ({s.drift})</span>}
                            </Fragment>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  href={card.href}
                  className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-accent hover:underline"
                >
                  {card.empty ? "Write it" : "Open"}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard title="Ceremony times" icon={CalendarClock}>
        <p className="mb-4 text-sm text-sub">
          When the Daily Scrum, Planning, Review, Retro and Refinement happen. The Sprint Cockpit
          uses them for &ldquo;next ceremony&rdquo;.
        </p>
        <CadenceForm cadence={cadence} onChange={updateCadence} />
      </SectionCard>
    </div>
  );
}
