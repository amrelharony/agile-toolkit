"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Trophy, Lock, Crown, Flag, Users, Activity, SlidersHorizontal, X } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import {
  activeAchievements,
  achievementsByCategory,
  retiredAchievements,
} from "@/lib/gamification/achievements";
import { useVDnaStore } from "@/lib/stores/vdna-store";
import { computeLevel } from "@/lib/gamification/xp-curve";
import { prestige } from "@/lib/gamification/engine";
import {
  DAILY_POOL,
  WEEKLY_POOL,
  findDaily,
  findWeekly,
  sanitizeChallenges,
} from "@/lib/gamification/challenges";
import { fetchLeaderboard, type LeaderboardRow } from "@/lib/gamification/supabase-sync";
import type {
  Achievement,
  AchievementCategory,
  ChallengeDef,
  ChallengeProgress,
} from "@/lib/gamification/types";
import { cn } from "@/lib/utils";
import { isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import { useIsOwner } from "@/lib/auth/use-is-owner";
import { tools as toolRegistry } from "@/lib/constants/tools";

const CATEGORY_LABEL: Record<AchievementCategory, string> = {
  exploration: "Exploration",
  "tool-mastery": "Tool Mastery",
  collaboration: "Collaboration",
  flow: "Flow",
  delivery: "Delivery",
  discovery: "Discovery",
  streak: "Streaks",
  meta: "Meta",
  secret: "Secrets",
};

interface TrophyCaseProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Phones: the sheet runs the full height between Amr's bands, so he stays
 * visible whether he is parked at the bottom or docked at the top. The sheet
 * is positioned against the viewport, so the top uses `--amr-band-top-edge`
 * (header height + band; `--amr-band-top` alone is measured from the header's
 * bottom edge), and the bottom uses `--amr-band-bottom` (which includes the
 * home-indicator inset). Without a band (Amr not loaded yet, Save-Data, or
 * parked at the other end) fall back to the safe-area inset alone.
 */
export const SHEET_TOP = "var(--amr-band-top-edge, env(safe-area-inset-top, 0px))";
export const SHEET_BOTTOM = "var(--amr-band-bottom, env(safe-area-inset-bottom, 0px))";

/** The prestige alert on phones: centred between Amr's bands, never over them. */
const PHONE_ALERT_STYLE: React.CSSProperties = {
  top: `calc((${SHEET_TOP} + 100dvh - ${SHEET_BOTTOM}) / 2)`,
  maxHeight: `calc(100dvh - ${SHEET_TOP} - ${SHEET_BOTTOM} - 2rem)`,
};

/** Copy for the prestige confirmation (calm, says what stays). */
export const PRESTIGE_CONFIRM = {
  title: "Prestige?",
  description:
    "Your XP and level start again from Level 1, and each level needs 20% more XP. Badges, streaks and lifetime XP stay.",
  confirm: "Prestige",
} as const;

/**
 * The trophy case's frame: a full-height sheet on phones (below `sm`), the
 * centred dialog on larger screens. Both are modal Radix dialogs with the
 * same title and description.
 */
function TrophyFrame({
  open,
  onOpenChange,
  description,
  contentRef,
  children,
}: TrophyCaseProps & {
  description: string;
  contentRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);

  if (phone) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            data-testid="trophy-overlay"
            className="fixed inset-x-0 z-modal bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
            style={{ top: SHEET_TOP, bottom: SHEET_BOTTOM }}
          />
          <DialogPrimitive.Content
            ref={contentRef}
            data-testid="trophy-sheet"
            className="fixed inset-x-0 z-modal flex flex-col border-y border-border bg-bg shadow-lg outline-none pl-safe pr-safe data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom motion-reduce:animate-none"
            style={{ top: SHEET_TOP, bottom: SHEET_BOTTOM }}
          >
            <div className="flex items-start gap-2 border-b border-border px-4 pt-3 pb-2">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="flex items-center gap-2 text-base font-semibold text-text">
                  <Trophy className="w-5 h-5 text-accent" aria-hidden="true" />
                  Trophy Case
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-xs text-sub">
                  {description}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                aria-label="Close Trophy Case"
                className="min-touch-coarse inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-sub hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        data-testid="trophy-dialog"
        className="max-w-4xl max-h-[90dvh] overflow-y-auto bg-bg border-border"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text">
            <Trophy className="w-5 h-5 text-accent" />
            Trophy Case
          </DialogTitle>
          <DialogDescription className="text-sub">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function TrophyCase({ open, onOpenChange }: TrophyCaseProps) {
  const dna = useVDnaStore();
  const unlockedSet = useMemo(() => new Set(dna.unlocked), [dna.unlocked]);
  const info = computeLevel(dna.xp, dna.prestige);
  const groups = useMemo(() => achievementsByCategory(), []);
  // Retired badges stay with whoever holds them ("Classic badges") but
  // don't count toward the x / y totals.
  const totalUnlocked = activeAchievements.filter((a) => unlockedSet.has(a.id)).length;
  const totalAvailable = activeAchievements.length;
  const classicBadges = useMemo(
    () => retiredAchievements.filter((a) => unlockedSet.has(a.id)),
    [unlockedSet]
  );
  // The global leaderboard lives in the owner's Supabase project, so
  // sharing to it and reading it are owner-only. Visitors keep their
  // profile in this browser.
  const isOwner = useIsOwner();
  // Show the lists the engine will store: ids that left the pool dropped
  // (completed ones kept) and topped up to 3 from the same seed.
  const dailyChallenges = useMemo(
    () => sanitizeChallenges(dna.dailyChallenges, "daily"),
    [dna.dailyChallenges]
  );
  const weeklyChallenges = useMemo(
    () => sanitizeChallenges(dna.weeklyChallenges, "weekly"),
    [dna.weeklyChallenges]
  );
  const [confirmPrestige, setConfirmPrestige] = useState(false);
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);
  // After the prestige alert closes, focus goes back to the Prestige button,
  // or to the trophy case itself once prestiging has removed that button.
  const prestigeButtonRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  return (
    <TrophyFrame
      open={open}
      onOpenChange={onOpenChange}
      contentRef={frameRef}
      description={
        isOwner
          ? "Visitor DNA profile, achievements, daily & weekly challenges, and global leaderboard."
          : "Visitor DNA profile, achievements, and daily & weekly challenges — saved in this browser."
      }
    >
      {/* Profile header */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-4 pt-2">
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg border border-border bg-accent flex items-center justify-center">
              <Trophy className="w-6 h-6 text-bg" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-text">Level {info.level}</span>
                {info.atMax && (
                  <Badge variant="outline" className="border-accent/50 text-accent">
                    MAX
                  </Badge>
                )}
                {dna.prestige > 0 && (
                  <Badge className="bg-warning/20 text-warning border-warning/40 gap-1">
                    <Crown className="w-3 h-3" />
                    Prestige {dna.prestige}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-sub">
                {dna.xp.toLocaleString()} XP · {dna.lifetimeXp.toLocaleString()} lifetime
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-sub mb-1">
              <span>{info.atMax ? "Max level" : `Level ${info.level + 1} in`}</span>
              <span className="font-data">
                {info.atMax ? "—" : `${info.xpIntoLevel} / ${info.xpNeededForLevel}`}
              </span>
            </div>
            <Progress
              value={info.progress01 * 100}
              aria-label={info.atMax ? "Level progress" : `Progress to level ${info.level + 1}`}
              className="h-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div>
              <div className="text-xs text-sub uppercase tracking-wider">Streak</div>
              <div className="font-data text-xl text-accent">{dna.streak}</div>
            </div>
            <div>
              <div className="text-xs text-sub uppercase tracking-wider">Best</div>
              <div className="font-data text-xl text-text">{dna.longestStreak}</div>
            </div>
            <div>
              <div className="text-xs text-sub uppercase tracking-wider">Tools</div>
              <div className="font-data text-xl text-text">
                {dna.toolsVisited.length} / {toolRegistry.filter((t) => t.access !== "vip").length}
              </div>
            </div>
            <div>
              <div className="text-xs text-sub uppercase tracking-wider">Unlocks</div>
              <div className="font-data text-xl text-accent">
                {totalUnlocked} / {totalAvailable}
              </div>
            </div>
          </div>
          {info.atMax && (
            <Button
              ref={prestigeButtonRef}
              variant="outline"
              className="w-full border-warning/40 text-warning hover:bg-warning/10"
              onClick={() => setConfirmPrestige(true)}
            >
              <Crown className="w-4 h-4 mr-1.5" />
              Prestige (reset run, +20% XP curve)
            </Button>
          )}
          <AlertDialog
            open={confirmPrestige}
            onOpenChange={setConfirmPrestige}
            title={PRESTIGE_CONFIRM.title}
            description={PRESTIGE_CONFIRM.description}
            confirmLabel={PRESTIGE_CONFIRM.confirm}
            onConfirm={() => prestige()}
            returnFocus={() => prestigeButtonRef.current ?? frameRef.current}
            // Phones: like the sheet, the alert stays between Amr's bands.
            overlayStyle={phone ? { top: SHEET_TOP, bottom: SHEET_BOTTOM } : undefined}
            contentStyle={phone ? PHONE_ALERT_STYLE : undefined}
          />
        </div>

        {/* Settings sidebar */}
        {/* BUG-C5: associate labels with controls via htmlFor/id +
              aria-label on the two Switches, so screen readers no
              longer announce them as bare "edit text" / "switch on/off"
              with no context. */}
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <label htmlFor="trophy-display-name" className="text-xs text-sub">
              Display name
            </label>
            <Input
              id="trophy-display-name"
              value={dna.displayName ?? ""}
              onChange={(e) => useVDnaStore.getState().setDisplayName(e.target.value || undefined)}
              placeholder="Anonymous"
              className="bg-bg border-border mt-1"
              maxLength={24}
            />
          </div>
          {isOwner && (
            <div className="flex items-center justify-between gap-2">
              <div>
                <div id="trophy-share-label" className="text-xs text-text">
                  Share on leaderboard
                </div>
                <div className="text-xs text-sub">Requires Supabase env</div>
              </div>
              <Switch
                checked={dna.shareOnLeaderboard}
                onCheckedChange={(v) => useVDnaStore.getState().setShareOnLeaderboard(v)}
                aria-labelledby="trophy-share-label"
              />
            </div>
          )}
          {/* Silent mode moved to Settings › Notifications (celebration
                level, quiet hours, Focus); phones reach it from the menu too. */}
          <Link
            href="/settings/notifications"
            onClick={() => onOpenChange(false)}
            className="flex min-h-11 items-center justify-between gap-2 rounded-md py-2 text-xs text-text hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span>
              <span className="block">Notifications &amp; celebrations</span>
              <span className="block text-sub">Quiet, Balanced or Lively; quiet hours</span>
            </span>
            <SlidersHorizontal className="w-4 h-4 shrink-0" aria-hidden="true" />
          </Link>
          <div className="text-xs text-sub font-mono">ID: {dna.visitorId.slice(0, 10)}…</div>
        </div>
      </div>

      {/* Keyed on ownership so signing out while the leaderboard tab is
            selected falls back to Achievements instead of an empty panel. */}
      <Tabs key={isOwner ? "owner" : "visitor"} defaultValue="achievements" className="mt-4">
        <TabsList className="bg-surface border border-border max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="achievements" className="gap-1.5 px-2 sm:px-3">
            <Trophy className="hidden w-3.5 h-3.5 sm:inline" />
            <span className="sm:hidden">Badges</span>
            <span className="hidden sm:inline">Achievements</span>
          </TabsTrigger>
          <TabsTrigger value="challenges" className="gap-1.5 px-2 sm:px-3">
            <Flag className="hidden w-3.5 h-3.5 sm:inline" /> Challenges
          </TabsTrigger>
          {isOwner && (
            <TabsTrigger value="leaderboard" className="gap-1.5 px-2 sm:px-3">
              <Users className="hidden w-3.5 h-3.5 sm:inline" /> Leaderboard
            </TabsTrigger>
          )}
          <TabsTrigger value="activity" className="gap-1.5 px-2 sm:px-3">
            <Activity className="hidden w-3.5 h-3.5 sm:inline" /> Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="achievements" className="space-y-4 pt-4">
          {Array.from(groups.entries()).map(([cat, list]) => (
            <div key={cat}>
              <div className="text-xs uppercase tracking-wider text-sub mb-2">
                {CATEGORY_LABEL[cat as AchievementCategory] ?? cat}
                <span className="ml-2 text-accent font-data">
                  {list.filter((a) => unlockedSet.has(a.id)).length} / {list.length}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {list.map((a) => (
                  <AchievementCard key={a.id} achievement={a} unlocked={unlockedSet.has(a.id)} />
                ))}
              </div>
            </div>
          ))}
          {classicBadges.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-sub mb-1">
                Classic badges
                <span className="ml-2 text-accent font-data">{classicBadges.length}</span>
              </div>
              <p className="text-xs text-sub mb-2">
                Earned before badges moved to finished work. They&apos;re yours to keep.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {classicBadges.map((a) => (
                  <AchievementCard key={a.id} achievement={a} unlocked />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="challenges" className="space-y-4 pt-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-sub mb-2">Daily</div>
            <div className="space-y-2">
              {dailyChallenges.map((c) => (
                <ChallengeCard key={c.id} c={c} def={findDaily(c.id)} />
              ))}
              {dailyChallenges.length === 0 && (
                <div className="text-sm text-sub">
                  No challenges yet. Interact with any tool to generate today&apos;s set.
                </div>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-sub mb-2">Weekly</div>
            <div className="space-y-2">
              {weeklyChallenges.map((c) => (
                <ChallengeCard key={c.id} c={c} def={findWeekly(c.id)} />
              ))}
            </div>
          </div>
          <div className="text-xs text-sub">
            Pool: {DAILY_POOL.length} daily · {WEEKLY_POOL.length} weekly · rotates at local
            midnight / Monday.
          </div>
        </TabsContent>

        {isOwner && (
          <TabsContent value="leaderboard" className="pt-4">
            <LeaderboardTab />
          </TabsContent>
        )}

        <TabsContent value="activity" className="pt-4">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-sub mb-2">Recent XP events</div>
            {dna.recentEvents.length === 0 && (
              <div className="text-sm text-sub">No events logged yet.</div>
            )}
            {dna.recentEvents.slice(0, 25).map((e, i) => (
              <div
                key={`${e.at}-${i}`}
                data-testid="trophy-event-row"
                className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 text-xs font-data px-2 py-1 rounded border border-border bg-surface"
              >
                <span className="text-accent min-w-10">
                  +{e.amount}
                  {e.multiplier > 1 && <span className="ml-1 text-warning">×{e.multiplier}</span>}
                </span>
                <span className="min-w-0 truncate">
                  <span className="text-sub">{e.source}</span>
                  {e.meta?.toolId && (
                    <span className="text-text/80">
                      {" "}
                      · {e.meta.toolId}:{e.meta.eventName ?? ""}
                    </span>
                  )}
                </span>
                <span className="text-sub text-xs">{new Date(e.at).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </TrophyFrame>
  );
}

function LeaderboardTab() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean>(false);
  // Track mount state so an in-flight fetch can't setState after the
  // dialog closes — without this React logs a "setState on unmounted
  // component" warning every time the user opens, clicks Load, then
  // closes the dialog before the network round-trip completes.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  // Reflect env availability as soon as the tab renders. `available`
  // previously stayed at its `false` default until the first Load click,
  // so fully-configured deployments showed the "Set NEXT_PUBLIC_SUPABASE_URL
  // …" setup instructions to every user who opened the tab. Read it in an
  // effect (not a lazy initializer) so the SSR pass and first client render
  // stay identical.
  useEffect(() => {
    setAvailable(isRealtimeAvailable());
  }, []);

  const load = async () => {
    if (!aliveRef.current) return;
    setAvailable(isRealtimeAvailable());
    if (!isRealtimeAvailable()) {
      setError("Supabase not configured — leaderboard unavailable in local-only mode.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeaderboard(50);
      if (!aliveRef.current) return;
      setRows(data);
    } catch {
      if (aliveRef.current) setError("Failed to load leaderboard.");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-sub">Top 50 by prestige → level → XP</div>
        <Button variant="outline" size="sm" onClick={load}>
          Load
        </Button>
      </div>
      {error && (
        <div role="alert" className="text-xs text-danger mb-2">
          {error}
        </div>
      )}
      {!available && (
        <div className="text-xs text-sub">
          Set <code className="font-mono text-accent">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-accent">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> + create a{" "}
          <code className="font-mono text-accent">gamification_profiles</code> table to enable the
          global leaderboard.
        </div>
      )}
      {loading && <div className="text-sm text-sub">Loading…</div>}
      {rows && rows.length > 0 && (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div
              key={r.visitor_id}
              data-testid="leaderboard-row"
              className="grid grid-cols-[auto_1fr_auto] gap-2 items-center rounded border border-border bg-surface px-2 py-1.5 text-xs"
            >
              <span className="font-data text-accent min-w-8">#{i + 1}</span>
              <span className="text-text truncate">
                {r.display_name || `Anonymous ${r.visitor_id.slice(0, 6)}`}
              </span>
              <span className="flex items-center justify-end gap-2 font-data">
                {r.prestige > 0 && (
                  <span className="flex items-center gap-1 text-warning">
                    <Crown className="w-3 h-3" aria-hidden="true" />
                    {r.prestige}
                  </span>
                )}
                <span className="text-text">L{r.level}</span>
                <span className="text-sub text-right min-w-14">{r.xp.toLocaleString()}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AchievementCard({
  achievement: a,
  unlocked,
}: {
  achievement: Achievement;
  unlocked: boolean;
}) {
  const hidden = a.hidden && !unlocked;
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-xs",
        unlocked ? "border-accent/40 bg-accent/5" : "border-border bg-surface text-sub"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate">{hidden ? "???" : a.title}</span>
        {unlocked ? (
          <Trophy className="w-3.5 h-3.5 text-accent shrink-0" />
        ) : (
          <Lock className="w-3.5 h-3.5 text-sub shrink-0" />
        )}
        {/* The trophy / lock icons are decorative; say it. */}
        <span className="sr-only">{unlocked ? "Unlocked" : "Locked"}</span>
      </div>
      <div className="text-xs mt-0.5 line-clamp-2">
        {hidden ? "Hidden achievement" : a.description}
      </div>
      <div className="text-xs mt-1 font-data text-accent">+{a.xp} XP</div>
    </div>
  );
}

/**
 * One challenge row. A completed challenge whose id has left the pool has no
 * definition any more; it still counts toward daily-three / weekly-sweep, so
 * it shows as a plain "Completed" card from its stored progress.
 */
function ChallengeCard({ c, def }: { c: ChallengeProgress; def: ChallengeDef | undefined }) {
  const title = def?.title ?? "Completed challenge";
  const description = def?.description ?? "This challenge has left the rotation.";
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        c.completed ? "border-accent/40 bg-accent/5" : "border-border bg-surface"
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-semibold text-text">{title}</span>
        <Badge variant="outline" className="font-data">
          +{c.xp} XP
        </Badge>
      </div>
      <div className="text-xs text-sub mb-2">{description}</div>
      <div className="flex items-center gap-2">
        <Progress
          value={c.goal > 0 ? (c.progress / c.goal) * 100 : 100}
          aria-label={`${title} progress`}
          className="h-1.5 flex-1"
        />
        <span className="text-xs font-data text-text">
          {c.progress} / {c.goal}
        </span>
      </div>
    </div>
  );
}
