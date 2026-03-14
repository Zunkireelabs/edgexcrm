import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // Unix epoch seconds
  retryAfterSeconds: number;
}

export const FORM_SUBMIT_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 600_000, // 10 minutes
};

export const INTEGRATION_LIMIT: RateLimitConfig = {
  maxRequests: 120,
  windowMs: 60_000, // 1 minute
};

export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const supabase = await createServiceClient();
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowMs);
    const expiresAt = new Date(now.getTime() + config.windowMs);

    // Try to get existing rate limit entry
    const { data: existing } = await supabase
      .from("rate_limits")
      .select("count, window_start")
      .eq("key", key)
      .single();

    if (existing && new Date(existing.window_start) > windowStart) {
      // Within current window
      const windowEnd = new Date(
        new Date(existing.window_start).getTime() + config.windowMs
      );
      const resetAt = Math.ceil(windowEnd.getTime() / 1000);

      if (existing.count >= config.maxRequests) {
        const retryAfterSeconds = Math.ceil(
          (windowEnd.getTime() - now.getTime()) / 1000
        );
        return {
          allowed: false,
          remaining: 0,
          limit: config.maxRequests,
          resetAt,
          retryAfterSeconds: Math.max(retryAfterSeconds, 1),
        };
      }

      // Increment count
      const { error } = await supabase
        .from("rate_limits")
        .update({ count: existing.count + 1, expires_at: expiresAt })
        .eq("key", key);

      if (error) {
        logger.error({ err: error, key }, "Failed to update rate limit");
        return { allowed: false, remaining: 0, limit: config.maxRequests, resetAt, retryAfterSeconds: 60 };
      }

      return {
        allowed: true,
        remaining: config.maxRequests - existing.count - 1,
        limit: config.maxRequests,
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    // New window or expired — upsert
    const resetAt = Math.ceil(expiresAt.getTime() / 1000);

    const { error } = await supabase.from("rate_limits").upsert(
      {
        key,
        count: 1,
        window_start: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "key" }
    );

    if (error) {
      logger.error({ err: error, key }, "Failed to upsert rate limit");
      return { allowed: false, remaining: 0, limit: config.maxRequests, resetAt, retryAfterSeconds: 60 };
    }

    // Probabilistic cleanup (1% chance)
    if (Math.random() < 0.01) {
      supabase
        .from("rate_limits")
        .delete()
        .lt("expires_at", now.toISOString())
        .then(({ error }) => {
          if (error) {
            logger.error({ err: error }, "Failed to cleanup expired rate limits");
          }
        });
    }

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      limit: config.maxRequests,
      resetAt,
      retryAfterSeconds: 0,
    };
  } catch (err) {
    // Fail closed
    logger.error({ err, key }, "Rate limiter error — failing closed");
    const resetAt = Math.ceil((Date.now() + config.windowMs) / 1000);
    return { allowed: false, remaining: 0, limit: config.maxRequests, resetAt, retryAfterSeconds: 60 };
  }
}
