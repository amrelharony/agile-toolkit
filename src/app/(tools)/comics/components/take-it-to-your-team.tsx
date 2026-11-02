import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { toolForThemes } from "@/lib/comics/try-tool";
import { DiscussInRetro } from "./story-actions";

/**
 * Under a story's notes: its question for the team's retro, and a tool for the
 * story's theme when it has one. Not a client component: only the retro button
 * is, and it gets the number and the question, nothing else.
 */
export function TakeItToYourTeam({
  ep,
  question,
  themes,
}: {
  ep: number;
  question: string;
  themes: readonly string[];
}) {
  const tool = toolForThemes(themes);
  return (
    <section aria-labelledby="take-it-heading">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
          <h2 id="take-it-heading" className="font-display font-semibold text-text">
            Take it to your team
          </h2>
          <DiscussInRetro ep={ep} question={question} />
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
