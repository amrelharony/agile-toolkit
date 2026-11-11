"use client";

import { forwardRef, useEffect, useState } from "react";
import Link from "@/components/motion/transition-link";
import { motion } from "framer-motion";
import { CalendarCheck, Clock, History, Play, Star, Tag, Users, Zap } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useReturnFocus } from "@/hooks/use-return-focus";
import type { IceBreaker } from "@/lib/constants/icebreakers";
import type { DockedTimer } from "@/lib/timer/dock-timer";
import { CATEGORY_COLORS, ENERGY_COLORS } from "../labels";
import { peopleLabel } from "../sizes";
import { validateUseDay, type UseDraft } from "../uses";
import { DockClock } from "./dock-clock";
import { FavoriteToggle } from "./favorite-toggle";

/**
 * The activity on screen: how to run it, its time-box on the docked timer,
 * and "Mark as used" for a warm-up run without the timer (backdatable).
 *
 * Only Start depends on the dock: a warm-up that opens a meeting timed by
 * the Ceremony Timer is still marked as used here, or the "used recently"
 * memory would miss exactly those.
 */
export const FeaturedCard = forwardRef<
  HTMLHeadingElement,
  {
    icebreaker: IceBreaker;
    isFavorite: boolean;
    onToggleFavorite: (id: string) => void;
    /** "Used 3 days ago", when it was used in the last two weeks. */
    usedText: string | null;
    /** The dock's countdown when it is timing this activity. */
    ownTimer: DockedTimer | null;
    /** Another page's timer holding the dock, which this page never replaces. */
    otherTimer: DockedTimer | null;
    /** The label of this page's clock for another activity, which Start replaces. */
    replacesTimer: string | null;
    today: string;
    onStartTimer: () => void;
    onStopTimer: () => void;
    onMarkUsed: (usedAt: string) => void;
  }
>(function FeaturedCard(
  {
    icebreaker,
    isFavorite,
    onToggleFavorite,
    usedText,
    ownTimer,
    otherTimer,
    replacesTimer,
    today,
    onStartTimer,
    onStopTimer,
    onMarkUsed,
  },
  headingRef
) {
  const [marking, setMarking] = useState(false);
  // Start, Stop and the form's buttons each unmount the control that was
  // pressed: focus moves to the one that took its place, not the page body.
  const { refFor, returnTo } = useReturnFocus();
  const closeForm = () => {
    setMarking(false);
    returnTo("mark");
  };

  return (
    <motion.div
      key={icebreaker.id}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Card className="bg-card border-accent-cyan/30 shadow-neon-cyan">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 shrink-0 text-accent" aria-hidden="true" />
                <CardTitle
                  as="h2"
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-xl font-bold text-text text-glow-cyan focus-visible:outline-none"
                >
                  {icebreaker.name}
                </CardTitle>
              </div>
              <CardDescription className="text-sub text-sm">
                {icebreaker.description}
              </CardDescription>
            </div>
            <FavoriteToggle
              name={icebreaker.name}
              isFavorite={isFavorite}
              onToggle={() => onToggleFavorite(icebreaker.id)}
              size="lg"
              className="p-2 -m-2"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-accent uppercase tracking-wider">
              Instructions
            </h3>
            <p className="text-sm text-sub leading-relaxed">{icebreaker.instructions}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={CATEGORY_COLORS[icebreaker.category]}>
              <Tag className="w-3 h-3 mr-1" aria-hidden="true" />
              {icebreaker.category}
            </Badge>
            <Badge variant="outline" className="bg-card-hover text-sub border-border">
              <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
              {icebreaker.timeMinutes} minutes
            </Badge>
            <Badge variant="outline" className="bg-card-hover text-sub border-border">
              <Users className="w-3 h-3 mr-1" aria-hidden="true" />
              {peopleLabel(icebreaker)}
            </Badge>
            <Badge variant="outline" className={ENERGY_COLORS[icebreaker.energyLevel]}>
              <Zap className="w-3 h-3 mr-1" aria-hidden="true" />
              {icebreaker.energyLevel} energy
            </Badge>
            {usedText && (
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                <History className="w-3 h-3 mr-1" aria-hidden="true" />
                {usedText}
              </Badge>
            )}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            {ownTimer ? (
              <DockClock
                timer={ownTimer}
                controlRef={refFor("clock")}
                onStop={() => {
                  returnTo("start");
                  onStopTimer();
                }}
              />
            ) : (
              <>
                {otherTimer && (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-sub" role="status">
                    The {otherTimer.label} timer is running, so this one can&apos;t start yet; you
                    can still mark it as used.
                    <Link
                      href={otherTimer.href}
                      className="text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                    >
                      Open the {otherTimer.label} timer
                    </Link>
                  </p>
                )}
                {/* With the dock busy and the form open, nothing is left to show here. */}
                {(!otherTimer || !marking) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {!otherTimer && (
                      <Button
                        ref={refFor("start")}
                        type="button"
                        className="gap-1"
                        onClick={() => {
                          returnTo("clock");
                          onStartTimer();
                        }}
                      >
                        <Play aria-hidden="true" />
                        Start {icebreaker.timeMinutes}-min timer
                      </Button>
                    )}
                    {!marking && (
                      <Button
                        ref={refFor("mark")}
                        type="button"
                        variant="outline"
                        className="gap-1"
                        onClick={() => setMarking(true)}
                      >
                        <CalendarCheck aria-hidden="true" />
                        Mark as used
                      </Button>
                    )}
                    {!otherTimer && replacesTimer && (
                      <span className="text-xs text-sub">Replaces the {replacesTimer} timer.</span>
                    )}
                  </div>
                )}
              </>
            )}
            {marking && !ownTimer && (
              <MarkUsedForm
                today={today}
                onSave={(usedAt) => {
                  closeForm();
                  onMarkUsed(usedAt);
                }}
                onCancel={closeForm}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
});

/**
 * "Used on [day]": today unless changed, never in the future, and never a
 * day `isTaken` says the activity already has a use on.
 */
export function MarkUsedForm({
  today,
  initialDay = today,
  submitLabel = "Record use",
  isTaken,
  onSave,
  onCancel,
}: {
  today: string;
  initialDay?: string;
  submitLabel?: string;
  /** Whether the activity already has another use on `usedAt`'s day. */
  isTaken?: (usedAt: string) => boolean;
  onSave: (usedAt: string) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<UseDraft, { usedAt: string }, "day">({
    initial: { day: initialDay },
    validate: (d) => {
      const v = validateUseDay(d, today);
      return v.ok && isTaken?.(v.values.usedAt)
        ? { ok: false, errors: { day: "It's already recorded for that day." } }
        : v;
    },
    onSave: (v) => onSave(v.usedAt),
    resetOnSave: false,
  });
  const { formRef } = form;
  // Opened by a click: the day is what there is to change.
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel={submitLabel} onCancel={onCancel}>
      <Field label="Used on" error={form.errors.day} required className="max-w-xs">
        {(props) => (
          <Input
            {...props}
            type="date"
            max={today}
            value={form.draft.day}
            onChange={(e) => form.update({ day: e.target.value })}
          />
        )}
      </Field>
    </ItemForm>
  );
}
