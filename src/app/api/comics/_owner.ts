/**
 * The gate on every owner route under /api/comics. The middleware has already
 * refused non-owners (none of these is on its bypass list), and this checks
 * again with the verified session before the service-role client is touched.
 *
 * Writes must also come from this site. The cookies are SameSite=Lax, so this
 * is a second line, not the only one.
 */

import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuthorizedUser } from "@/lib/auth/require-user";
import {
  OWNER_STORY_COLUMNS,
  toOwnerStory,
  type OwnerStory,
  type StoryRow,
} from "@/lib/comics/story-input";
import { PayloadTooLargeError, readBoundedText } from "@/lib/mcp/read-bounded";
import { getSquadAdminClient } from "@/lib/squads/server";
import { isSameOrigin } from "./_guard";

/** Well above any story, and a long way under Vercel's limit. Images never come here. */
const MAX_BODY_BYTES = 256 * 1024;

export const BUCKET = "comic-panels";

export const refuse = (status: number, error: string, extra?: Record<string, unknown>) =>
  Response.json({ error, ...extra }, { status });

export const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

interface OwnerContext<P> {
  req: NextRequest;
  admin: SupabaseClient;
  params: P;
}

export function ownerRoute<P = Record<string, never>>(
  handler: (ctx: OwnerContext<P>) => Promise<Response>
) {
  return async (req: NextRequest, context: { params: P }): Promise<Response> => {
    try {
      await requireAuthorizedUser();
    } catch (resp) {
      if (resp instanceof Response) return resp;
      throw resp;
    }
    if (req.method !== "GET" && !isSameOrigin(req)) return refuse(403, "bad_origin");
    const admin = getSquadAdminClient();
    if (!admin) return refuse(503, "service_unavailable");
    return handler({ req, admin, params: context?.params });
  };
}

/** The parsed body, or a Response to return. */
export async function readJson(req: NextRequest): Promise<{ body: unknown } | Response> {
  try {
    return { body: JSON.parse(await readBoundedText(req, MAX_BODY_BYTES)) };
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return refuse(413, "body_too_large");
    return refuse(400, "invalid_json");
  }
}

export async function loadStories(admin: SupabaseClient): Promise<OwnerStory[] | null> {
  const { data, error } = await admin
    .from("comic_stories")
    .select(OWNER_STORY_COLUMNS)
    .order("ep", { ascending: true })
    .returns<StoryRow[]>();
  return error || !data ? null : data.map(toOwnerStory);
}

/** A story, null if there's no such number, or undefined if the read failed. */
export async function loadStory(
  admin: SupabaseClient,
  ep: number
): Promise<OwnerStory | null | undefined> {
  const { data, error } = await admin
    .from("comic_stories")
    .select(OWNER_STORY_COLUMNS)
    .eq("ep", ep)
    .maybeSingle<StoryRow>();
  if (error) return undefined;
  return data ? toOwnerStory(data) : null;
}

/**
 * Which of these files aren't in the bucket, or null if that can't be told. A
 * form can hold paths for days, and their files may have been cleared as unused
 * since, so a save mustn't take its paths on trust.
 */
export async function missingArt(
  admin: SupabaseClient,
  paths: readonly string[]
): Promise<string[] | null> {
  const bucket = admin.storage.from(BUCKET);
  try {
    const found = await Promise.all(
      Array.from(new Set(paths)).map(async (path) => ({
        path,
        there: (await bucket.exists(path)).data,
      }))
    );
    return found.filter((file) => !file.there).map((file) => file.path);
  } catch {
    return null;
  }
}

/** Every storage file a story points at. */
export function artPaths(story: Pick<OwnerStory, "panels" | "sharePath">): string[] {
  const paths = story.panels.flatMap((p) => [p.pathFull, p.pathSmall]);
  if (story.sharePath) paths.push(story.sharePath);
  return paths.filter(Boolean);
}
