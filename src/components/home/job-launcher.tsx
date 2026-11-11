import Link from "@/components/motion/transition-link";
import { ArrowRight } from "lucide-react";
import { JOBS } from "@/lib/constants/jobs";
import { getSectionForTool } from "@/lib/constants/sections";
import { getToolById } from "@/lib/constants/tools";
import { SECTION_TONE } from "@/lib/ink/drawings/section-tone";
import { cn } from "@/lib/utils";
import { TOUCH_ROW, TOUCH_ROW_LINK } from "@/components/ui/touch-target";
import { ToneIcon } from "@/components/ink/tone-icon";

/**
 * "What do you need to do?" — eight common jobs, each leading to the tool
 * that fits best, with alternatives and when to pick them. The tool's icon sits
 * on its section's wash, as it does on the tool cards further down.
 */
export function JobLauncher() {
  return (
    <section aria-labelledby="jobs-heading" className="space-y-4">
      <h2 id="jobs-heading" className="font-display text-lg font-semibold text-text">
        What do you need to do?
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {JOBS.map((job) => {
          const primary = getToolById(job.primaryToolId);
          if (!primary) return null;
          const Icon = primary.icon;
          const section = getSectionForTool(primary.id);
          const tone = section ? SECTION_TONE[section.id] : undefined;
          return (
            <li
              key={job.id}
              className="panel group relative flex flex-col gap-2 p-4 transition-[transform,box-shadow] hover:-translate-x-px hover:-translate-y-px hover:shadow-xl"
            >
              <div className="flex items-center gap-2">
                {tone ? (
                  <ToneIcon tone={tone} seedKey={primary.id} className="-my-1 h-7 w-7">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </ToneIcon>
                ) : (
                  <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                )}
                <h3 className="text-sm font-semibold text-text">
                  <Link
                    href={primary.path}
                    className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent"
                  >
                    {job.title}
                  </Link>
                </h3>
              </div>
              <p className="text-sm text-sub">{job.description}</p>
              <p className="flex items-center gap-1 text-xs font-medium text-accent">
                {primary.name}
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </p>
              {job.alternatives.length > 0 && (
                <details className="relative z-10 mt-auto text-xs text-sub">
                  {/* The card around it is one stretched link, so a thumb that
                      misses this 16px line opens the main tool instead. On
                      touch the padding makes it 44px tall and the negative
                      margin takes most of that back out of the layout; the
                      details' z-10 keeps the whole area above the card link. */}
                  <summary className="cursor-pointer select-none hover:text-text pointer-coarse:-my-2 pointer-coarse:py-3.5">
                    Other options
                  </summary>
                  <ul className="mt-2 space-y-1.5 pointer-coarse:space-y-0">
                    {job.alternatives.map((alt) => {
                      const tool = getToolById(alt.toolId);
                      if (!tool) return null;
                      return (
                        // On touch each option is a 44px row that opens the
                        // tool anywhere on it; the sentence inside reads as before.
                        <li
                          key={alt.toolId}
                          className={cn(
                            TOUCH_ROW,
                            "pointer-coarse:flex pointer-coarse:items-center"
                          )}
                        >
                          <span>
                            <Link
                              href={tool.path}
                              className={cn(
                                "font-medium text-text hover:text-accent",
                                TOUCH_ROW_LINK
                              )}
                            >
                              {tool.name}
                            </Link>{" "}
                            — when {alt.pickWhen}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
