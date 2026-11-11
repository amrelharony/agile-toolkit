"use client";

import Link from "@/components/motion/transition-link";
import { getSectionForTool } from "@/lib/constants/sections";
import { getToolById } from "@/lib/constants/tools";
import { SECTION_TONE } from "@/lib/ink/drawings/section-tone";
import { getVisibleTools, isShelved, isVipOnly } from "@/lib/tools/catalog";
import { useToolVisibility } from "@/lib/tools/use-visible-tools";
import { ToneIcon } from "@/components/ink/tone-icon";

const MAX_RELATED = 4;

/**
 * "More in <section>" under a tool: the next few tools for the same job.
 *
 * Each tool used to be a dead end — the only way on was back to the home
 * grid. Starting after the current tool (and wrapping) gives neighbouring
 * pages different suggestions instead of the same first four. Tools on the
 * "More tools" shelf are skipped — unless the current tool is shelved too,
 * because then its neighbours are what the visitor came for. VIP tools are
 * never suggested here and don't suggest anything themselves. Each icon sits on
 * the section's wash, as on the home cards.
 */
export function RelatedTools({ toolId }: { toolId: string }) {
  const { byId: visible } = useToolVisibility();
  const section = getSectionForTool(toolId);
  if (!section) return null;

  const current = getToolById(toolId);
  if (current && isVipOnly(current)) return null;
  const pool =
    current && isShelved(current) ? new Map(getVisibleTools(true).map((t) => [t.id, t])) : visible;
  const at = section.toolIds.indexOf(toolId);
  const order = [...section.toolIds.slice(at + 1), ...section.toolIds.slice(0, at)];
  const related = order
    .flatMap((id) => pool.get(id) ?? [])
    .filter((tool) => !isVipOnly(tool))
    .slice(0, MAX_RELATED);
  if (related.length === 0) return null;
  const tone = SECTION_TONE[section.id];

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
              {/* Not a panel, so no frame: the next tool's header grows from
                  this tile's spot instead, and the tile still loads ahead. */}
              <Link
                href={tool.path}
                frame="spot"
                className="flex h-full items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {tone ? (
                  <ToneIcon tone={tone} seedKey={tool.id} className="-mt-0.5 h-6 w-6">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </ToneIcon>
                ) : (
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                )}
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
