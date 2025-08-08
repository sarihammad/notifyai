import { retry } from "../config";
import logger from "../utils/logger";

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  retryCondition?: (error: any) => boolean;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

/**
 * Retry utility with exponential backoff
 */
export class RetryHandler {
  private defaultOptions: Required<RetryOptions>;

  constructor() {
    this.defaultOptions = {
      maxAttempts: retry.maxAttempts,
      delayMs: retry.delayMs,
      backoffMultiplier: retry.backoffMultiplier,
      maxDelayMs: 30000, // 30 seconds max delay
      retryCondition: () => true, // Retry on all errors by default
    };
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    operation: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<RetryResult<T>> {
    const opts = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    let lastError: Error | undefined;
    let currentDelay = opts.delayMs;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        const result = await operation();

        const totalTime = Date.now() - startTime;

        logger.debug("Operation succeeded", {
          attempt,
          totalTimeMs: totalTime,
          maxAttempts: opts.maxAttempts,
        });

        return {
          success: true,
          data: result,
          attempts: attempt,
          totalTimeMs: totalTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry this error
        if (!opts.retryCondition(lastError)) {
          logger.debug("Operation failed with non-retryable error", {
            attempt,
            error: lastError.message,
          });
          break;
        }

        // If this is the last attempt, don't wait
        if (attempt === opts.maxAttempts) {
          logger.warn("Operation failed after all retry attempts", {
            attempts: attempt,
            maxAttempts: opts.maxAttempts,
            error: lastError.message,
            totalTimeMs: Date.now() - startTime,
          });
          break;
        }

        // Log retry attempt
        logger.info("Operation failed, retrying", {
          attempt,
          maxAttempts: opts.maxAttempts,
          delayMs: currentDelay,
          error: lastError.message,
        });

        // Wait before next attempt
        await this.sleep(currentDelay);

        // Calculate next delay with exponential backoff
        currentDelay = Math.min(
          currentDelay * opts.backoffMultiplier,
          opts.maxDelayMs
        );
      }
    }

    const totalTime = Date.now() - startTime;

    return {
      success: false,
      error: lastError,
      attempts: opts.maxAttempts,
      totalTimeMs: totalTime,
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create retry condition for specific error types
   */
  static createRetryCondition(
    retryableErrors: string[] = [],
    nonRetryableErrors: string[] = []
  ) {
    return (error: any): boolean => {
      const errorMessage = error?.message?.toLowerCase() || "";
      const errorCode = error?.code?.toLowerCase() || "";

      // Check for non-retryable errors first
      for (const nonRetryable of nonRetryableErrors) {
        if (
          errorMessage.includes(nonRetryable.toLowerCase()) ||
          errorCode.includes(nonRetryable.toLowerCase())
        ) {
          return false;
        }
      }

      // If specific retryable errors are defined, only retry those
      if (retryableErrors.length > 0) {
        for (const retryable of retryableErrors) {
          if (
            errorMessage.includes(retryable.toLowerCase()) ||
            errorCode.includes(retryable.toLowerCase())
          ) {
            return true;
          }
        }
        return false;
      }

      // Default: retry all errors
      return true;
    };
  }

  /**
   * Common retry conditions for different services
   */
  static conditions = {
    // Retry on network errors and 5xx server errors
    network: RetryHandler.createRetryCondition(
      ["timeout", "network", "connection", "econnrefused", "enotfound"],
      ["unauthorized", "forbidden", "bad request", "not found"]
    ),

    // Retry on temporary Slack API errors
    slack: RetryHandler.createRetryCondition(
      ["rate_limited", "timeout", "server_error", "service_unavailable"],
      ["invalid_token", "channel_not_found", "user_not_found"]
    ),

    // Retry on temporary email service errors
    email: RetryHandler.createRetryCondition(
      ["timeout", "quota_exceeded", "service_unavailable", "temporary_failure"],
      ["invalid_email", "bounce", "spam", "blocked"]
    ),

    // Retry on webhook delivery errors
    webhook: RetryHandler.createRetryCondition(
      ["timeout", "connection", "server_error", "service_unavailable"],
      ["unauthorized", "forbidden", "not_found", "bad_request"]
    ),
  };
}

// Export singleton instance
export const retryHandler = new RetryHandler();
