"use client";

import { useState } from "react";
import { ArrowRight, MessageCircleQuestion, RotateCcw } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { CastCard } from "@/lib/vip/cast";
import {
  closestColleague,
  type ColleaguePicks,
  type WhichColleagueGame,
} from "@/lib/vip/which-colleague";
import { CastCardView } from "../meet-the-cast/cast-card";

/**
 * A short game for a team: answer about this week, see the colleague your answers
 * sit closest to, talk about the habit, pass the phone on. Everything lives in
 * this component's state, so a reload forgets it and no score leaves the page.
 */
export function WhichColleagueClient({
  game,
  cast,
}: {
  game: WhichColleagueGame;
  cast: readonly CastCard[];
}) {
  const announce = useAnnounce();
  const { questions } = game;
  const [index, setIndex] = useState<number | null>(null);
  const [picks, setPicks] = useState<ColleaguePicks>({});
  /** Who has come up so far this round, with no names of the people playing. */
  const [round, setRound] = useState<string[]>([]);

  const finished = index === questions.length;
  const closest = finished ? closestColleague(questions, picks) : null;
  const card = cast.find((c) => c.name === closest);
  const question = index !== null && !finished ? questions[index] : null;

  const answer = (answerId: string) => {
    if (index === null || !question) return;
    const next = { ...picks, [question.id]: answerId };
    setPicks(next);
    setIndex(index + 1);
    if (index + 1 === questions.length) {
      const name = closestColleague(questions, next);
      if (name) {
        setRound((r) => [...r, name]);
        announce(`${game.resultLead} ${name}.`);
      }
    }
  };

  const nextPerson = () => {
    setPicks({});
    setIndex(0);
  };

  const startAgain = () => {
    setPicks({});
    setRound([]);
    setIndex(null);
  };

  return (
    <ToolPageWrapper
      title="Which Colleague Are You?"
      description="A short team game that starts a conversation about everyday work habits."
    >
      <div className="space-y-4">
        {index === null ? (
          <SectionCard title="How it works" icon={MessageCircleQuestion}>
            <p className="text-sm text-text">{game.intro}</p>
            <Button type="button" className="mt-4 gap-1" onClick={() => setIndex(0)}>
              Start
              <ArrowRight aria-hidden="true" />
            </Button>
          </SectionCard>
        ) : null}

        {question && index !== null ? (
          <fieldset className="space-y-3">
            <legend className="mb-3 space-y-1">
              <span className="block text-xs font-semibold uppercase tracking-wider text-sub">
                Question {index + 1} of {questions.length}
              </span>
              <span className="block font-display text-lg font-semibold text-text">
                {question.prompt}
              </span>
            </legend>
            <ul className="grid list-none gap-2 sm:grid-cols-2">
              {question.answers.map((option) => (
                <li key={option.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-full min-h-11 w-full justify-start whitespace-normal text-left"
                    onClick={() => answer(option.id)}
                  >
                    {option.text}
                  </Button>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        {finished && card ? (
          <div className="space-y-4">
            <p className="font-display text-lg font-semibold text-text">
              {game.resultLead} {card.name}
            </p>
            <CastCardView card={card} />
            <p className="text-sm text-sub">{game.dignityNote}</p>
            <SectionCard title="Talk about it" icon={MessageCircleQuestion}>
              <p className="text-sm text-text">{game.discussion}</p>
            </SectionCard>
            {round.length > 1 ? (
              <p className="text-sm text-sub">So far this round: {round.join(", ")}.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="gap-1" onClick={nextPerson}>
                Next person
                <ArrowRight aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" className="gap-1" onClick={startAgain}>
                <RotateCcw aria-hidden="true" />
                Start over
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </ToolPageWrapper>
  );
}
