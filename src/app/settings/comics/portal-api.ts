/**
 * The portal's calls to its owner routes, and the upload to Storage. Browser
 * only. The service role never leaves the server: this holds nothing but the
 * owner's own session, which is why an import can run from here.
 */

import type { EntriesSummary } from "@/lib/comics/entries-summary";
import type { ScheduledRelease } from "@/lib/comics/queue";
import type { OwnerStory, StoredPanel, StoryFields } from "@/lib/comics/story-input";
import {
  sendToStorage,
  type ArtUploader,
  type SignedUploadStorage,
} from "@/lib/comics/image-pipeline";
import { getAuthBrowserClient } from "@/lib/auth/supabase-browser";

export class PortalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "PortalError";
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  unauthenticated: "You're signed out. Sign in again to save. Your typing is kept on this device.",
  auth_unreachable: "Couldn't reach sign-in just now. Try again in a moment.",
  auth_unavailable: "Sign-in isn't set up on this server.",
  service_unavailable: "The server couldn't save that just now. Try again in a moment.",
  invalid_input: "Something in this story is too long or isn't allowed.",
  incomplete_story: "This story isn't ready: every panel needs art and a description.",
  not_in_queue: "That number has been released, so it can't move.",
  not_a_draft: "Unpublish this story before deleting it.",
  was_released: "This story has been out, so it keeps its number and can't be deleted.",
  needs_review: "Some panels still need review. Check them first, or confirm they can go as is.",
  art_missing: "A picture in this story is no longer in storage. Choose its art again, then save.",
  taken: "That number or source is already used by another story.",
  not_found: "That's gone. Reload the page to see the latest.",
};

async function call<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      cache: "no-store",
      ...(json === undefined
        ? {}
        : {
            body: JSON.stringify(json),
            headers: { "content-type": "application/json" },
          }),
    });
  } catch {
    throw new PortalError("No connection. Your typing is kept on this device.", 0, null);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : null;
    throw new PortalError(
      (code && MESSAGES[code]) || `The server answered ${res.status}.`,
      res.status,
      code,
      body
    );
  }
  return body as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

const stories = "/api/comics/stories";

export type StoryBody = Partial<StoryFields> & { ep?: number };

export const portalApi = {
  listStories: () => call<{ stories: OwnerStory[] }>(stories),
  createStory: (json: StoryBody) => call<{ story: OwnerStory }>(stories, { method: "POST", json }),
  patchStory: (ep: number, json: StoryBody) =>
    call<{ story: OwnerStory; replacedPaths: string[] }>(`${stories}/${ep}`, {
      method: "PATCH",
      json,
    }),
  deleteStory: (ep: number) =>
    call<{ removedPaths: string[] }>(`${stories}/${ep}`, { method: "DELETE" }),
  setRelease: (ep: number, releaseAt: string | null, allowUnreviewed = false) =>
    call<{ story: OwnerStory }>(`${stories}/${ep}/release`, {
      method: "PUT",
      json: { releaseAt, allowUnreviewed },
    }),
  reorder: (order: number[]) =>
    call<{ stories: OwnerStory[] }>("/api/comics/queue/reorder", {
      method: "POST",
      json: { order },
    }),
  schedule: (items: ScheduledRelease[], allowUnreviewed = false) =>
    call<{ stories: OwnerStory[] }>("/api/comics/queue/schedule", {
      method: "POST",
      json: { items, allowUnreviewed },
    }),
  entries: (days: number) =>
    call<{ days: number; summary: EntriesSummary }>(`/api/comics/entries?days=${days}`),
  licenceRequests: () =>
    call<{ requests: LicenceRequest[]; unhandled: number }>("/api/comics/licence-requests"),
  markHandled: (id: string, handled: boolean) =>
    call(`/api/comics/licence-requests/${id}`, { method: "PATCH", json: { handled } }),
  deleteRequest: (id: string) => call(`/api/comics/licence-requests/${id}`, { method: "DELETE" }),
  unusedArt: () => call<{ files: UnusedFile[] }>("/api/comics/unused-art"),
  deleteUnusedArt: (paths: string[]) =>
    call<{ removed: number }>("/api/comics/unused-art", { method: "POST", json: { paths } }),
};

export interface LicenceRequest {
  id: string;
  name: string;
  company: string;
  email: string;
  intended_use: string;
  team_size: string;
  message: string;
  created_at: string;
  handled_at: string | null;
}

export interface UnusedFile {
  path: string;
  size: number;
  createdAt: string | null;
}

/** Signed URL from the owner route, then straight to Storage. */
export function createArtUploader(): ArtUploader {
  return {
    signedUpload: (contentType) =>
      call<{ path: string; token: string }>("/api/comics/upload-url", {
        method: "POST",
        json: { contentType },
      }),
    send: async (path, token, blob) => {
      const client = getAuthBrowserClient();
      if (!client) throw new PortalError("Supabase isn't set up in this browser.", 0, null);
      await sendToStorage(client.storage as unknown as SignedUploadStorage, path, token, blob);
    },
  };
}

/** A panel without what only the form cares about. */
export function panelForSave(panel: StoredPanel): StoredPanel {
  return {
    pathFull: panel.pathFull,
    pathSmall: panel.pathSmall,
    width: panel.width,
    height: panel.height,
    alt: panel.alt,
    dialogue: panel.dialogue,
    signs: panel.signs,
    needsReview: panel.needsReview,
    creditCorner: panel.creditCorner,
  };
}
