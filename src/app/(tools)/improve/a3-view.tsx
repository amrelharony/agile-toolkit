"use client";

/**
 * An A3 on one screen, phone first, a card per section in the order the
 * thinking goes: why it matters, where we are, where we want to be, why it
 * happens, what we'll change, did it work, and what's next. Under it, the
 * checks of what's still missing before it can be called done (no AI: each
 * line clears as its field is filled).
 *
 * Ask Amr suggests countermeasures from the cause, through Root Cause's own
 * task. Several can be added (an A3 has several rows), each with Undo, its
 * check landing in the row's "expect". Example A3s show no AI buttons.
 */

import { useId, useRef, useState } from "react";
import {
  CircleAlert,
  ClipboardCheck,
  Crosshair,
  Flag,
  HelpCircle,
  ListChecks,
  MapPin,
  Search,
  Wrench,
} from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { SectionCard } from "@/components/shared/section-card";
import { countermeasureTask } from "@/lib/ai/tasks/root-cause.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { a3CountermeasureInput } from "@/lib/improve/ai-input";
import { a3Gaps, type StepDone } from "@/lib/improve/model";
import {
  TOOL_TEXT_MAX,
  type Improvement,
  type RootCauseAnalysis,
} from "@/lib/stores/workspace-types";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AnalysisLink } from "./analysis-link";
import { ConditionFields, FieldLabel, ItemStatusSelect } from "./fields";
import { Readings } from "./readings";
import { StepList } from "./step-list";
import type { ItemActions } from "./use-item-actions";

function CountermeasureIdeas({
  item,
  analysis,
  actions,
}: {
  item: Improvement;
  analysis: RootCauseAnalysis | undefined;
  actions: ItemActions;
}) {
  const askRef = useRef<HTMLDivElement>(null);
  const announce = useAnnounce();
  const [suggested, setSuggested] = useState<{
    items: { text: string; check: string }[];
    source: AiSource;
  } | null>(null);
  const input = a3CountermeasureInput(item, analysis);
  return (
    <div className="space-y-2">
      <div ref={askRef}>
        <AiButton
          task={countermeasureTask}
          input={() =>
            input ?? { problem: item.title, rootCause: item.title, whys: [], causes: [] }
          }
          disabledReason={input ? null : "Write why it happens first."}
          label="Ask Amr for countermeasures"
          fallbackLabel="Ideas without AI"
          onResult={(data, meta) => {
            setSuggested({ items: data.countermeasures, source: meta.source });
            const n = data.countermeasures.length;
            announce(
              `${n} possible ${n === 1 ? "countermeasure" : "countermeasures"} below. Add the ones that fit.`
            );
          }}
        />
      </div>
      {suggested && suggested.items.length > 0 && (
        <AiSuggestions
          items={suggested.items}
          source={suggested.source}
          title="Possible countermeasures"
          acceptLabel="Add"
          render={(c) => ({ title: c.text, detail: `Check: ${c.check}` })}
          onAccept={(c) => {
            actions.addStep({ text: c.text, expect: c.check }, { fromAi: true });
          }}
          onDismiss={() => setSuggested(null)}
          returnFocus={() => askRef.current?.querySelector<HTMLElement>("button")}
        />
      )}
    </div>
  );
}

export function A3View({
  item,
  analyses,
  done,
  actions,
}: {
  item: Improvement;
  analyses: readonly RootCauseAnalysis[];
  done: StepDone;
  actions: ItemActions;
}) {
  const ids = useId();
  const linked = item.rootCauseId ? analyses.find((a) => a.id === item.rootCauseId) : undefined;
  const gaps = a3Gaps(item, { analysis: linked, done });

  return (
    <div className="space-y-4">
      <SectionCard title="1. Why it matters" icon={HelpCircle}>
        <FieldLabel htmlFor={`${ids}-why`}>Why this matters now, and to whom</FieldLabel>
        <BlurTextarea
          id={`${ids}-why`}
          rows={3}
          value={item.background}
          maxLength={TOOL_TEXT_MAX.text}
          placeholder="What it costs the team or its users while it stays as it is."
          onCommit={(text) => actions.setText("background", text)}
        />
      </SectionCard>

      <SectionCard title="2. Where we are" icon={MapPin}>
        <ConditionFields
          condition={item.current}
          wordsLabel="Where things stand today"
          wordsPlaceholder="Releases wait about six days after merge."
          dateLabel="As of"
          onChange={(patch) => actions.setCondition("current", patch)}
        />
      </SectionCard>

      <SectionCard title="3. Where we want to be" icon={Crosshair}>
        <ConditionFields
          condition={item.target}
          wordsLabel="Where you want things to be"
          wordsPlaceholder="Most changes reach production the day after merge."
          dateLabel="By when"
          onChange={(patch) => actions.setCondition("target", patch)}
        />
      </SectionCard>

      <SectionCard title="4. Why it happens" icon={Search}>
        <div className="space-y-3">
          <div>
            <FieldLabel htmlFor={`${ids}-cause`}>The cause, in a sentence or two</FieldLabel>
            <BlurTextarea
              id={`${ids}-cause`}
              rows={3}
              value={item.analysis ?? ""}
              maxLength={TOOL_TEXT_MAX.text}
              placeholder="Write it here, or link a Root Cause analysis below."
              onCommit={(text) => actions.setText("analysis", text)}
            />
          </div>
          <AnalysisLink item={item} analyses={analyses} actions={actions} />
        </div>
      </SectionCard>

      <SectionCard title="5. What we'll change" icon={Wrench}>
        <StepList
          item={item}
          done={done}
          actions={actions}
          heading="Countermeasures"
          ai={
            actions.example ? undefined : (
              <CountermeasureIdeas item={item} analysis={linked} actions={actions} />
            )
          }
        />
      </SectionCard>

      <SectionCard title="6. Did it work?" icon={ClipboardCheck}>
        <div className="space-y-4">
          <Readings item={item} actions={actions} />
          <div>
            <FieldLabel htmlFor={`${ids}-check`}>What the check showed</FieldLabel>
            <BlurTextarea
              id={`${ids}-check`}
              rows={3}
              value={item.check ?? ""}
              maxLength={TOOL_TEXT_MAX.text}
              placeholder="Once the countermeasures are done: what the new readings say."
              onCommit={(text) => actions.setText("check", text)}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="7. What's next" icon={Flag}>
        <div className="space-y-3">
          <div>
            <FieldLabel htmlFor={`${ids}-next`}>What happens next</FieldLabel>
            <BlurTextarea
              id={`${ids}-next`}
              rows={2}
              value={item.followUp ?? ""}
              maxLength={TOOL_TEXT_MAX.text}
              placeholder="Keep it, spread it to other teams, or try something else."
              onCommit={(text) => actions.setText("followUp", text)}
            />
          </div>
          <ItemStatusSelect value={item.status} onChange={actions.setStatus} />
        </div>
      </SectionCard>

      <section
        aria-labelledby={`${ids}-gaps`}
        className="space-y-2 rounded-lg border border-border bg-card px-4 py-3"
      >
        <h3 id={`${ids}-gaps`} className="flex items-center gap-2 text-sm font-semibold text-text">
          <ListChecks className="h-4 w-4 text-accent" aria-hidden="true" />
          Before you call it done
        </h3>
        {gaps.length === 0 ? (
          <p className="text-sm text-success">Nothing is missing: every check is met.</p>
        ) : (
          <ul className="space-y-1" aria-label="What's still missing">
            {gaps.map((g) => (
              <li key={g.id} className="flex items-start gap-2 text-sm text-text">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                {g.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
