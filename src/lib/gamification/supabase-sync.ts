"use client";

import { getSupabaseClient, isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import { getVDnaSnapshot } from "@/lib/stores/vdna-store";

export interface LeaderboardRow {
  visitor_id: string;
  display_name: string | null;
  level: number;
  xp: number;
  prestige: number;
  lifetime_xp: number;
  achievements_count: number;
  longest_streak: number;
  updated_at: string;
}

/**
 * Debounced profile upsert — schema (client-provisioned):
 *   create table gamification_profiles (
 *     visitor_id text primary key,
 *     display_name text,
 *     level int not null default 1,
 *     xp int not null default 0,
 *     prestige int not null default 0,
 *     lifetime_xp int not null default 0,
 *     achievements_count int not null default 0,
 *     longest_streak int not null default 0,
 *     updated_at timestamptz not null default now()
 *   );
 *
 * RLS: public read, upsert restricted to matching visitor_id via anon policy.
 */

let pending: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 4_000;

export function scheduleProfileSync() {
  if (!isRealtimeAvailable()) return;
  const dna = getVDnaSnapshot();
  if (!dna.shareOnLeaderboard) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void syncProfile();
  }, DEBOUNCE_MS);
}

/** Drop a debounced sync that hasn't fired yet (e.g. the owner signed out). */
export function cancelProfileSync() {
  if (pending) clearTimeout(pending);
  pending = null;
}

async function syncProfile(): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  const dna = getVDnaSnapshot();
  try {
    const { error } = await supabase.from("gamification_profiles").upsert(
      {
        visitor_id: dna.visitorId,
        display_name: dna.displayName ?? null,
        level: dna.level,
        xp: dna.xp,
        prestige: dna.prestige,
        lifetime_xp: dna.lifetimeXp,
        achievements_count: dna.unlocked.length,
        longest_streak: dna.longestStreak,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "visitor_id" }
    );
    return !error;
  } catch {
    return false;
  }
}

export async function fetchLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("gamification_profiles")
      .select(
        "visitor_id, display_name, level, xp, prestige, lifetime_xp, achievements_count, longest_streak, updated_at"
      )
      .order("prestige", { ascending: false })
      .order("level", { ascending: false })
      .order("xp", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as LeaderboardRow[];
  } catch {
    return [];
  }
}
