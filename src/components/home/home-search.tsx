"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchTools } from "@/lib/search/tool-search";

/**
 * Inline tool search on the home page — the same synonym-aware ranking as
 * the Ctrl/Cmd+K palette, without having to know the shortcut.
 */
export function HomeSearch() {
  const [query, setQuery] = useState("");
  const id = useId();
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed ? searchTools(trimmed, 6) : []), [trimmed]);

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
          className="mt-2 rounded-lg border border-border bg-card p-1 shadow-lg"
          role="region"
          aria-label="Search results"
          aria-live="polite"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-sub">
              No tools match “{trimmed}”. Try a task (retro, estimate) or a method (OKR, WSJF).
            </p>
          ) : (
            <ul>
              {results.map((tool) => {
                const Icon = tool.icon;
                return (
                  <li key={tool.id}>
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
