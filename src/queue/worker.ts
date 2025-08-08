import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { queue } from "../config";
import { NotificationJob, JobResult } from "./queue";
import { SlackService } from "../services/slack";
import { EmailService } from "../services/email";
import { WebhookService } from "../services/webhook";
import { retryHandler, RetryHandler } from "../core/retry";
import logger from "../utils/logger";

/**
 * Worker for processing notification jobs
 */
export class NotificationWorker {
  private worker: Worker;
  private redis: Redis;
  private slackService: SlackService;
  private emailService: EmailService;
  private webhookService: WebhookService;

  constructor(redis: Redis) {
    this.redis = redis;
    this.slackService = new SlackService();
    this.emailService = new EmailService();
    this.webhookService = new WebhookService();

    // Create worker
    this.worker = new Worker(queue.name, this.processJob.bind(this), {
      connection: redis,
      concurrency: queue.workerConcurrency,
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.setupEventHandlers();
  }

  /**
   * Process a notification job
   */
  private async processJob(job: Job): Promise<JobResult> {
    const startTime = Date.now();
    const notificationJob = job.data as NotificationJob;

    logger.info("Processing notification job", {
      jobId: job.id,
      userId: notificationJob.userId,
      channel: notificationJob.channel,
      score: notificationJob.score,
      priority: notificationJob.priority,
      attempts: job.attemptsMade,
    });

    try {
      let result: JobResult;

      // Route to appropriate delivery service
      switch (notificationJob.channel) {
        case "slack":
          result = await this.deliverToSlack(notificationJob);
          break;
        case "email":
          result = await this.deliverToEmail(notificationJob);
          break;
        case "webhook":
          result = await this.deliverToWebhook(notificationJob);
          break;
        default:
          throw new Error(`Unsupported channel: ${notificationJob.channel}`);
      }

      const deliveryTime = Date.now() - startTime;
      result.deliveryTime = deliveryTime;

      // Log successful delivery
      logger.info("Notification delivered successfully", {
        jobId: job.id,
        userId: notificationJob.userId,
        channel: notificationJob.channel,
        deliveryTime,
        attempts: job.attemptsMade,
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to process notification job", {
        jobId: job.id,
        userId: notificationJob.userId,
        channel: notificationJob.channel,
        error: errorMessage,
        attempts: job.attemptsMade,
      });

      // Return failure result
      return {
        success: false,
        error: errorMessage,
        attempts: job.attemptsMade,
      };
    }
  }

  /**
   * Deliver notification to Slack
   */
  private async deliverToSlack(job: NotificationJob): Promise<JobResult> {
    const result = await retryHandler.execute(
      () =>
        this.slackService.sendMessage({
          channel: job.target || "#general",
          message: job.message,
          metadata: job.metadata,
        }),
      {
        retryCondition: RetryHandler.conditions.slack,
      }
    );

    return {
      success: result.success,
      error: result.error?.message,
      attempts: result.attempts,
    };
  }

  /**
   * Deliver notification via email
   */
  private async deliverToEmail(job: NotificationJob): Promise<JobResult> {
    if (!job.target) {
      throw new Error("Email target address is required");
    }

    const result = await retryHandler.execute(
      () =>
        this.emailService.sendEmail({
          to: job.target,
          subject: job.metadata?.subject || "Notification",
          message: job.message,
          metadata: job.metadata,
        }),
      {
        retryCondition: RetryHandler.conditions.email,
      }
    );

    return {
      success: result.success,
      error: result.error?.message,
      attempts: result.attempts,
    };
  }

  /**
   * Deliver notification via webhook
   */
  private async deliverToWebhook(job: NotificationJob): Promise<JobResult> {
    if (!job.target) {
      throw new Error("Webhook URL is required");
    }

    const result = await retryHandler.execute(
      () =>
        this.webhookService.sendWebhook({
          url: job.target,
          payload: {
            message: job.message,
            metadata: job.metadata,
            userId: job.userId,
            score: job.score,
            priority: job.priority,
            timestamp: new Date().toISOString(),
          },
        }),
      {
        retryCondition: RetryHandler.conditions.webhook,
      }
    );

    return {
      success: result.success,
      error: result.error?.message,
      attempts: result.attempts,
    };
  }

  /**
   * Setup worker event handlers
   */
  private setupEventHandlers(): void {
    this.worker.on("completed", (job) => {
      logger.info("Worker completed job", {
        jobId: job.id,
        userId: job.data.userId,
        channel: job.data.channel,
      });
    });

    this.worker.on("failed", (job, err) => {
      logger.error("Worker failed job", {
        jobId: job?.id,
        userId: job?.data?.userId,
        channel: job?.data?.channel,
        error: err.message,
        attempts: job?.attemptsMade,
      });
    });

    this.worker.on("error", (err) => {
      logger.error("Worker error", { error: err.message });
    });

    this.worker.on("stalled", (jobId) => {
      logger.warn("Worker job stalled", { jobId });
    });
  }

  /**
   * Close worker
   */
  async close(): Promise<void> {
    await this.worker.close();
    logger.info("Worker closed");
  }

  /**
   * Get worker status
   */
  async getStatus(): Promise<{
    isRunning: boolean;
    concurrency: number;
    activeJobs: number;
  }> {
    const isRunning = this.worker.isRunning();
    const concurrency = this.worker.concurrency;
    const activeJobs = await this.worker.getActiveCount();

    return {
      isRunning,
      concurrency,
      activeJobs,
    };
  }
}

// Export singleton instance
let workerInstance: NotificationWorker | null = null;

export const getNotificationWorker = (redis: Redis): NotificationWorker => {
  if (!workerInstance) {
    workerInstance = new NotificationWorker(redis);
  }
  return workerInstance;
};
