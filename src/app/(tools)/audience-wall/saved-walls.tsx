"use client";

/**
 * The saved walls: each one's prompt, kind and posts (threads, Answered,
 * 25/10 averages), as a list, a word cloud or the top ten. Per wall:
 * export it, delete it (with Undo), and three helpers that draft and wait
 * for the host to accept: themes, duplicates to merge, and backlog items
 * (sent through the backlog-story hand-off, with Undo). Amr drafts them
 * when he can; the word rules draft them when he can't. Each Undo takes
 * back its own change only, never a later one. A draft is checked against
 * the wall when it comes and then stays as it is: what the host accepts
 * leaves the list, the rest keep their places.
 */

import { useId, useRef, useState } from "react";
import { nanoid } from "nanoid";
import Link from "next/link";
import { BookCheck, ChevronDown, Cloud, List, Tags, Trash2, Trophy, X } from "lucide-react";
import { AiButton, AiSuggestions } from "@/components/ai";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { AiSource } from "@/lib/ai/task-types";
import {
  aiPosts,
  cleanMerges,
  cleanThemes,
  clusterTask,
  mergeQuestionsTask,
  toBacklogTask,
  type BacklogOutput,
  type ClusterOutput,
  type MergeOutput,
} from "@/lib/ai/tasks/audience-wall";
import {
  WALL_KIND_LABEL,
  isScored,
  mergeSessionPosts,
  rankedPosts,
  repliesByPost,
  sentKey,
  topTen,
  unmergeSessionPosts,
  wallCounts,
  withThemes,
  type WallSession,
  type WallSessionPost,
} from "@/lib/audience-wall/model";
import { readWalls, updateWall, updateWalls } from "@/lib/audience-wall/store";
import { sendHandoff } from "@/lib/handoffs/send";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { AUDIENCE_WALL_ACTIONS } from "@/lib/history/event-actions";
import { isExampleId } from "@/lib/utils/example-id";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { wallFilename, wallMarkdown } from "./markdown";
import { WordCloud } from "./word-cloud";

type Log = (action: string, payload?: Record<string, unknown>) => void;

const short = (text: string, max = 48) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function average(p: WallSessionPost): string {
  if (!p.scorers) return "not scored";
  const avg = Math.round(((p.score ?? 0) / p.scorers) * 10) / 10;
  return `${avg} average, ${plural(p.scorers, "score")}`;
}

