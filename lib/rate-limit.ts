import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Public, unauthenticated endpoints that cost money (a paid LLM per chat) or
// write to a calendar (booking) are capped per client IP. Sliding window so the
// budget refills gradually, not in bursts. Tunable here.
const WINDOW = "1 d" as const;
const CHAT_LIMIT = 10;
const BOOKING_LIMIT = 5;

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  limit: number;
  reset: number;
  // false when no limiter ran: outside production we fail open (local dev and
  // tests run without Redis); in production with Upstash missing we fail
  // closed — an unmetered public endpoint that spends LLM budget is worse
  // than a down one.
  enforced: boolean;
}

// One memoized limiter per prefix. A stored `null` means Upstash env is
// missing — in production that blocks the endpoint (fail-closed).
const limiters = new Map<string, Ratelimit | null>();

function getLimiter(prefix: string, limit: number): Ratelimit | null {
  const cached = limiters.get(prefix);
  if (cached !== undefined) return cached;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      `[rate-limit] Upstash not configured; ${prefix} is blocked in production (fail-closed).`,
    );
    limiters.set(prefix, null);
    return null;
  }

  const limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, WINDOW),
    analytics: false,
    prefix,
  });
  limiters.set(prefix, limiter);
  return limiter;
}

async function check(
  prefix: string,
  max: number,
  identifier: string,
): Promise<RateLimitResult> {
  // Skip enforcement outside production so local dev doesn't burn the daily quota.
  if (process.env.VERCEL_ENV !== "production") {
    return { success: true, remaining: max, limit: max, reset: 0, enforced: false };
  }
  const l = getLimiter(prefix, max);
  if (!l) {
    return { success: false, remaining: 0, limit: max, reset: 0, enforced: false };
  }
  const { success, remaining, limit, reset } = await l.limit(identifier);
  return { success, remaining, limit, reset, enforced: true };
}

/** Per-IP limit for the public chat endpoint. */
export function checkRateLimit(identifier: string): Promise<RateLimitResult> {
  return check("ratelimit:chat", CHAT_LIMIT, identifier);
}

/** Stricter per-IP limit for the booking write endpoint. */
export function checkBookingRateLimit(identifier: string): Promise<RateLimitResult> {
  return check("ratelimit:book", BOOKING_LIMIT, identifier);
}
