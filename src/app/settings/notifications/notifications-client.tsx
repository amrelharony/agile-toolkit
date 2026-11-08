"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCheck, Eye, Moon, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";
import { useHapticsStore } from "@/lib/stores/haptics-store";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { useInboxStore } from "@/lib/notify/inbox-store";
import {
  effectiveCelebrationLevel,
  effectiveQuietHours,
  FOCUS_UNTIL_OFF,
  isFocusActive,
  type CelebrationLevel,
} from "@/lib/notify/prefs";
import { previewMoment } from "@/lib/notify/moment-scheduler";
import { undoable } from "@/lib/utils/undoable";
import type { HapticCategory, HapticsMode } from "@/lib/haptics/types";
import type { SonificationMode } from "@/lib/sonification/types";

const LEVEL_OPTIONS: { value: CelebrationLevel; label: string; description: string }[] = [
  { value: "quiet", label: "Quiet", description: "Activity only, never a moment." },
  { value: "balanced", label: "Balanced", description: "A short moment with Amr for rare items." },
  { value: "lively", label: "Lively", description: "A moment for every unlock, 2 min apart." },
];

const LEVEL_HINT: Record<CelebrationLevel, string> = {
  quiet: "Levels, badges and challenges go to Activity. Amr never stops you for them.",
  balanced:
    "Everything goes to Activity. Rare ones also get a short moment with Amr, at a calm time.",
  lively:
    "Every level, badge and challenge gets a short moment with Amr, at least 2 minutes apart.",
};

const SOUND_MODES: { value: SonificationMode; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "minimal", label: "Minimal" },
  { value: "ambient", label: "Ambient" },
];

const HAPTIC_MODES: { value: HapticsMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "essential", label: "Essential" },
  { value: "full", label: "Full" },
];

const HAPTIC_CATEGORIES: { key: HapticCategory; label: string }[] = [
  { key: "error", label: "Errors" },
  { key: "timer", label: "Timers" },
  { key: "ceremonies", label: "Ceremonies" },
  { key: "voting", label: "Voting" },
  { key: "drag", label: "Dragging cards" },
  { key: "toasts", label: "Pop-ups" },
  { key: "ui", label: "Buttons and switches" },
];

const MINUTE = 60_000;
const FOCUS_OPTIONS: { label: string; ms: number | null }[] = [
  { label: "30 min", ms: 30 * MINUTE },
  { label: "1 h", ms: 60 * MINUTE },
  { label: "2 h", ms: 120 * MINUTE },
  { label: "Until I turn it off", ms: null },
];

/** "15:30", local time, matching the 24-hour quiet-hours inputs. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The Focus status line: "Until 15:30", "Until you turn it off" or null when off. */
export function focusStatus(focusUntil: number | null, now: number): string | null {
  if (!isFocusActive({ focusUntil }, now) || focusUntil === null) return null;
  return focusUntil >= FOCUS_UNTIL_OFF
    ? "Until you turn it off"
    : `Until ${formatClock(focusUntil)}`;
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4"
    >
      <div className="space-y-1">
        <h2 id={`${id}-heading`} className="font-medium text-text">
          {title}
        </h2>
        {description && <p className="text-sm text-sub max-w-xl">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={id} className="text-sm text-text">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="text-xs text-sub">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="min-touch-coarse shrink-0"
      />
    </div>
  );
}

/** Re-render once when a timed Focus ends, so its status line clears. No polling. */
function useFocusExpiry(focusUntil: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (focusUntil === null || focusUntil >= FOCUS_UNTIL_OFF) return;
    const wait = focusUntil - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(wait + 50, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [focusUntil]);
  return now;
}

export function NotificationsClient() {
  // Every store here uses skipHydration; this page may render before the
  // providers have read them. Wait, so a click can't save defaults over
  // the stored choices.
  const [hydrated, setHydrated] = useState(false);
  const [canVibrate, setCanVibrate] = useState(false);
  useEffect(() => {
    setCanVibrate(typeof navigator !== "undefined" && typeof navigator.vibrate === "function");
    void Promise.all([
      useNotificationPrefsStore.persist.rehydrate(),
      useHapticsStore.persist.rehydrate(),
      useSonificationStore.persist.rehydrate(),
      useInboxStore.persist.rehydrate(),
    ])
      .catch(() => {})
      .finally(() => setHydrated(true));
  }, []);

  return (
    <div className="space-y-6 max-w-2xl" data-testid="notifications-settings">
      <CelebrationsSection hydrated={hydrated} />
      <ProgressSection hydrated={hydrated} />
      <ConfirmationsSection hydrated={hydrated} />
      <SoundSection hydrated={hydrated} />
      {canVibrate && <HapticsSection hydrated={hydrated} />}
      <QuietTimeSection hydrated={hydrated} />
      <TipsSection hydrated={hydrated} />
      <ActivitySection hydrated={hydrated} />
    </div>
  );
}

