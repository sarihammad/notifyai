import { Queue, QueueScheduler, Worker } from "bullmq";
import Redis from "ioredis";
import { queue } from "../config";
import logger from "../utils/logger";

// Types for queue jobs
export interface NotificationJob {
  id: string;
  userId: string;
  channel: "slack" | "email" | "webhook";
  message: string;
  metadata?: Record<string, any>;
  score: number;
  priority: "low" | "medium" | "high" | "critical";
  target?: string; // Slack channel, email address, or webhook URL
  createdAt: Date;
}

export interface JobResult {
  success: boolean;
  deliveryTime?: number;
  error?: string;
  attempts: number;
}

/**
 * Queue manager for notification jobs
 */
export class NotificationQueue {
  private queue: Queue;
  private scheduler: QueueScheduler;
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;

    // Create the main queue
    this.queue = new Queue(queue.name, {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        attempts: 3, // Retry failed jobs 3 times
        backoff: {
          type: "exponential",
          delay: 2000, // Start with 2 second delay
        },
      },
    });

    // Create scheduler for delayed jobs
    this.scheduler = new QueueScheduler(queue.name, {
      connection: redis,
    });

    this.setupEventHandlers();
  }

  /**
   * Add a notification job to the queue
   */
  async addJob(
    jobData: Omit<NotificationJob, "id" | "createdAt">
  ): Promise<string> {
    const job = await this.queue.add(
      "notification",
      {
        ...jobData,
        createdAt: new Date(),
      },
      {
        // Set priority based on AI score
        priority: this.getJobPriority(jobData.score),
        // Delay low priority jobs
        delay: this.getJobDelay(jobData.score),
      }
    );

    logger.info("Job added to queue", {
      jobId: job.id,
      userId: jobData.userId,
      channel: jobData.channel,
      score: jobData.score,
      priority: jobData.priority,
    });

    return job.id as string;
  }

  /**
   * Get job priority based on AI score
   */
  private getJobPriority(score: number): number {
    if (score >= 80) return 1; // Critical - highest priority
    if (score >= 60) return 2; // High
    if (score >= 30) return 3; // Medium
    return 4; // Low - lowest priority
  }

  /**
   * Get job delay based on AI score
   */
  private getJobDelay(score: number): number {
    if (score >= 60) return 0; // High priority - no delay
    if (score >= 30) return 5000; // Medium - 5 second delay
    return 30000; // Low - 30 second delay
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<NotificationJob | null> {
    const job = await this.queue.getJob(jobId);
    return job ? (job.data as NotificationJob) : null;
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    attempts: number;
    result?: JobResult;
  } | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    const progress = await job.progress();
    const attempts = job.attemptsMade;

    let result: JobResult | undefined;
    if (state === "completed") {
      result = job.returnvalue as JobResult;
    } else if (state === "failed") {
      result = {
        success: false,
        error: job.failedReason || "Unknown error",
        attempts,
      };
    }

    return {
      status: state,
      progress,
      attempts,
      result,
    };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(): Promise<void> {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    await Promise.all([
      this.queue.clean(oneWeekAgo, "completed"),
      this.queue.clean(oneWeekAgo, "failed"),
    ]);

    logger.info("Cleaned old jobs from queue");
  }

  /**
   * Setup queue event handlers
   */
  private setupEventHandlers(): void {
    this.queue.on("completed", (job) => {
      logger.info("Job completed", {
        jobId: job.id,
        userId: job.data.userId,
        channel: job.data.channel,
        attempts: job.attemptsMade,
      });
    });

    this.queue.on("failed", (job, err) => {
      logger.error("Job failed", {
        jobId: job.id,
        userId: job.data.userId,
        channel: job.data.channel,
        attempts: job.attemptsMade,
        error: err.message,
      });
    });

    this.queue.on("stalled", (jobId) => {
      logger.warn("Job stalled", { jobId });
    });

    this.queue.on("error", (err) => {
      logger.error("Queue error", { error: err.message });
    });
  }

  /**
   * Close queue connections
   */
  async close(): Promise<void> {
    await this.queue.close();
    await this.scheduler.close();
    logger.info("Queue connections closed");
  }

  /**
   * Get queue instance (for worker)
   */
  getQueue(): Queue {
    return this.queue;
  }
}

// Export singleton instance
let queueInstance: NotificationQueue | null = null;

export const getNotificationQueue = (redis: Redis): NotificationQueue => {
  if (!queueInstance) {
    queueInstance = new NotificationQueue(redis);
  }
  return queueInstance;
};
