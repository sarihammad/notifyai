import axios, { AxiosResponse } from "axios";
import logger from "../utils/logger";

export interface WebhookMessage {
  url: string;
  payload: Record<string, any>;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface WebhookResponse {
  success: boolean;
  statusCode?: number;
  responseData?: any;
  error?: string;
}

/**
 * Webhook service for sending notifications to external endpoints
 */
export class WebhookService {
  private defaultTimeout = 10000; // 10 seconds
  private maxTimeout = 30000; // 30 seconds

  /**
   * Send a webhook notification
   */
  async sendWebhook(message: WebhookMessage): Promise<WebhookResponse> {
    try {
      // Validate URL
      if (!this.isValidUrl(message.url)) {
        throw new Error("Invalid webhook URL");
      }

      const timeout = Math.min(
        message.timeout || this.defaultTimeout,
        this.maxTimeout
      );

      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "AI-Notifier/1.0",
        "X-Source": "ai-notifier",
        ...message.headers,
      };

      const response: AxiosResponse = await axios.post(
        message.url,
        message.payload,
        {
          headers,
          timeout,
          validateStatus: (status) => status < 500, // Don't throw on 4xx errors
        }
      );

      logger.info("Webhook sent successfully", {
        url: message.url,
        statusCode: response.status,
        userId: message.payload.userId,
      });

      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        responseData: response.data,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to send webhook", {
        url: message.url,
        error: errorMessage,
        userId: message.payload.userId,
      });

      throw new Error(`Webhook delivery failed: ${errorMessage}`);
    }
  }

  /**
   * Send webhook with retry logic
   */
  async sendWebhookWithRetry(
    message: WebhookMessage,
    maxRetries: number = 3
  ): Promise<WebhookResponse> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.sendWebhook(message);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (error instanceof Error && error.message.includes("4")) {
          throw error;
        }

        if (attempt === maxRetries) {
          break;
        }

        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error("Webhook delivery failed after retries");
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(
    url: string,
    timeout: number = 5000
  ): Promise<{
    reachable: boolean;
    responseTime?: number;
    statusCode?: number;
    error?: string;
  }> {
    try {
      if (!this.isValidUrl(url)) {
        return {
          reachable: false,
          error: "Invalid URL format",
        };
      }

      const startTime = Date.now();

      const response = await axios.get(url, {
        timeout,
        validateStatus: () => true, // Accept any status code
      });

      const responseTime = Date.now() - startTime;

      return {
        reachable: true,
        responseTime,
        statusCode: response.status,
      };
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build standard webhook payload
   */
  static buildPayload(data: {
    message: string;
    metadata?: Record<string, any>;
    userId?: string;
    score?: number;
    priority?: string;
    timestamp?: string;
  }): Record<string, any> {
    return {
      message: data.message,
      metadata: data.metadata || {},
      userId: data.userId,
      score: data.score,
      priority: data.priority,
      timestamp: data.timestamp || new Date().toISOString(),
      source: "ai-notifier",
    };
  }

  /**
   * Validate webhook URL security
   */
  static validateWebhookSecurity(url: string): {
    secure: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let secure = true;

    try {
      const parsed = new URL(url);

      // Check for HTTP (non-secure)
      if (parsed.protocol === "http:") {
        warnings.push("Webhook URL uses HTTP instead of HTTPS");
        secure = false;
      }

      // Check for localhost/private IPs
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === "localhost" ||
        hostname.startsWith("127.") ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("172.")
      ) {
        warnings.push("Webhook URL points to local/private network");
      }

      // Check for common webhook services
      const trustedDomains = [
        "webhook.site",
        "requestbin.com",
        "hookbin.com",
        "pipedream.com",
        "zapier.com",
        "ifttt.com",
        "integromat.com",
      ];

      const isTrusted = trustedDomains.some((domain) =>
        hostname.includes(domain)
      );

      if (!isTrusted) {
        warnings.push("Webhook URL is not from a known webhook service");
      }
    } catch {
      warnings.push("Invalid URL format");
      secure = false;
    }

    return { secure, warnings };
  }
}