function CelebrationsSection({ hydrated }: { hydrated: boolean }) {
  const stored = useNotificationPrefsStore((s) => s.celebrationLevel);
  const setLevel = useNotificationPrefsStore((s) => s.setCelebrationLevel);
  const level = effectiveCelebrationLevel({ celebrationLevel: stored });
  return (
    <Section
      id="celebrations"
      title="Celebrations"
      description="Levels, badges and finished challenges. Nothing ever pops up in the middle of a ceremony, while presenting or while you type."
    >
      <ToggleGroup
        label="Celebrations"
        value={level}
        onValueChange={(v) => hydrated && setLevel(v)}
        aria-describedby="celebrations-hint"
        options={LEVEL_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          description: o.description,
          disabled: !hydrated,
        }))}
      />
      <p id="celebrations-hint" className="text-xs text-sub" aria-live="polite">
        {LEVEL_HINT[level]}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => previewMoment()}
        className="min-touch-coarse"
      >
        <Eye className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
        Preview a moment
      </Button>
    </Section>
  );
}

function ProgressSection({ hydrated }: { hydrated: boolean }) {
  const enabled = useNotificationPrefsStore((s) => s.gamificationEnabled);
  const showXpBar = useNotificationPrefsStore((s) => s.showXpBar);
  const setEnabled = useNotificationPrefsStore((s) => s.setGamificationEnabled);
  const setShowXpBar = useNotificationPrefsStore((s) => s.setShowXpBar);
  return (
    <Section id="progress" title="Progress">
      <SwitchRow
        id="gamification-enabled"
        label="XP, levels and badges"
        description="Off hides the XP bar, your progress and their Activity rows, and pauses earning XP and badges. Your streak keeps going and your totals are kept."
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={!hydrated}
      />
      <SwitchRow
        id="show-xp-bar"
        label="Show the XP bar"
        description="In the header, on larger screens."
        checked={showXpBar}
        onCheckedChange={setShowXpBar}
        disabled={!hydrated || !enabled}
      />
    </Section>
  );
}

function ConfirmationsSection({ hydrated }: { hydrated: boolean }) {
  const asToasts = useNotificationPrefsStore((s) => s.confirmationsAsToasts);
  const set = useNotificationPrefsStore((s) => s.setConfirmationsAsToasts);
  return (
    <Section id="confirmations" title="Confirmations">
      <SwitchRow
        id="confirmations-as-toasts"
        label="Show “Copied” and “Exported” as pop-ups"
        description="Off: the button you pressed says so for a moment instead."
        checked={asToasts}
        onCheckedChange={set}
        disabled={!hydrated}
      />
    </Section>
  );
}

function SoundSection({ hydrated }: { hydrated: boolean }) {
  const enabled = useSonificationStore((s) => s.enabled);
  const mode = useSonificationStore((s) => s.mode);
  const setEnabled = useSonificationStore((s) => s.setEnabled);
  const setMode = useSonificationStore((s) => s.setMode);
  return (
    <Section id="sound" title="Sound">
      <SwitchRow
        id="sound-enabled"
        label="Interface sounds"
        description="Off by default, since the tools are often used on shared screens."
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={!hydrated}
      />
      <ToggleGroup
        label="Sound style"
        size="sm"
        value={mode}
        onValueChange={(v) => hydrated && setMode(v)}
        options={SOUND_MODES.map((o) => ({ ...o, disabled: !hydrated || !enabled }))}
      />
    </Section>
  );
}