export function SavedWalls({
  sessions,
  log,
  onEmptied,
}: {
  sessions: readonly WallSession[];
  log: Log;
  /** The last wall was deleted: the page puts focus somewhere sensible. */
  onEmptied?: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  /** After a delete: the next wall's Open button, or the one before, or the page's choice. */
  const focusAfterDelete = (index: number) => {
    window.setTimeout(() => {
      const opens = listRef.current?.querySelectorAll<HTMLElement>("[data-wall-open]");
      const target = opens?.[index] ?? opens?.[index - 1];
      if (target) target.focus();
      else onEmptied?.();
    }, 0);
  };
  return (
    <ul ref={listRef} className="space-y-3" aria-label="Saved walls">
      {sessions.map((s, i) => (
        <li key={s.id}>
          <WallCard session={s} log={log} onDeleted={() => focusAfterDelete(i)} />
        </li>
      ))}
    </ul>
  );
}

type View = "posts" | "cloud" | "top";

function WallCard({
  session,
  log,
  onDeleted,
}: {
  session: WallSession;
  log: Log;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("posts");
  const bodyId = useId();
  const c = wallCounts(session);
  const scored = isScored(session);
  const example = isExampleId(session.id);
  const shownView: View = view === "top" && !scored ? "posts" : view;

  const remove = () => {
    removeWithUndo<WallSession>({
      label: `Deleted the wall “${short(session.prompt, 40)}”`,
      update: updateWalls,
      match: (s) => s.id === session.id,
    });
    if (!example) log(AUDIENCE_WALL_ACTIONS.WALL_REMOVED, { kind: session.kind, posts: c.posts });
    onDeleted();
  };

  return (
    <article className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-56 space-y-1">
          <h3 className="break-words text-base font-semibold text-text">{session.prompt}</h3>
          <p className="text-xs text-sub">
            {WALL_KIND_LABEL[session.kind]} · {dayLabel(session.savedAt)} ·{" "}
            {plural(c.posts, "post")}
            {c.answered > 0 ? ` · ${c.answered} answered` : ""}
            {c.replies > 0 ? ` · ${plural(c.replies, "Yes, and…", "Yes, and…s")}` : ""}
            {session.source === "manual" ? " · typed in" : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            aria-expanded={open}
            aria-controls={bodyId}
            data-wall-open=""
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
            {open ? "Close" : "Open"}
            <span className="sr-only">: {short(session.prompt)}</span>
          </Button>
          <ExportButton
            filename={wallFilename(session)}
            markdown={wallMarkdown(session)}
            context={short(session.prompt)}
          />
          <IconButton
            label={`Delete the wall “${short(session.prompt)}”`}
            icon={<Trash2 className="h-4 w-4" />}
            className="text-sub hover:text-danger"
            onClick={remove}
          />
        </div>
      </div>

      {open && (
        <div id={bodyId} className="space-y-4">
          <div role="group" aria-label="Show the wall as" className="flex flex-wrap gap-2">
            <ViewButton current={shownView} value="posts" onPick={setView} icon={List}>
              Posts
            </ViewButton>
            <ViewButton current={shownView} value="cloud" onPick={setView} icon={Cloud}>
              Word cloud
            </ViewButton>
            {scored && (
              <ViewButton current={shownView} value="top" onPick={setView} icon={Trophy}>
                Top ten
              </ViewButton>
            )}
          </div>

          {shownView === "posts" && <PostList session={session} />}
          {shownView === "cloud" && (
            <WordCloud
              texts={session.posts.map((p) => p.text)}
              label={`Word cloud of “${short(session.prompt)}”`}
            />
          )}
          {shownView === "top" && <TopTenList session={session} />}

          <Themes session={session} log={log} />
          <Duplicates session={session} />
          <ToBacklog session={session} log={log} canSend={!example} />
        </div>
      )}
    </article>
  );
}

function ViewButton({
  current,
  value,
  onPick,
  icon: Icon,
  children,
}: {
  current: View;
  value: View;
  onPick: (v: View) => void;
  icon: typeof List;
  children: string;
}) {
  const on = current === value;
  return (
    <Button
      type="button"
      variant={on ? "toolkit" : "outline"}
      size="sm"
      className="gap-1.5"
      aria-pressed={on}
      onClick={() => onPick(value)}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </Button>
  );
}

/** The posts best first, each "Yes, and…" under the post it builds on. */
function PostList({ session }: { session: WallSession }) {
  const scored = isScored(session);
  const replies = repliesByPost(session);
  const ids = new Set(session.posts.map((p) => p.id));
  const top = rankedPosts(session).filter((p) => !(p.re && ids.has(p.re)));
  if (top.length === 0) return <p className="text-sm text-sub">No posts on this wall.</p>;
  const line = (p: WallSessionPost, reply: boolean) => (
    <li key={p.id} className="space-y-1 rounded-lg border border-border bg-surface-deep/50 p-2.5">
      {reply && <p className="text-xs font-medium text-accent">Yes, and…</p>}
      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-text sm:flex-1">
          {p.text}
        </p>
        <span className="text-xs text-sub sm:shrink-0">
          {scored && !reply ? average(p) : plural(p.votes, "vote")}
        </span>
      </div>
      {p.answered && <p className="text-xs font-medium text-success">Answered</p>}
      {p.merged.length > 0 && (
        <ul className="space-y-0.5 border-l-2 border-border pl-2 text-xs text-sub">
          {p.merged.map((t, i) => (
            <li key={`${p.id}-m${i}`} className="break-words">
              {t}
            </li>
          ))}
        </ul>
      )}
      {(replies.get(p.id) ?? []).length > 0 && (
        <ol className="space-y-1.5 border-l-2 border-accent/30 pl-2">
          {(replies.get(p.id) ?? []).map((r) => line(r, true))}
        </ol>
      )}
    </li>
  );
  return <ol className="space-y-2">{top.map((p) => line(p, false))}</ol>;
}

function TopTenList({ session }: { session: WallSession }) {
  const top = topTen(session);
  if (top.length === 0) return <p className="text-sm text-sub">Nobody scored a post.</p>;
  return (
    <ol className="space-y-1.5" aria-label="Top ten">
      {top.map((p, i) => (
        <li key={p.id} className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="w-6 shrink-0 text-right font-data text-sub">{i + 1}.</span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
            <span className="min-w-0 break-words text-text sm:flex-1">{p.text}</span>
            <span className="text-xs text-sub sm:shrink-0">{average(p)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The posts Amr reads: the most upvoted that fit, by this wall's own ids. */
function postsForAi(session: WallSession) {
  return aiPosts(session.posts);
}

function LeftOut({ left, shown }: { left: number; shown: number }) {
  if (left <= 0) return null;
  return (
    <p className="text-xs text-sub">
      Amr reads the {shown} most upvoted posts; {left} more are left out.
    </p>
  );
}

/** Themes: Amr's (or the shared words') groups, each added by the host, with Undo. */
function Themes({ session, log }: { session: WallSession; log: Log }) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState<{ themes: ClusterOutput["themes"]; source: AiSource } | null>(
    null
  );
  const known = new Set(session.posts.map((p) => p.id));
  const textOf = (id: string) => session.posts.find((p) => p.id === id)?.text ?? "";
  const forAi = postsForAi(session);
  const taken = new Set(session.themes.flatMap((t) => t.postIds));
  /** Themes against the wall as it is: its own posts, none already in a theme. */
  const freeThemes = (themes: ClusterOutput["themes"]) =>
    cleanThemes(
      themes.map((t) => ({ ...t, postIds: t.postIds.filter((id) => !taken.has(id)) })),
      known
    );
  const example = isExampleId(session.id);
  const groupRef = useRef<HTMLDivElement>(null);

  const addThemes = (accepted: ClusterOutput["themes"]) => {
    // The wall may have moved on since the draft came (a merge, a cleared theme).
    const themes = freeThemes(accepted);
    if (themes.length === 0) {
      announce(
        accepted.length === 1
          ? "Its posts are in a theme already."
          : "Their posts are in a theme already."
      );
      return;
    }
    // Each accepted theme gets its own id: Undo takes back these, and only these.
    const added = themes.map((t) => ({ ...t, id: `t_${nanoid(8)}` }));
    const ids = new Set(added.map((t) => t.id));
    undoable({
      label:
        themes.length === 1
          ? `Added the theme “${short(themes[0].name, 30)}”`
          : `Added ${themes.length} themes`,
      kind: "success",
      apply: () => updateWall(session.id, (s) => withThemes(s, [...s.themes, ...added])),
      revert: () =>
        updateWall(session.id, (s) =>
          withThemes(
            s,
            s.themes.filter((t) => !t.id || !ids.has(t.id))
          )
        ),
    });
    if (!example) log(AUDIENCE_WALL_ACTIONS.THEMES_ACCEPTED, { themes: themes.length });
  };

  const clearThemes = () => {
    const kept = session.themes;
    undoable({
      label: "Cleared the themes",
      apply: () => updateWall(session.id, (s) => withThemes(s, [])),
      // Themes added since stay first: the cleared ones get back the posts still free.
      revert: () => updateWall(session.id, (s) => withThemes(s, [...s.themes, ...kept])),
    });
    // The button goes with the themes: focus the one that groups them again.
    window.setTimeout(() => groupRef.current?.querySelector<HTMLElement>("button")?.focus(), 0);
  };

  return (
    <section aria-label="Themes" className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <Tags className="h-4 w-4 text-accent" aria-hidden="true" />
        Themes
      </h4>
      {session.themes.length > 0 ? (
        <>
          <ul className="space-y-2">
            {session.themes.map((t, i) => (
              <li key={t.id ?? `${i}-${t.name}`} className="space-y-1">
                <p className="text-sm font-medium text-text">
                  {t.name}{" "}
                  <span className="text-xs font-normal text-sub">
                    ({plural(t.postIds.length, "post")})
                  </span>
                </p>
                <ul className="space-y-0.5 border-l-2 border-border pl-2 text-xs text-sub">
                  {t.postIds.map((id) => (
                    <li key={id} className="break-words">
                      {textOf(id)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={clearThemes}>
            <X className="h-4 w-4" aria-hidden="true" />
            Clear themes
          </Button>
        </>
      ) : (
        <p className="text-xs text-sub">
          No themes yet. Group the posts to see what keeps coming up.
        </p>
      )}
      <div ref={groupRef}>
        <AiButton
          task={clusterTask}
          label="Group into themes"
          fallbackLabel="Group by shared words"
          disabledReason={session.posts.length < 2 ? "A wall needs two posts or more." : null}
          input={() => ({
            prompt: session.prompt,
            posts: forAi.posts.map((p) => ({ id: p.id, text: p.text })),
          })}
          onResult={(data, meta) => {
            const themes = freeThemes(data.themes);
            setDraft({ themes, source: meta.source });
            announce(
              themes.length === 0
                ? "Every post is in a theme already."
                : `${plural(themes.length, "theme")} to review.`
            );
          }}
        />
      </div>
      <LeftOut left={forAi.left} shown={forAi.posts.length} />
      {draft && draft.themes.length === 0 && (
        <p role="status" className="text-sm text-sub">
          Every post is in a theme already.
        </p>
      )}
      {draft && draft.themes.length > 0 && (
        <AiSuggestions
          items={draft.themes}
          source={draft.source}
          title="Themes to add"
          render={(t) => {
            const ids = t.postIds.filter((id) => known.has(id));
            return {
              title: t.name,
              detail: `${plural(ids.length, "post")}: ${ids
                .slice(0, 3)
                .map((id) => short(textOf(id), 40))
                .join(" · ")}${ids.length > 3 ? " · …" : ""}`,
            };
          }}
          onAccept={(t) => addThemes([t])}
          onAcceptAll={(all) => addThemes(all)}
          onDismiss={() => setDraft(null)}
          returnFocus={() => groupRef.current?.querySelector<HTMLElement>("button")}
        />
      )}
    </section>
  );
}

/** Duplicates: merge each group into the post that stays, with Undo. */
function Duplicates({ session }: { session: WallSession }) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState<{ groups: MergeOutput["groups"]; source: AiSource } | null>(
    null
  );
  const known = new Set(session.posts.map((p) => p.id));
  const textOf = (id: string) => session.posts.find((p) => p.id === id)?.text ?? "";
  const forAi = postsForAi(session);
  const askRef = useRef<HTMLDivElement>(null);

  const merge = (accepted: MergeOutput["groups"][number]) => {
    // The posts that are still on the wall (another merge may have taken some).
    const [g] = cleanMerges([accepted], known);
    if (!g) {
      announce("Those posts are merged already.");
      return;
    }
    const before = readWalls().find((s) => s.id === session.id);
    if (!before) return;
    undoable({
      label: `Merged ${plural(g.merge.length, "post")} into “${short(textOf(g.keep), 30)}”`,
      apply: () =>
        updateWall(session.id, (s) =>
          g.merge.reduce((acc, id) => mergeSessionPosts(acc, id, g.keep), s)
        ),
      // This group's posts come back; other merges, themes and sent items stay.
      revert: () => updateWall(session.id, (s) => unmergeSessionPosts(s, before, g.keep, g.merge)),
    });
  };

  return (
    <section aria-label="Duplicates" className="space-y-2">
      <div ref={askRef}>
        <AiButton
          task={mergeQuestionsTask}
          label="Find duplicates"
          fallbackLabel="Find duplicates without AI"
          variant="outline"
          disabledReason={session.posts.length < 2 ? "A wall needs two posts or more." : null}
          input={() => ({ posts: forAi.posts.map((p) => ({ id: p.id, text: p.text })) })}
          onResult={(data, meta) => {
            const found = cleanMerges(data.groups, known);
            setDraft({ groups: found, source: meta.source });
            announce(
              found.length === 0
                ? "No duplicates found."
                : `${plural(found.length, "group")} of duplicates to review.`
            );
          }}
        />
      </div>
      {draft && draft.groups.length === 0 && (
        <p role="status" className="text-sm text-sub">
          No duplicates on this wall.
        </p>
      )}
      {draft && draft.groups.length > 0 && (
        <AiSuggestions
          items={draft.groups}
          source={draft.source}
          title="Duplicates to merge"
          acceptLabel="Merge"
          render={(g) => ({
            title: `Keep: ${short(textOf(g.keep), 60)}`,
            detail: `Merge in: ${g.merge.map((id) => short(textOf(id), 40)).join(" · ")}${
              g.reason ? `. ${g.reason}` : ""
            }`,
          })}
          onAccept={(g) => merge(g)}
          onDismiss={() => setDraft(null)}
          returnFocus={() => askRef.current?.querySelector<HTMLElement>("button")}
        />
      )}
    </section>
  );
}

/** Backlog items from the wall's feedback, each sent by the host through the hand-off. */
function ToBacklog({
  session,
  log,
  canSend,
}: {
  session: WallSession;
  log: Log;
  canSend: boolean;
}) {
  const announce = useAnnounce();
  const [draft, setDraft] = useState<{ items: BacklogOutput["items"]; source: AiSource } | null>(
    null
  );
  const forAi = aiPosts(session.posts);
  const sent = canSend ? session.sent.filter((x) => liveLink(x.sentTo, "backlog-story")) : [];
  const sentKeys = new Set(sent.map((x) => x.key));
  const askRef = useRef<HTMLDivElement>(null);
  /** Drafted items not on the backlog yet, each once (two titles can be one item). */
  const unsent = (items: BacklogOutput["items"]) => {
    const seen = new Set(sentKeys);
    return items.filter((i) => {
      const key = sentKey(i.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const send = (item: BacklogOutput["items"][number]) => {
    const key = sentKey(item.title);
    if (sentKeys.has(key)) {
      announce("That one is on the backlog already.");
      return;
    }
    updateWall(session.id, (s) =>
      s.sent.some((x) => x.key === key)
        ? s
        : { ...s, sent: [...s.sent, { key, title: item.title, sentTo: [] }] }
    );
    const link = sendHandoff(
      "backlog-story",
      {
        title: item.title,
        description: item.description,
        sourceRef: { tool: "audience-wall", id: session.id },
      },
      {
        getLinks: () =>
          readWalls()
            .find((s) => s.id === session.id)
            ?.sent.find((x) => x.key === key)?.sentTo,
        setLinks: (update) =>
          updateWall(session.id, (s) => ({
            ...s,
            sent: s.sent.map((x) => (x.key === key ? { ...x, sentTo: update(x.sentTo) } : x)),
          })),
      }
    );
    if (link) log(AUDIENCE_WALL_ACTIONS.ITEMS_SENT, { count: 1 });
  };

  return (
    <section aria-label="Backlog items" className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <BookCheck className="h-4 w-4 text-accent" aria-hidden="true" />
        To the backlog
      </h4>
      {!canSend ? (
        <p className="text-xs text-sub">
          The example&apos;s feedback doesn&apos;t go to your backlog.
        </p>
      ) : (
        <>
          <div ref={askRef}>
            <AiButton
              task={toBacklogTask}
              label="Draft backlog items"
              fallbackLabel="Draft items without AI"
              variant="outline"
              disabledReason={session.posts.length === 0 ? "This wall has no posts." : null}
              input={() => ({
                prompt: session.prompt,
                posts: forAi.posts.map((p) => ({ text: p.text, votes: p.votes })),
              })}
              onResult={(data, meta) => {
                const items = unsent(data.items);
                setDraft({ items, source: meta.source });
                announce(
                  items.length === 0
                    ? "Everything drafted is on the backlog already."
                    : `${plural(items.length, "item")} to review.`
                );
              }}
            />
          </div>
          <LeftOut left={forAi.left} shown={forAi.posts.length} />
          {draft && draft.items.length === 0 && (
            <p role="status" className="text-sm text-sub">
              Everything drafted is on the backlog already.
            </p>
          )}
          {draft && draft.items.length > 0 && (
            <AiSuggestions
              items={draft.items}
              source={draft.source}
              title="Backlog items to add"
              acceptLabel="Add to backlog"
              render={(i) => ({ title: i.title, detail: i.description || undefined })}
              onAccept={(i) => send(i)}
              onDismiss={() => setDraft(null)}
              returnFocus={() => askRef.current?.querySelector<HTMLElement>("button")}
            />
          )}
        </>
      )}
      {sent.length > 0 && (
        <ul className="space-y-0.5" aria-label="Sent to the backlog">
          {sent.map((x) => {
            const link = liveLink(x.sentTo, "backlog-story")!;
            return (
              <li key={x.key}>
                <Link
                  href={getHandoffRoute("backlog-story").targetHref(link.targetId)}
                  className="min-touch-coarse inline-flex items-center gap-1 py-1 text-xs text-success underline-offset-2 hover:underline"
                >
                  <BookCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  On the backlog: “{short(x.title, 60)}”
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
