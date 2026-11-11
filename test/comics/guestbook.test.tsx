/**
 * The guestbook: what its form and route accept, that a note waits for the
 * owner, the owner's routes, and the page showing approved notes only.
 */

import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  auth: null as Response | null,
  hasClient: true,
  waiting: 0 as number | null,
  countError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  inserted: [] as Record<string, unknown>[],
  approved: [] as { id: string; name: string; message: string }[],
  readError: null as { message: string } | null,
  updated: [] as { id: unknown; value: unknown }[],
  deleted: [] as unknown[],
  revalidated: [] as string[],
  readFilter: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => h.revalidated.push(path) }));
vi.mock("@/lib/auth/require-user", () => ({
  requireAuthorizedUser: async () => {
    if (h.auth) throw h.auth;
    return { user: { id: "owner" }, supabase: {} };
  },
}));
vi.mock("@/lib/squads/server", () => ({
  getSquadAdminClient: () => {
    if (!h.hasClient) return null;
    return {
      from: (table: string) => {
        expect(table).toBe("comic_guestbook");
        const state: { id?: unknown; value?: unknown; op: string; approved?: boolean } = {
          op: "select",
        };
        const chain: Record<string, unknown> = {
          select: (_cols: string, opts?: { head?: boolean }) => {
            if (opts?.head) {
              return { is: async () => ({ count: h.waiting, error: h.countError }) };
            }
            return chain;
          },
          insert: async (row: Record<string, unknown>) => {
            h.inserted.push(row);
            return { error: h.insertError };
          },
          update: (value: unknown) => {
            state.op = "update";
            state.value = value;
            return chain;
          },
          delete: () => {
            state.op = "delete";
            return chain;
          },
          eq: (_col: string, id: unknown) => {
            state.id = id;
            if (state.op === "delete") {
              h.deleted.push(id);
              return Promise.resolve({ error: null });
            }
            return chain;
          },
          is: () => {
            state.approved = false;
            return chain;
          },
          not: (...args: unknown[]) => {
            h.readFilter.push(args);
            state.approved = true;
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          abortSignal: () => chain,
          returns: async () => ({ data: h.approved, error: h.readError }),
          maybeSingle: async () => {
            h.updated.push({ id: state.id, value: state.value });
            return { data: { id: state.id, ...(state.value as object) }, error: null };
          },
          then: (resolve: (v: unknown) => void) =>
            resolve({
              data: state.approved
                ? [{ id: "b", approved_at: "2026-11-02" }]
                : [{ id: "a", approved_at: null }],
              error: null,
            }),
        };
        return chain;
      },
    };
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

import { POST } from "@/app/api/comics/guestbook/route";
import { GET as listNotes } from "@/app/api/comics/guestbook-notes/route";
import { DELETE, PATCH } from "@/app/api/comics/guestbook-notes/[id]/route";
import GuestbookPage, { metadata } from "@/app/(tools)/comics/guestbook/page";
import { COMMUNITY_URL, GUESTBOOK_LIMITS, validateGuestbookDraft } from "@/lib/comics/guestbook";
import { listApprovedNotes } from "@/lib/comics/guestbook-store";

const HOST = "agile.test";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
let ip = 0;

function post(body: unknown, headers: Record<string, string> = {}) {
  ip += 1;
  return POST(
    new NextRequest(`https://${HOST}/api/comics/guestbook`, {
      method: "POST",
      headers: { host: HOST, origin: `https://${HOST}`, "x-real-ip": `10.1.0.${ip}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function ownerReq(method: string, body?: unknown) {
  return new NextRequest(`https://${HOST}/api/comics/guestbook-notes/${ID}`, {
    method,
    headers: { host: HOST, origin: `https://${HOST}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  h.auth = null;
  h.hasClient = true;
  h.waiting = 0;
  h.countError = null;
  h.insertError = null;
  h.inserted = [];
  h.approved = [];
  h.readError = null;
  h.updated = [];
  h.deleted = [];
  h.revalidated = [];
  h.readFilter = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("a guestbook note", () => {
  it("needs a name and a message, within their lengths, without control characters", () => {
    expect(validateGuestbookDraft({ name: " Sara ", message: "Loved it\u0000" })).toEqual({
      ok: true,
      values: { name: "Sara", message: "Loved it" },
    });
    const missing = validateGuestbookDraft({ name: "", message: "  " });
    expect(missing.ok ? [] : Object.keys(missing.errors).sort()).toEqual(["message", "name"]);
    const long = validateGuestbookDraft({ name: "x".repeat(61), message: "y".repeat(501) });
    expect(long.ok ? [] : Object.keys(long.errors).sort()).toEqual(["message", "name"]);
  });

  it("matches the migration's lengths", () => {
    const sql = readFileSync("supabase/migrations/0033_comic_guestbook_quiz.sql", "utf8");
    expect(sql).toContain(`char_length(name) between 1 and ${GUESTBOOK_LIMITS.name}`);
    expect(sql).toContain(`char_length(message) between 1 and ${GUESTBOOK_LIMITS.message}`);
  });

  it("lives in a table closed to everyone but the service role, with nothing about the browser", () => {
    const sql = readFileSync("supabase/migrations/0033_comic_guestbook_quiz.sql", "utf8");
    expect(sql).toMatch(/alter table public\.comic_guestbook enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.comic_guestbook from anon, authenticated/);
    const table = sql.slice(
      sql.indexOf("create table"),
      sql.indexOf(");", sql.indexOf("create table"))
    );
    expect(table).not.toMatch(/ip|user_agent|email/i);
  });
});

describe("POST /api/comics/guestbook", () => {
  it("keeps the note for the owner, with nothing about the browser", async () => {
    const res = await post({ name: "Sara", message: "The approvals story is my office." });
    expect(res.status).toBe(204);
    expect(h.inserted).toEqual([{ name: "Sara", message: "The approvals story is my office." }]);
  });

  it("refuses another site's form", async () => {
    const res = await post({ name: "S", message: "M" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(h.inserted).toEqual([]);
  });

  it("answers a filled honeypot like a success and keeps nothing", async () => {
    const res = await post({ name: "Bot", message: "Buy now", website: "spam.example" });
    expect(res.status).toBe(204);
    expect(h.inserted).toEqual([]);
  });

  it("names the fields it refused", async () => {
    const res = await post({ name: "", message: "Hi" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input", fields: ["name"] });
  });

  it("refuses a body that isn't JSON, or is too big", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ name: "S", message: "x".repeat(5000) })).status).toBe(413);
  });

  it("stops taking notes while too many wait for the owner", async () => {
    h.waiting = 500;
    const res = await post({ name: "Sara", message: "Hello" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "guestbook_full" });
    expect(h.inserted).toEqual([]);
  });

  it("limits one address to three notes an hour", async () => {
    const same = { "x-real-ip": "10.9.9.9" };
    for (let i = 0; i < 3; i++) {
      expect((await post({ name: "S", message: `Note ${i}` }, same)).status).toBe(204);
    }
    expect((await post({ name: "S", message: "Again" }, same)).status).toBe(429);
  });

  it("is unavailable without the database, before migration 0033 runs too", async () => {
    h.countError = { message: 'relation "comic_guestbook" does not exist' };
    expect((await post({ name: "S", message: "M" })).status).toBe(503);
    h.hasClient = false;
    expect((await post({ name: "S", message: "M" })).status).toBe(503);
  });
});

describe("the owner's guestbook routes", () => {
  it("refuse anyone but the owner", async () => {
    h.auth = Response.json({ error: "forbidden" }, { status: 403 });
    expect((await listNotes(ownerReq("GET"), { params: {} })).status).toBe(403);
    expect(
      (await PATCH(ownerReq("PATCH", { approved: true }), { params: { id: ID } })).status
    ).toBe(403);
    expect((await DELETE(ownerReq("DELETE"), { params: { id: ID } })).status).toBe(403);
    expect(h.updated).toEqual([]);
    expect(h.deleted).toEqual([]);
  });

  it("list every waiting note, apart from the approved ones, with how many wait", async () => {
    const res = await listNotes(ownerReq("GET"), { params: {} });
    expect(await res.json()).toEqual({
      notes: [
        { id: "a", approved_at: null },
        { id: "b", approved_at: "2026-11-02" },
      ],
      waiting: 1,
    });
  });

  it("approve a note and refresh the page at once", async () => {
    const res = await PATCH(ownerReq("PATCH", { approved: true }), { params: { id: ID } });
    expect(res.status).toBe(200);
    expect(h.updated[0]).toMatchObject({ id: ID, value: { approved_at: expect.any(String) } });
    expect(h.revalidated).toEqual(["/comics/guestbook"]);
  });

  it("take an approval back, or delete a note", async () => {
    await PATCH(ownerReq("PATCH", { approved: false }), { params: { id: ID } });
    expect(h.updated[0]).toEqual({ id: ID, value: { approved_at: null } });
    expect((await DELETE(ownerReq("DELETE"), { params: { id: ID } })).status).toBe(200);
    expect(h.deleted).toEqual([ID]);
    expect(h.revalidated).toEqual(["/comics/guestbook", "/comics/guestbook"]);
  });

  it("refuse a bad id or body", async () => {
    expect(
      (await PATCH(ownerReq("PATCH", { approved: true }), { params: { id: "x" } })).status
    ).toBe(400);
    expect(
      (await PATCH(ownerReq("PATCH", { approved: "yes" }), { params: { id: ID } })).status
    ).toBe(400);
  });
});

describe("the guestbook page", () => {
  it("reads approved notes only", async () => {
    await listApprovedNotes();
    expect(h.readFilter).toEqual([["approved_at", "is", null]]);
  });

  it("throws on a failed read at runtime, so the last good copy stays up", async () => {
    h.readError = { message: "down" };
    await expect(listApprovedNotes()).rejects.toThrow(/guestbook read failed/);
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await expect(listApprovedNotes()).resolves.toEqual([]);
  });

  it("shows the approved notes and the form, and offers no community link yet", async () => {
    h.approved = [{ id: "n1", name: "Sara", message: "The approvals story is my office." }];
    render(await GuestbookPage());
    const notes = screen.getByRole("region", { name: "From readers" });
    expect(within(notes).getByText("The approvals story is my office.")).toBeTruthy();
    expect(within(notes).getByText("Sara")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign the guestbook" })).toBeTruthy();
    expect(COMMUNITY_URL).toBeNull();
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).toBeNull();
  });

  it("says under the form what is kept and for how long, and links the privacy page", async () => {
    const { container } = render(await GuestbookPage());
    const note = container.querySelector<HTMLElement>("[data-privacy-note]")!;
    expect(note.textContent).toBe(
      "We keep your name and note until you ask us to remove them. We don't keep your IP address. More in What leaves your browser."
    );
    expect(within(note).getByRole("link", { name: "What leaves your browser" })).toHaveAttribute(
      "href",
      "/privacy"
    );
    const form = container.querySelector("form")!;
    expect(form.contains(note)).toBe(false);
    expect(form.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says so when there are none", async () => {
    render(await GuestbookPage());
    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  it("stays out of search", () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe("/comics/guestbook");
  });
});
