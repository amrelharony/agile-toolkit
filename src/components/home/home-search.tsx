"use client";

import { useId, useMemo, useState } from "react";
import Link from "@/components/motion/transition-link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ToolDefinition } from "@/lib/constants/tools";
import { isShelved } from "@/lib/tools/catalog";
import { useToolVisibility } from "@/lib/tools/use-visible-tools";
import { searchTools } from "@/lib/search/tool-search";

function ResultLink({ tool }: { tool: ToolDefinition }) {
  const Icon = tool.icon;
  return (
    <Link
      href={tool.path}
      className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none"
    >
      <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text">{tool.name}</span>
        <span className="block truncate text-xs text-sub">{tool.description}</span>
      </span>
    </Link>
  );
}

/**
 * Inline tool search on the home page — the same synonym-aware ranking as
 * the Ctrl/Cmd+K palette, without having to know the shortcut. Hits from the
 * "More tools" shelf are listed under their own heading unless the visitor
 * has turned "Show all tools" on.
 */
export function HomeSearch() {
  const [query, setQuery] = useState("");
  const id = useId();
  const { showAll } = useToolVisibility();
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed ? searchTools(trimmed, 6) : []), [trimmed]);
  const main = showAll ? results : results.filter((t) => !isShelved(t));
  const shelved = showAll ? [] : results.filter(isShelved);

  return (
    <div className="relative w-full max-w-xl">
      <label htmlFor={id} className="sr-only">
        Search tools
      </label>
      <Search
        className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-sub md:top-2.5"
        aria-hidden="true"
      />
      <Input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tools — try “retro”, “estimate” or “prioritise”"
        className="pl-9"
        autoComplete="off"
        aria-controls={trimmed ? `${id}-results` : undefined}
      />
      {trimmed && (
        <div
          id={`${id}-results`}
          className="panel mt-2 p-1"
          role="region"
          aria-label="Search results"
          aria-live="polite"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-sub">
              No tools match “{trimmed}”. Try a task (retro, estimate) or a method (OKR, WSJF).
            </p>
          ) : (
            <>
              {main.length > 0 && (
                <ul>
                  {main.map((tool) => (
                    <li key={tool.id}>
                      <ResultLink tool={tool} />
                    </li>
                  ))}
                </ul>
              )}
              {shelved.length > 0 && (
                <div className={main.length > 0 ? "mt-1 border-t border-border pt-1" : undefined}>
                  <p className="px-3 pb-1 pt-1.5 text-xs text-sub">
                    <Link href="/more-tools" className="font-medium hover:text-accent">
                      More tools
                    </Link>{" "}
                    — off the main navigation
                  </p>
                  <ul>
                    {shelved.map((tool) => (
                      <li key={tool.id}>
                        <ResultLink tool={tool} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
