import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { JOBS } from "@/lib/constants/jobs";
import { getToolById } from "@/lib/constants/tools";

/**
 * "What do you need to do?" — eight common jobs, each leading to the tool
 * that fits best, with alternatives and when to pick them.
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
          return (
            <li
              key={job.id}
              className="panel group relative flex flex-col gap-2 p-4 transition-[transform,box-shadow] hover:-translate-x-px hover:-translate-y-px hover:shadow-xl"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
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
                  <summary className="cursor-pointer select-none hover:text-text">
                    Other options
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {job.alternatives.map((alt) => {
                      const tool = getToolById(alt.toolId);
                      if (!tool) return null;
                      return (
                        <li key={alt.toolId}>
                          <Link
                            href={tool.path}
                            className="font-medium text-text hover:text-accent"
                          >
                            {tool.name}
                          </Link>{" "}
                          — when {alt.pickWhen}
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
