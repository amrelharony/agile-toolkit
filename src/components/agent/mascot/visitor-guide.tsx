"use client";

import { useEffect, useMemo, useState, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, KeyRound, MessageCircle, Search } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
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

/** How long typing has to stop before the match count is read out. */
export const SEARCH_ANNOUNCE_MS = 450;

/**
 * At most this many results. With Amr's AI on, one fewer, so the two-line
 * rows leave the Ask button and the first rows in a phone's view of the panel.
 */
export const RESULTS_CAP = 6;
export const RESULTS_CAP_WITH_AI = 5;

/** The results list; Enter in the search moves focus to its first link. */
const RESULTS_ID = "mascot-tool-results";

/** Common jobs, shown before the visitor types anything (same list as the home page). */
const STARTERS = JOBS.map((job) => ({ label: job.title, toolId: job.primaryToolId }));

/** What the announcer says once typing stops: plain words, no dashes. */
export function matchCountNote(count: number, query: string): string {
  if (count === 0) return `No tools match “${query}”`;
  return count === 1 ? "1 tool matches" : `${count} tools match`;
}

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
 * The search is a `role=search` form. Enter (the phone keyboard's Search key)
 * moves focus to the first result, which drops the keyboard and lets a screen
 * reader read the tool's name; with no match it does nothing. The match count
 * is read out through the app's one announcer once typing stops, so the guide
 * mounts no live region of its own. Escape in a non-empty search clears it
 * and stops there (`preventDefault`, which the panel's own Escape respects);
 * only an empty search lets Escape close the panel. An input method's Escape
 * is left to it.
 *
 * With visitor AI on, VisitorPanel passes `onAskAmr`: the guide then offers to
 * hand the search to Amr's AI ("Ask Amr about '…'", under the results and when
 * nothing matches) and a "Chat with Amr" link. Those only call back; the guide
 * itself still sends nothing.
 */
export function VisitorGuide({
  onNavigate,
  onAskAmr,
  guideRef,
  note,
  initialQuery,
}: {
  onNavigate?: () => void;
  /** Ask Amr's AI instead (visitor AI on); `query` may be empty. */
  onAskAmr?: (query: string) => void;
  /** The guide's wrapper, so VisitorPanel can move focus to it. */
  guideRef?: Ref<HTMLDivElement>;
  /**
   * Shown above the search, inside the guide's own scroll area: in a short
   * panel it scrolls away with the guide and takes no height from it.
   */
  note?: ReactNode;
  /**
   * The search to start with, such as the question a visitor took to the
   * consent card or the chat and came back from. It is not read out again.
   */
  initialQuery?: string;
}) {
  const pathname = usePathname();
  const vip = useVipHint();
  const onPath = pathname ? getToolByPath(pathname) : undefined;
  // Same rule as the menus: a lock panel, or a tool not released yet, goes unnamed.
  const current = onPath && !isVipHidden(onPath, vip) ? onPath : undefined;
  const guide = useToolGuide(current?.id);
  const openSettings = useLlmUiStore((s) => s.openSettings);
  const announce = useAnnounce();
  const [query, setQuery] = useState(initialQuery ?? "");
  const trimmed = query.trim();
  const cap = onAskAmr ? RESULTS_CAP_WITH_AI : RESULTS_CAP;
  const results = useMemo(() => (trimmed ? searchTools(trimmed, cap) : []), [trimmed, cap]);
  // Only what the visitor types is read out: a search the guide opened with
  // (coming back from the consent card) was theirs already.
  const [typed, setTyped] = useState(false);
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(pathname || "/")}`;

  // Amr shrugs at a search that finds nothing, once the visitor stops typing.
  const noMatch = trimmed.length > 0 && results.length === 0;
  useEffect(() => {
    if (!noMatch) return;
    const id = setTimeout(() => useMascotStore.getState().queueReaction("shrug"), SHRUG_AFTER_MS);
    return () => clearTimeout(id);
  }, [noMatch, trimmed]);

  // The count, once typing stops. One polite line through the app's
  // announcer; each key press starts the wait again.
  const count = results.length;
  useEffect(() => {
    if (!typed || !trimmed) return;
    const id = setTimeout(() => announce(matchCountNote(count, trimmed)), SEARCH_ANNOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed, trimmed, count, announce]);

  // Picking a tool: "you've got this".
  const chose = () => {
    useMascotStore.getState().queueReaction("cheer");
    onNavigate?.();
  };

  return (
    // Focusable from code only (tabIndex -1): coming back from the consent
    // card or the chat, focus lands here, not on the search box, which would
    // open a phone's keyboard.
    <div
      ref={guideRef}
      tabIndex={-1}
      data-testid="mascot-visitor-guide"
      className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-3 focus:outline-none"
    >
      {note}
      {/* The search comes first. A phone shows about 360 px of this panel, and
          the current tool's "How to run it" list alone is longer than that, so
          the search used to sit two to four screens down. Results show right
          under the field; the common jobs follow the tool's own card. */}
      <section className="flex flex-col gap-2">
        <form
          role="search"
          aria-label="Find a tool"
          // Enter (or the keyboard's Search key): on to the first result. A
          // link is not a text field, so a phone's keyboard closes and the
          // results show. With no match, focus stays in the box to try again.
          onSubmit={(e) => {
            e.preventDefault();
            e.currentTarget.ownerDocument
              .getElementById(RESULTS_ID)
              ?.querySelector<HTMLAnchorElement>("a[href]")
              ?.focus();
          }}
          className="flex flex-col gap-2"
        >
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
              dir="auto"
              enterKeyHint="search"
              value={query}
              onChange={(e) => {
                setTyped(true);
                setQuery(e.target.value);
              }}
              // Escape clears a search first; only an empty one lets the
              // panel close. An input method's Escape cancels its
              // composition, nothing else.
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (!query) return;
                e.preventDefault();
                setQuery("");
              }}
              placeholder="e.g. run a retro, prioritize a backlog"
              className="pl-9"
              autoComplete="off"
            />
          </div>
        </form>
        {trimmed &&
          (results.length > 0 ? (
            <>
              <ul id={RESULTS_ID} className="flex flex-col gap-1" aria-label="Matching tools">
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
              {/* Not a live region: the announcer reads the count once typing
                  stops, so this is never said twice. */}
              <p className="text-sm text-sub">
                No tools match “<bdi>{trimmed}</bdi>”. Try a task like “retro” or “estimate”, or a
                method like “OKR” or “WSJF”.
              </p>
              {onAskAmr && <AskAmrButton query={trimmed} onAskAmr={onAskAmr} />}
            </>
          ))}
      </section>

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

      {!trimmed && (
        <section className="flex flex-col gap-1">
          <p
            id="mascot-popular-tasks"
            className="text-xs font-semibold uppercase tracking-wide text-sub"
          >
            Popular tasks
          </p>
          <ul className="flex flex-col gap-1" aria-labelledby="mascot-popular-tasks">
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
        </section>
      )}

      <section className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        {onAskAmr && (
          <button
            type="button"
            onClick={() => onAskAmr("")}
            className="min-touch-coarse flex items-center gap-1.5 self-start text-sm font-medium text-accent underline-offset-2 hover:underline"
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
            className="pointer-coarse:min-h-11"
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
            className="min-touch-coarse inline-flex items-center justify-end text-xs text-sub underline-offset-2 hover:text-text hover:underline"
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
      // The label holds up to 40 characters of the search, wider than the
      // panel on one line: it wraps inside the button instead. Size "sm"
      // still gives it 44 px on touch.
      className="h-auto max-w-full self-start whitespace-normal py-1.5 text-left [overflow-wrap:anywhere] md-fine:h-auto"
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
