/**
 * The VIP hint cookie, browser side. Display only: it decides whether menus list
 * the VIP tools, and every page behind them checks the real cookie on the server.
 * See VIP_HINT_COOKIE in ./constants.
 */

import { VIP_HINT_COOKIE, VIP_HINT_MAX_AGE, VIP_HINT_VALUE } from "./constants";

const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((listener) => listener());
}

/** Whether `cookie` (by default this document's) carries the hint. */
export function readVipHint(cookie?: string): boolean {
  let source = cookie;
  if (source === undefined) {
    if (typeof document === "undefined") return false;
    try {
      source = document.cookie;
    } catch {
      // Cookies blocked: nothing to read, so the menus stay as for any visitor.
      return false;
    }
  }
  return source.split(";").some((part) => part.trim() === `${VIP_HINT_COOKIE}=${VIP_HINT_VALUE}`);
}

function writeCookie(value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  try {
    document.cookie = `${VIP_HINT_COOKIE}=${value}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
  } catch {
    // Cookies blocked: the menus stay as they are.
  }
  changed();
}

/** Put the hint back on a device the server has just said is unlocked. */
export function setVipHint(): void {
  writeCookie(VIP_HINT_VALUE, VIP_HINT_MAX_AGE);
}

/** "Clear data on this browser": the menus forget, the access cookie stays. */
export function clearVipHint(): void {
  writeCookie("", 0);
}

export function subscribeVipHint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
