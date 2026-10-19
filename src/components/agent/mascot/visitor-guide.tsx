"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getToolById, getToolByPath } from "@/lib/constants/tools";
import { searchTools } from "@/lib/search/tool-search";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";

/** Common jobs, shown before the visitor types anything. */
const STARTERS: { label: string; toolId: string }[] = [
  { label: "Run a retro", toolId: "retro" },
  { label: "Estimate stories", toolId: "planning-poker" },
  { label: "Prioritise a backlog", toolId: "prioritizer" },
  { label: "Plan sprint capacity", toolId: "capacity-planner" },
  { label: "Check team health", toolId: "health-check" },
  { label: "Track sprint progress", toolId: "burndown" },
];

/**
 * What the mascot's panel shows a visitor.
 *
 * The agent chat is the owner's (it runs on the owner's server key), so a
 * visitor's panel helps them find the right tool instead: a task search, a
 * reminder of what the current tool is for, and the bring-your-own-key AI
 * settings that power every tool's built-in prompts. It makes no network
 * requests.
 */
export function VisitorGuide({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const current = pathname ? getToolByPath(pathname) : undefined;
  const openSettings = useLlmUiStore((s) => s.openSettings);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed ? searchTools(trimmed, 6) : []), [trimmed]);
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`;

  return (
    <div
      data-testid="mascot-visitor-guide"
      className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-3"
    >
      {current && (
        <section
          aria-label="This tool"
          className="rounded-lg border border-border bg-card px-3 py-2.5"
        >
          <p className="text-xs text-sub">You&apos;re in</p>
          <p className="text-sm font-semibold text-text">{current.name}</p>
          <p className="mt-0.5 text-sm text-sub">{current.description}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <label htmlFor="mascot-tool-search" className="text-sm font-medium text-text">
          What do you need to do?
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sub"
            aria-hidden="true"
          />
          <Input
            id="mascot-tool-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. run a retro, prioritise a backlog"
            className="pl-9"
            autoComplete="off"
          />
        </div>
        {trimmed ? (
          results.length > 0 ? (
            <ul className="flex flex-col gap-1" aria-label="Matching tools">
              {results.map((tool) => (
                <li key={tool.id}>
                  <ToolLink
                    href={tool.path}
                    title={tool.name}
                    subtitle={tool.description}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-sub" role="status">
              No tools match “{trimmed}”. Try a task like “retro” or “estimate”, or a method like
              “OKR” or “WSJF”.
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Popular tasks">
            {STARTERS.map((s) => {
              const tool = getToolById(s.toolId);
              if (!tool) return null;
              return (
                <li key={s.toolId}>
                  <ToolLink
                    href={tool.path}
                    title={s.label}
                    subtitle={tool.name}
                    onNavigate={onNavigate}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-xs text-sub">
          Each tool&apos;s AI prompts can run with your own API key. The key stays in this browser.
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="toolkit"
            size="sm"
            onClick={() => {
              onNavigate?.();
              openSettings();
            }}
          >
            <KeyRound aria-hidden="true" />
            AI settings
          </Button>
          <Link
            href={signInHref}
            onClick={onNavigate}
            className="text-xs text-sub underline-offset-2 hover:text-text hover:underline"
          >
            Owner sign in
          </Link>
        </div>
      </section>
    </div>
  );
}

function ToolLink({
  href,
  title,
  subtitle,
  onNavigate,
}: {
  href: string;
  title: string;
  subtitle: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent/10 focus-visible:bg-accent/10"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text group-hover:text-accent">{title}</span>
        <span className="block truncate text-xs text-sub">{subtitle}</span>
      </span>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-sub group-hover:text-accent"
        aria-hidden="true"
      />
    </Link>
  );
}
