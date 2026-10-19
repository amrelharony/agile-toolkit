"use client";

import Link from "next/link";
import { getSectionForTool } from "@/lib/constants/sections";
import { getVisibleTools } from "@/lib/tools/catalog";

const MAX_RELATED = 4;

/**
 * "More in <section>" under a tool: the next few tools for the same job.
 *
 * Each tool used to be a dead end — the only way on was back to the home
 * grid. Starting after the current tool (and wrapping) gives neighbouring
 * pages different suggestions instead of the same first four.
 */
export function RelatedTools({ toolId }: { toolId: string }) {
  const section = getSectionForTool(toolId);
  if (!section) return null;

  const visible = new Map(getVisibleTools().map((t) => [t.id, t]));
  const at = section.toolIds.indexOf(toolId);
  const order = [...section.toolIds.slice(at + 1), ...section.toolIds.slice(0, at)];
  const related = order.flatMap((id) => visible.get(id) ?? []).slice(0, MAX_RELATED);
  if (related.length === 0) return null;

  return (
    <nav
      data-chrome="related"
      aria-labelledby="related-tools-heading"
      className="mt-10 border-t border-border pt-6"
    >
      <h2 id="related-tools-heading" className="mb-3 text-sm font-semibold text-text">
        More in {section.label}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {related.map((tool) => {
          const Icon = tool.icon;
          return (
            <li key={tool.id}>
              <Link
                href={tool.path}
                className="flex h-full items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">{tool.name}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-sub">
                    {tool.description}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
