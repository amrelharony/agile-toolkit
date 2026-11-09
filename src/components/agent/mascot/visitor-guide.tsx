"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, KeyRound, MessageCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getToolById, getToolByPath } from "@/lib/constants/tools";
import { searchTools } from "@/lib/search/tool-search";
import { useLlmUiStore } from "@/lib/stores/llm-ui-store";
import { JOBS } from "@/lib/constants/jobs";
import { isVipHidden } from "@/lib/tools/catalog";
import { getGuide, type ToolGuide } from "@/lib/tools/guides";
import { useVipHint } from "@/lib/vip/use-vip-hint";
import { useMascotStore } from "@/lib/agent/mascot/store";

/** A search with no match, left alone this long, gets a shrug from Amr. */
const SHRUG_AFTER_MS = 900;

/** Common jobs, shown before the visitor types anything (same list as the home page). */
const STARTERS = JOBS.map((job) => ({ label: job.title, toolId: job.primaryToolId }));

/** The current tool's "How this works" guide, loaded on demand. */
function useToolGuide(toolId: string | undefined): ToolGuide | null {
  const [guide, setGuide] = useState<ToolGuide | null>(null);
  useEffect(() => {
    setGuide(null);
    if (!toolId) return;
    let cancelled = false;
    void getGuide(toolId).then((g) => {
      if (!cancelled) setGuide(g ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [toolId]);
  return guide;
}

/**
 * What the mascot's panel shows a visitor.
 *
 * The agent chat is the owner's (it runs on the owner's server key), so a
 * visitor's panel helps them find the right tool instead: a task search, how
 * to run the current tool's method (its guide), and the bring-your-own-key AI
 * settings that power every tool's built-in prompts. It makes no network
 * requests.
 *
 * With visitor AI on, VisitorPanel passes `onAskAmr`: the guide then offers to
 * hand the search to Amr's AI ("Ask Amr about '…'", under the results and when
 * nothing matches) and a "Chat with Amr" link. Those only call back; the guide
 * itself still sends nothing.
 */
export function VisitorGuide({
  onNavigate,
  onAskAmr,
}: {
  onNavigate?: () => void;
  /** Ask Amr's AI instead (visitor AI on); `query` may be empty. */
  onAskAmr?: (query: string) => void;
}) {
  const pathname = usePathname();
  const vip = useVipHint();
  const onPath = pathname ? getToolByPath(pathname) : undefined;
  // Same rule as the menus: a lock panel, or a tool not released yet, goes unnamed.
  const current = onPath && !isVipHidden(onPath, vip) ? onPath : undefined;
  const guide = useToolGuide(current?.id);
  const openSettings = useLlmUiStore((s) => s.openSettings);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed ? searchTools(trimmed, 6) : []), [trimmed]);
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`;

  // Amr shrugs at a search that finds nothing, once the visitor stops typing.
  const noMatch = trimmed.length > 0 && results.length === 0;
  useEffect(() => {
    if (!noMatch) return;
    const id = setTimeout(() => useMascotStore.getState().queueReaction("shrug"), SHRUG_AFTER_MS);
    return () => clearTimeout(id);
  }, [noMatch, trimmed]);
  // Picking a tool: "you've got this".
  const chose = () => {
    useMascotStore.getState().queueReaction("cheer");
    onNavigate?.();
  };

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
          <p className="mt-0.5 text-sm text-sub">{guide?.summary ?? current.description}</p>
          {guide && (
            <>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-sub">
                How to run it
              </p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-text">
                {guide.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}
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
            placeholder="e.g. run a retro, prioritize a backlog"
            className="pl-9"
            autoComplete="off"
          />
        </div>
        {trimmed ? (
          results.length > 0 ? (
            <>
              <ul className="flex flex-col gap-1" aria-label="Matching tools">
                {results.map((tool) => (
                  <li key={tool.id}>
                    <ToolLink
                      href={tool.path}
                      title={tool.name}
                      subtitle={tool.description}
                      onNavigate={chose}
                    />
                  </li>
                ))}
              </ul>
              {onAskAmr && <AskAmrButton query={trimmed} onAskAmr={onAskAmr} />}
            </>
          ) : (
            <>
              <p className="text-sm text-sub" role="status">
                No tools match “{trimmed}”. Try a task like “retro” or “estimate”, or a method like
                “OKR” or “WSJF”.
              </p>
              {onAskAmr && <AskAmrButton query={trimmed} onAskAmr={onAskAmr} />}
            </>
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
                    onNavigate={chose}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {onAskAmr && (
          <button
            type="button"
            onClick={() => onAskAmr("")}
            className="flex items-center gap-1.5 self-start text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Chat with Amr
          </button>
        )}
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

/** Hand the visitor's search to Amr's AI. */
function AskAmrButton({ query, onAskAmr }: { query: string; onAskAmr: (query: string) => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      onClick={() => onAskAmr(query)}
    >
      <MessageCircle aria-hidden="true" />
      Ask Amr about “{query.length > 40 ? `${query.slice(0, 39)}…` : query}”
    </Button>
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