function HapticsSection({ hydrated }: { hydrated: boolean }) {
  const enabled = useHapticsStore((s) => s.enabled);
  const mode = useHapticsStore((s) => s.mode);
  const perCategory = useHapticsStore((s) => s.perCategory);
  const effective: HapticsMode = enabled ? mode : "off";
  const onMode = (next: HapticsMode) => {
    if (!hydrated) return;
    const s = useHapticsStore.getState();
    s.setMode(next);
    if (next !== "off" && !s.enabled) s.setEnabled(true);
  };
  return (
    <Section
      id="haptics"
      title="Vibration"
      description="Essential vibrates for errors, timers ending and milestones only."
    >
      <ToggleGroup
        label="Vibration"
        size="sm"
        value={effective}
        onValueChange={onMode}
        options={HAPTIC_MODES.map((o) => ({ ...o, disabled: !hydrated }))}
      />
      {effective !== "off" && (
        <ul className="space-y-3" aria-label="Vibrate for">
          {HAPTIC_CATEGORIES.map((c) => (
            <li key={c.key}>
              <SwitchRow
                id={`haptics-${c.key}`}
                label={c.label}
                checked={perCategory[c.key] !== false}
                onCheckedChange={() => useHapticsStore.getState().toggleCategory(c.key)}
                disabled={!hydrated}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function QuietTimeSection({ hydrated }: { hydrated: boolean }) {
  const focusUntil = useNotificationPrefsStore((s) => s.focusUntil);
  const quietHours = useNotificationPrefsStore((s) => s.quietHours);
  const startFocus = useNotificationPrefsStore((s) => s.startFocus);
  const endFocus = useNotificationPrefsStore((s) => s.endFocus);
  const setQuietHours = useNotificationPrefsStore((s) => s.setQuietHours);
  const now = useFocusExpiry(focusUntil);
  const status = focusStatus(focusUntil, now);
  const hours = effectiveQuietHours(quietHours);
  return (
    <Section
      id="quiet-time"
      title="Quiet time"
      description="No moments, no pop-ups that can wait, no vibration except a timer ending. Everything still lands in Activity."
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-text">
          <Moon className="w-4 h-4 text-accent" aria-hidden="true" />
          <span id="focus-label">Focus</span>
          <span className="text-xs text-sub" aria-live="polite" data-testid="focus-status">
            {status ?? "Off"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="focus-label">
          {FOCUS_OPTIONS.map((o) => (
            <Button
              key={o.label}
              variant="outline"
              size="sm"
              className="min-touch-coarse"
              disabled={!hydrated}
              onClick={() => startFocus(o.ms)}
            >
              {o.label}
            </Button>
          ))}
          {status && (
            <Button
              variant="secondary"
              size="sm"
              className="min-touch-coarse"
              disabled={!hydrated}
              onClick={endFocus}
            >
              End Focus
            </Button>
          )}
        </div>
      </div>

      <SwitchRow
        id="quiet-hours-enabled"
        label="Quiet hours"
        description="Every day, in this browser's time zone. An end before the start runs past midnight."
        checked={quietHours.enabled}
        onCheckedChange={(v) => setQuietHours({ enabled: v })}
        disabled={!hydrated}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="quiet-hours-start" className="text-xs text-sub">
            From
          </label>
          <Input
            id="quiet-hours-start"
            type="time"
            value={hours.start}
            onChange={(e) => setQuietHours({ start: e.target.value })}
            disabled={!hydrated || !quietHours.enabled}
            className="w-32 bg-bg"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="quiet-hours-end" className="text-xs text-sub">
            To
          </label>
          <Input
            id="quiet-hours-end"
            type="time"
            value={hours.end}
            onChange={(e) => setQuietHours({ end: e.target.value })}
            disabled={!hydrated || !quietHours.enabled}
            className="w-32 bg-bg"
          />
        </div>
      </div>
      <p className="text-xs text-sub">Always quiet in live ceremonies and while presenting.</p>
    </Section>
  );
}

function TipsSection({ hydrated }: { hydrated: boolean }) {
  const muted = useNotificationPrefsStore((s) => s.mutedKeys.length);
  const clear = useNotificationPrefsStore((s) => s.clearMutedKeys);
  return (
    <Section
      id="tips"
      title="Tips"
      description={
        muted === 0
          ? "Dismiss the same tip three times and it stops showing. None are hidden right now."
          : `${muted} tip${muted === 1 ? " is" : "s are"} hidden because you dismissed ${muted === 1 ? "it" : "them"} three times.`
      }
    >
      <Button
        variant="outline"
        size="sm"
        className="min-touch-coarse"
        onClick={clear}
        disabled={!hydrated || muted === 0}
      >
        <RotateCcw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
        Show hidden tips again
      </Button>
    </Section>
  );
}

function ActivitySection({ hydrated }: { hydrated: boolean }) {
  const total = useInboxStore((s) => s.items.length);
  const unread = useInboxStore((s) => s.items.filter((i) => !i.read).length);
  const onClear = () => {
    const before = useInboxStore.getState().items;
    undoable({
      label: "Activity cleared",
      apply: () => useInboxStore.getState().clear(),
      revert: () => useInboxStore.setState({ items: before }),
    });
  };
  return (
    <Section
      id="activity"
      title="Activity"
      description={
        total === 0
          ? "Activity is empty."
          : `${total} item${total === 1 ? "" : "s"}, ${unread} unread. Items older than 30 days go on their own.`
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-touch-coarse"
          onClick={() => useInboxStore.getState().markAllRead()}
          disabled={!hydrated || unread === 0}
        >
          <CheckCheck className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          Mark all read
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-touch-coarse"
          onClick={onClear}
          disabled={!hydrated || total === 0}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
          Clear
        </Button>
      </div>
    </Section>
  );
}
