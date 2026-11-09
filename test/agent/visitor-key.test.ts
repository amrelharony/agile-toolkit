// @vitest-environment node
/**
 * The daily visitor code: an HMAC of the address's bucket, the Cairo date and
 * the secret. The raw address never appears in it, it changes every Cairo
 * day, and an IPv6 home network (one /64) is one visitor.
 */

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cairoDay, ipBucket, visitorKey } from "@/lib/visitor-ai/visitor-key";

const SECRET = "test-secret-not-a-real-one-0123";
const KEY_SHAPE = /^[A-Za-z0-9_-]{32}$/;

describe("ipBucket", () => {
  it.each([
    ["1.2.3.4", "1.2.3.4"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["010.001.002.003", "10.1.2.3"],
    ["203.0.113.7:51234", "203.0.113.7"],
  ])("keeps an IPv4 address %j as %j", (ip, bucket) => {
    expect(ipBucket(ip)).toBe(bucket);
  });

  it.each([
    ["2001:db8:85a3:1234:aaaa:bbbb:cccc:dddd", "2001:db8:85a3:1234::/64"],
    ["2001:0db8:85a3:1234:0000:0000:0000:0001", "2001:db8:85a3:1234::/64"],
    ["2001:DB8:85A3:1234::1", "2001:db8:85a3:1234::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["[2001:db8:85a3:1234::9]:443", "2001:db8:85a3:1234::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["64:ff9b::192.0.2.33", "64:ff9b:0:0::/64"],
  ])("groups the IPv6 address %j by its /64, %j", (ip, bucket) => {
    expect(ipBucket(ip)).toBe(bucket);
  });

  it("puts every address of one /64 in the same bucket, and the next /64 in another", () => {
    const a = ipBucket("2001:db8:1:2:aaaa::1");
    expect(ipBucket("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(a);
  });

  it("reads an IPv4-mapped IPv6 address as the IPv4 one", () => {
    expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it.each([
    "",
    "unknown",
    "1.2.3",
    "256.1.1.1",
    "1.2.3.4.5",
    "2001:db8::1::2",
    "1:2:3:4:5:6:7:8:9",
    "gggg::1",
    "<script>",
  ])("refuses %j", (ip) => {
    expect(ipBucket(ip)).toBeNull();
  });
});

describe("cairoDay", () => {
  it("is the calendar date in Cairo, not UTC", () => {
    // Cairo is UTC+2 in winter: 22:30 UTC is already tomorrow there.
    expect(cairoDay(new Date("2026-01-05T21:59:00Z"))).toBe("2026-01-05");
    expect(cairoDay(new Date("2026-01-05T22:30:00Z"))).toBe("2026-01-06");
    // UTC+3 in summer: the day turns at 21:00 UTC.
    expect(cairoDay(new Date("2026-07-06T20:59:00Z"))).toBe("2026-07-06");
    expect(cairoDay(new Date("2026-07-06T21:00:00Z"))).toBe("2026-07-07");
  });
});

describe("visitorKey", () => {
  const day = "2026-11-09";

  it("is the first 32 characters of the base64url HMAC of the prefixed day and bucket", () => {
    const expected = createHmac("sha256", SECRET)
      .update(`agile-toolkit:visitor-ai:v1:${day}:203.0.113.7`)
      .digest("base64url")
      .slice(0, 32);
    expect(visitorKey("203.0.113.7", day, SECRET)).toBe(expected);
    expect(expected).toMatch(KEY_SHAPE);
  });

  it("never contains the address, in any form", () => {
    for (const ip of ["203.0.113.7", "2001:db8:85a3:1234::1"]) {
      const key = visitorKey(ip, day, SECRET)!;
      expect(key).toMatch(KEY_SHAPE);
      for (const piece of [ip, ...ip.split(/[.:]/).filter((p) => p.length >= 3)]) {
        expect(key).not.toContain(piece);
      }
    }
  });

  it("changes every Cairo day, and is stable within one", () => {
    const today = visitorKey("203.0.113.7", "2026-11-09", SECRET);
    expect(visitorKey("203.0.113.7", "2026-11-09", SECRET)).toBe(today);
    expect(visitorKey("203.0.113.7", "2026-11-10", SECRET)).not.toBe(today);
  });

  it("is one code for a whole IPv6 /64, and another for the next one", () => {
    const home = visitorKey("2001:db8:1:2::1", day, SECRET);
    expect(visitorKey("2001:db8:1:2:dead:beef:0:1", day, SECRET)).toBe(home);
    expect(visitorKey("2001:db8:1:3::1", day, SECRET)).not.toBe(home);
  });

  it("differs per address and per secret", () => {
    const key = visitorKey("203.0.113.7", day, SECRET);
    expect(visitorKey("203.0.113.8", day, SECRET)).not.toBe(key);
    expect(visitorKey("203.0.113.7", day, `${SECRET}-other`)).not.toBe(key);
  });

  it("is null without a secret, with a short one, or for an address it can't read", () => {
    expect(visitorKey("203.0.113.7", day, undefined)).toBeNull();
    expect(visitorKey("203.0.113.7", day, "")).toBeNull();
    expect(visitorKey("203.0.113.7", day, "   ")).toBeNull();
    expect(visitorKey("203.0.113.7", day, "fifteen-chars!!")).toBeNull();
    expect(visitorKey("unknown", day, SECRET)).toBeNull();
  });
});
