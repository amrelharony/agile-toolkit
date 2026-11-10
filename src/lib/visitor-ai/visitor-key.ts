/**
 * The daily visitor code the visitor AI meter counts under.
 *
 * An HMAC-SHA256 of the address's bucket (an IPv4 address as it is, an IPv6
 * address's /64, which is what one home or phone usually gets), the Cairo date
 * and VISITOR_AI_HASH_SECRET. It changes every Cairo day, and without the
 * secret it can't be turned back into an address. The raw IP is never
 * returned, stored or logged: only this code reaches the database.
 */

import "server-only";
import { createHmac } from "node:crypto";

/** Bump the version to start every visitor's count afresh (it changes every code). */
const KEY_PREFIX = "agile-toolkit:visitor-ai:v1:";

/** Characters kept from the base64url digest (the migration allows 16 to 64). */
const KEY_CHARS = 32;

/**
 * A shorter secret makes the codes guessable: anyone holding one could try
 * every IPv4 address against a few secrets. `openssl rand -base64 32` gives 44.
 */
export const MIN_SECRET_CHARS = 16;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A dotted IPv4 address with every part 0-255, normalised (no leading zeros), or null. */
function parseIpv4(s: string): string | null {
  const m = IPV4.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts.join(".");
}

/** An IPv6 address as its 8 groups (numbers 0-65535), or null. Handles `::` and a trailing IPv4. */
function parseIpv6(s: string): number[] | null {
  let text = s.toLowerCase();
  // A trailing dotted IPv4 (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) is the last two groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const [a, b, c, d] = v4.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (half: string) => (half === "" ? [] : half.split(":"));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/**
 * The bucket one visitor's address falls in: an IPv4 address as it is, and an
 * IPv6 address's /64 (an IPv4-mapped IPv6 address counts as the IPv4 one).
 * Accepts the forms a proxy may send: `[v6]`, `[v6]:port`, `v4:port` and a
 * `%zone`. null for anything that isn't an address.
 */
export function ipBucket(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);

  const v4 = parseIpv4(s);
  if (v4) return v4;

  const v6 = parseIpv6(s);
  if (!v6) return null;
  // ::ffff:a.b.c.d is an IPv4 client seen over IPv6.
  if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
    return [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff].join(".");
  }
  return `${v6
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** The calendar date in Cairo, as YYYY-MM-DD: the day the meter counts by. */
export function cairoDay(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The visitor's code for `day` (a cairoDay string): the first 32 characters of
 * the base64url HMAC-SHA256 of "agile-toolkit:visitor-ai:v1:<day>:<bucket>".
 * null without a secret (or with one shorter than MIN_SECRET_CHARS) and for an
 * address ipBucket can't read, so the route refuses rather than count
 * everyone under one code.
 */
export function visitorKey(ip: string, day: string, secret: string | undefined): string | null {
  const key = secret?.trim();
  if (!key || key.length < MIN_SECRET_CHARS) return null;
  const bucket = ipBucket(ip);
  if (!bucket) return null;
  return createHmac("sha256", key)
    .update(`${KEY_PREFIX}${day}:${bucket}`)
    .digest("base64url")
    .slice(0, KEY_CHARS);
}
