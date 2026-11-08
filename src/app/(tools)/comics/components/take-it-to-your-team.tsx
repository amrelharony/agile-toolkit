import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { thankSomeoneHref } from "@/lib/comics/entry";
import { toolForStory } from "@/lib/comics/try-tool";
import { DiscussInRetro } from "./story-actions";

/**
 * Under a story's notes: its question for the team's retro, its "Try it this
 * week" line when it has one, a tool for the story's theme when it has one,
 * and, for a book episode, a kudos for the habit on the episode's printed card. Not a client component: only the retro button
 * is, and it gets the number and the question, nothing else.
 */
export function TakeItToYourTeam({
  ep,
  question,
  themes,
  tryTool = null,
  tryAction = null,
  kudos = false,
}: {
  ep: number;
  question: string;
  themes: readonly string[];
  /** The story's own choice from the portal, over its theme's. */
  tryTool?: string | null;
  /** One small thing to do this week (migration 0035). */
  tryAction?: string | null;
  /** A book episode, which has a printed kudos card to open. */
  kudos?: boolean;
}) {
  const tool = toolForStory(tryTool, themes);
  return (
    <section aria-labelledby="take-it-heading">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
          <h2 id="take-it-heading" className="font-display font-semibold text-text">
            Take it to your team
          </h2>
          <div className="flex flex-wrap gap-2">
            <DiscussInRetro ep={ep} question={question} />
            {kudos ? (
              <Button asChild variant="outline">
                <Link href={thankSomeoneHref(ep)} prefetch={false}>
                  <HeartHandshake aria-hidden="true" />
                  Thank someone for this habit
                </Link>
              </Button>
            ) : null}
          </div>
          {tryAction ? (
            <div>
              <h3 className="font-medium text-text">Try it this week</h3>
              <p className="mt-1 text-sub">{tryAction}</p>
            </div>
          ) : null}
          {tool ? (
            <p className="text-sm text-sub">
              Try this with your team:{" "}
              <Link href={tool.path} className="font-medium text-accent underline">
                {tool.name}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
