import type { Metadata } from "next";
import Link from "@/components/motion/transition-link";
import { ArrowRight, Search } from "lucide-react";
import { getToolById } from "@/lib/constants/tools";
import { SITE_METADATA } from "@/lib/seo/site-metadata";
import { InkArt } from "@/components/ink/ink-art";
import { InkHighlight } from "@/components/ink/ink-highlight";
import { NOT_FOUND_SCENE } from "@/lib/ink/drawings/scenes/not-found";

// Served for every unknown address, so it names none: the site's "./"
// canonical and og:url would otherwise say /_not-found, its build path.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
  alternates: { canonical: null },
  openGraph: { ...SITE_METADATA.openGraph, url: undefined },
};

const POPULAR = [
  "retro",
  "planning-poker",
  "prioritizer",
  "capacity-planner",
  "okrs",
  "health-check",
];

/**
 * Branded 404 inside the normal app shell (sidebar, header and search stay
 * available). Next's default page rendered its own black screen, which
 * clashed with the light and high-contrast themes and offered no way on.
 * A server component, so the inked map (a dotted path that wanders off into a
 * question mark) is in the HTML and costs no JavaScript.
 */
export default function NotFound() {
  const tools = POPULAR.map((id) => getToolById(id)).filter((t): t is NonNullable<typeof t> =>
    Boolean(t)
  );
  return (
    <div className="container-tool ink-host py-12 sm:py-16 lg:flex lg:items-start lg:gap-10">
      <InkArt
        drawing={NOT_FOUND_SCENE}
        boil
        pace={1600}
        className="mb-6 aspect-[16/10] w-full max-w-sm lg:order-2 lg:mb-0 lg:mt-6 lg:max-w-md"
      />
      <div className="max-w-2xl lg:flex-1">
        <p className="text-sm font-medium text-accent">
          <InkHighlight mark="circle" delay={1500}>
            404
          </InkHighlight>
        </p>
        <h1 className="mt-2 font-display text-fluid-h2 font-bold text-text">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-3 text-fluid-body text-sub">
          The link may be old, or the tool may have moved. Search every tool with{" "}
          <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-xs text-text">
            Ctrl K
          </kbd>{" "}
          (<kbd className="font-mono text-xs">⌘K</kbd> on a Mac), or pick one of these:
        </p>

        {/* grid-cols-1 (a minmax(0,1fr) track) so the truncated descriptions
            clip on phones; an implicit auto track grew to their full width. */}
        <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {tools.map((tool) => (
            <li key={tool.id}>
              <Link
                href={tool.path}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-accent/40 hover:bg-accent/5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-text group-hover:text-accent">
                    {tool.name}
                  </span>
                  <span className="block truncate text-xs text-sub">{tool.description}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Browse all tools
        </Link>
      </div>
    </div>
  );
}
