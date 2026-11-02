import { NextResponse, type NextRequest } from "next/server";
import { getSquadAdminClient } from "@/lib/squads/server";
import {
  VIP_COOKIE,
  VIP_COOKIE_MAX_AGE,
  VIP_COOKIE_PATH,
  isVipKey,
  normalizeVipKey,
} from "@/lib/vip/book-access";
import { VIP_HINT_COOKIE, VIP_HINT_MAX_AGE, VIP_HINT_VALUE, VIP_ROUTE } from "@/lib/vip/constants";

export const dynamic = "force-dynamic";

/** A reader is waiting on this redirect, so the count gives up quickly. */
const COUNT_TIMEOUT_MS = 1_500;

/**
 * One more book reader, added to today's anonymous total. No key, cookie or IP
 * address reaches the table, and a failed count never costs anyone their access.
 */
async function countActivation(): Promise<void> {
  const admin = getSquadAdminClient();
  if (!admin) return;
  try {
    const { error } = await admin
      .rpc("comic_entry_hit", { p_entry: "vip", p_ep: 0, p_building: 0 })
      .abortSignal(AbortSignal.timeout(COUNT_TIMEOUT_MS));
    if (error) console.warn("[vip] activation count failed:", error.message);
  } catch (err) {
    console.warn("[vip] activation count failed:", err);
  }
}

/**
 * The link printed in the book: /vip/<key>.
 *
 * A valid key is remembered in an httpOnly cookie on this device, then the
 * visitor lands on /vip, so the key never stays in the address bar, the
 * history or a screenshot of the page. An unknown key lands on the same page
 * with `?link=invalid`, which explains what went wrong. Either way the
 * redirect carries no Referer and is never cached.
 *
 * A valid key also sets a readable hint cookie, for the menus only (see
 * VIP_HINT_COOKIE), and counts as an activation, unless this device was already
 * unlocked: scanning the same book twice isn't a second reader. Only this handler
 * counts, so a bad key or a page view never can.
 */
export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  const valid = await isVipKey(params.key);

  const target = request.nextUrl.clone();
  target.pathname = VIP_ROUTE;
  target.search = "";
  if (!valid) target.searchParams.set("link", "invalid");

  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (valid) {
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set({
      name: VIP_COOKIE,
      value: normalizeVipKey(params.key) ?? "",
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: VIP_COOKIE_PATH,
      maxAge: VIP_COOKIE_MAX_AGE,
    });
    response.cookies.set({
      name: VIP_HINT_COOKIE,
      value: VIP_HINT_VALUE,
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: VIP_COOKIE_PATH,
      maxAge: VIP_HINT_MAX_AGE,
    });
    if (!(await isVipKey(request.cookies.get(VIP_COOKIE)?.value))) await countActivation();
  }
  return response;
}
