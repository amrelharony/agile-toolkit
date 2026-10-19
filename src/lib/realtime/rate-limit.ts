/**
 * Inbound rate limiting for realtime broadcasts.
 *
 * Two token buckets must both have a token before a message is accepted:
 *
 * - one per sender, shared across events, so one chatty member can't
 *   drown the room;
 * - one per event name, shared by every sender, because the sender id is
 *   self-declared: a flooder that invents a fresh id per message gets a
 *   fresh per-sender bucket each time, but still drains the same global one.
 *
 * Excess messages are dropped, never queued. Pure apart from the injected
 * clock, so tests drive time by hand.
 */

export interface BucketConfig {
  /** Most tokens the bucket holds: the largest burst it lets through. */
  capacity: number;
  /** Tokens added back per second. */
  refillPerSec: number;
}

export interface InboundLimitConfig {
  perSender: BucketConfig;
  perEvent: BucketConfig;
  /**
   * Most senders tracked at once. The least recently heard one is dropped
   * past this, which bounds memory against id rotation; the per-event
   * budget still applies to whoever replaces it.
   */
  maxSenders: number;
  /** Most event names tracked at once, for the same reason. */
  maxEvents?: number;
}

export interface InboundLimiter {
  /** True, and both buckets charged one token, if this message may be handled. */
  allow(sender: string, event: string): boolean;
  /** Forget every bucket (e.g. when the channel is replaced). */
  reset(): void;
}

interface Bucket {
  tokens: number;
  at: number;
}

const DEFAULT_MAX_EVENTS = 32;

export function createInboundLimiter(
  config: InboundLimitConfig,
  now: () => number = Date.now
): InboundLimiter {
  const senders = new Map<string, Bucket>();
  const events = new Map<string, Bucket>();
  const maxEvents = config.maxEvents ?? DEFAULT_MAX_EVENTS;

  /** The bucket for `key`, refilled to `t` and moved to the most-recent end. */
  const take = (
    map: Map<string, Bucket>,
    key: string,
    cfg: BucketConfig,
    cap: number,
    t: number
  ) => {
    let b = map.get(key);
    if (b) {
      map.delete(key);
      const elapsed = Math.max(0, t - b.at) / 1000;
      b = { tokens: Math.min(cfg.capacity, b.tokens + elapsed * cfg.refillPerSec), at: t };
    } else {
      b = { tokens: cfg.capacity, at: t };
      while (map.size >= cap) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    }
    map.set(key, b);
    return b;
  };

  return {
    allow(sender, event) {
      const t = now();
      const s = take(senders, sender, config.perSender, Math.max(1, config.maxSenders), t);
      const e = take(events, event, config.perEvent, Math.max(1, maxEvents), t);
      // Charge neither unless both can pay, so a sender that is over its own
      // limit doesn't also spend the room's shared budget.
      if (s.tokens < 1 || e.tokens < 1) return false;
      s.tokens -= 1;
      e.tokens -= 1;
      return true;
    },
    reset() {
      senders.clear();
      events.clear();
    },
  };
}
