"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Browser-side Supabase client used for auth + cloud history sync.
 *
 * Kept SEPARATE from `src/lib/realtime/supabase-client.ts` (which the
 * gamification feature owns) so the two concerns can evolve independently.
 *
 * Returns null when Supabase env vars are not set — the toolkit falls back
 * to anonymous-only mode without erroring.
 */
export function getAuthBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  cached = createBrowserClient(url, anon);
  return cached;
}

export function isAuthAvailable(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
