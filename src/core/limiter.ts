import Redis from "ioredis";
import { rateLimit } from "../config";
import logger from "../utils/logger";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

export class RateLimiter {
  private redis: Redis;
  private windowMs: number;
  private maxRequests: number;

  constructor(redis: Redis) {
    this.redis = redis;
    this.windowMs = rateLimit.windowMs;
    this.maxRequests = rateLimit.maxRequests;
  }

  /**
   * Check if a request is allowed for the given user
   * Uses sliding window algorithm for accurate rate limiting
   */
  async checkRateLimit(userId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const key = `rate_limit:${userId}`;

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Remove expired entries (older than window)
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current requests in window
      pipeline.zcard(key);

      // Add current request timestamp
      pipeline.zadd(key, now, now.toString());

      // Set expiry on the key
      pipeline.expire(key, Math.ceil(this.windowMs / 1000));

      const results = await pipeline.exec();

      if (!results) {
        throw new Error("Redis pipeline failed");
      }

      const currentCount = results[1][1] as number;
      const isAllowed = currentCount < this.maxRequests;

      // Calculate remaining requests
      const remaining = Math.max(0, this.maxRequests - currentCount);

      // Calculate reset time (when the oldest request expires)
      const oldestRequest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const resetTime =
        oldestRequest.length > 0
          ? parseInt(oldestRequest[1]) + this.windowMs
          : now + this.windowMs;

      const result: RateLimitResult = {
        allowed: isAllowed,
        remaining,
        resetTime,
      };

      if (!isAllowed) {
        result.retryAfter = Math.ceil((resetTime - now) / 1000);
      }

      logger.debug("Rate limit check", {
        userId,
        allowed: isAllowed,
        remaining,
        currentCount,
        resetTime: new Date(resetTime).toISOString(),
      });

      return result;
    } catch (error) {
      logger.error("Rate limit check failed", {
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Allow request if rate limiting fails
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetTime: now + this.windowMs,
      };
    }
  }

  /**
   * Get current rate limit status for a user
   */
  async getRateLimitStatus(userId: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const key = `rate_limit:${userId}`;

    try {
      // Clean expired entries
      await this.redis.zremrangebyscore(key, 0, windowStart);

      // Get current count
      const currentCount = await this.redis.zcard(key);
      const isAllowed = currentCount < this.maxRequests;
      const remaining = Math.max(0, this.maxRequests - currentCount);

      // Get oldest request for reset time
      const oldestRequest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
      const resetTime =
        oldestRequest.length > 0
          ? parseInt(oldestRequest[1]) + this.windowMs
          : now + this.windowMs;

      return {
        allowed: isAllowed,
        remaining,
        resetTime,
        retryAfter: !isAllowed
          ? Math.ceil((resetTime - now) / 1000)
          : undefined,
      };
    } catch (error) {
      logger.error("Failed to get rate limit status", {
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        allowed: true,
        remaining: this.maxRequests,
        resetTime: now + this.windowMs,
      };
    }
  }

  /**
   * Reset rate limit for a user (for testing or admin purposes)
   */
  async resetRateLimit(userId: string): Promise<void> {
    const key = `rate_limit:${userId}`;
    await this.redis.del(key);

    logger.info("Rate limit reset", { userId });
  }

  /**
   * Express middleware for rate limiting
   */
  middleware() {
    return async (req: any, res: any, next: any) => {
      const userId = req.userId || req.ip || "anonymous";

      try {
        const result = await this.checkRateLimit(userId);

        // Set rate limit headers
        res.set({
          "X-RateLimit-Limit": this.maxRequests.toString(),
          "X-RateLimit-Remaining": result.remaining.toString(),
          "X-RateLimit-Reset": Math.ceil(result.resetTime / 1000).toString(),
        });

        if (!result.allowed) {
          res.set("Retry-After", result.retryAfter?.toString() || "60");

          logger.warn("Rate limit exceeded", {
            userId,
            ip: req.ip,
            userAgent: req.get("User-Agent"),
          });

          return res.status(429).json({
            error: "Rate limit exceeded",
            message: "Too many requests. Please try again later.",
            retryAfter: result.retryAfter,
          });
        }

        next();
      } catch (error) {
        logger.error("Rate limit middleware error", {
          error: error instanceof Error ? error.message : "Unknown error",
          userId,
        });

        // Allow request if rate limiting fails
        next();
      }
    };
  }
}
