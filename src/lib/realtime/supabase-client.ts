"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  // Nothing signs in through this client: Realtime channels and the
  // leaderboard run on the anon key (owner data goes through
  // `getAuthBrowserClient()`). So never read a session from the URL —
  // createClient defaults to the implicit flow, and a crafted
  // `#access_token=…` link would otherwise plant someone else's session
  // here; codes are exchanged only by /auth/callback, which enforces the
  // owner check. Not persisting a session also ignores one planted in
  // localStorage before this change.
  cachedClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  return cachedClient;
}

export function isRealtimeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
