import "server-only";
import { cookies } from "next/headers";
import { VIP_COOKIE, isVipKey } from "./book-access";

/**
 * Whether this request comes from a device that opened the printed link. The
 * one server check behind every VIP page.
 *
 * Reading the cookie makes a page dynamic, so only pages that are dynamic anyway
 * call this: never the root layout and never a released comic, which stay static
 * and link to /comics/early instead.
 */
export async function hasVipAccess(): Promise<boolean> {
  return isVipKey(cookies().get(VIP_COOKIE)?.value);
}
