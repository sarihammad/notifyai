import express from "express";
import { body } from "express-validator";
import {
  validateRequest,
  authenticateUser,
  notificationValidation,
} from "../index";
import { aiScorer } from "../../core/scorer";
import { getNotificationQueue } from "../../queue/queue";
import { logNotification } from "../../utils/logger";
import logger from "../../utils/logger";

const router = express.Router();

/**
 * POST /notify
 * Send a notification with AI scoring
 */
router.post(
  "/notify",
  authenticateUser,
  notificationValidation,
  validateRequest,
  async (req: express.Request, res: express.Response) => {
    try {
      const { userId, channel, message, metadata, target } = req.body;

      logger.info("Notification request received", {
        userId,
        channel,
        messageLength: message.length,
        hasMetadata: !!metadata,
        hasTarget: !!target,
      });

      // Step 1: Score the message using AI
      const scoringResult = await aiScorer.scoreMessage({
        message,
        metadata,
        userId,
        channel,
      });

      logger.info("Message scored by AI", {
        userId,
        score: scoringResult.score,
        priority: scoringResult.priority,
        reasoning: scoringResult.reasoning,
        shouldSend: scoringResult.shouldSend,
      });

      // Step 2: Add job to queue
      const queue = getNotificationQueue(req.redis);
      const jobId = await queue.addJob({
        userId,
        channel,
        message,
        metadata: {
          ...metadata,
          priority: scoringResult.priority,
          reasoning: scoringResult.reasoning,
          shouldSend: scoringResult.shouldSend,
        },
        score: scoringResult.score,
        priority: scoringResult.priority,
        target,
      });

      // Step 3: Log the notification event
      logNotification({
        userId,
        channel,
        message,
        score: scoringResult.score,
        status: "queued",
      });

      // Step 4: Return response
      res.status(202).json({
        success: true,
        message: "Notification queued successfully",
        data: {
          jobId,
          score: scoringResult.score,
          priority: scoringResult.priority,
          reasoning: scoringResult.reasoning,
          estimatedDelivery: getEstimatedDeliveryTime(scoringResult.score),
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to process notification request", {
        userId: req.userId,
        error: errorMessage,
        body: req.body,
      });

      res.status(500).json({
        error: "Failed to process notification",
        message: "An error occurred while processing your request",
        details:
          process.env.NODE_ENV === "development" ? errorMessage : undefined,
      });
    }
  }
);

/**
 * GET /notify/:jobId
 * Get status of a notification job
 */
router.get(
  "/notify/:jobId",
  authenticateUser,
  async (req: express.Request, res: express.Response) => {
    try {
      const { jobId } = req.params;
      const queue = getNotificationQueue(req.redis);

      const jobStatus = await queue.getJobStatus(jobId);

      if (!jobStatus) {
        return res.status(404).json({
          error: "Job not found",
          message: "The specified job ID was not found",
        });
      }

      res.json({
        success: true,
        data: {
          jobId,
          status: jobStatus.status,
          progress: jobStatus.progress,
          attempts: jobStatus.attempts,
          result: jobStatus.result,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to get job status", {
        jobId: req.params.jobId,
        userId: req.userId,
        error: errorMessage,
      });

      res.status(500).json({
        error: "Failed to get job status",
        message: "An error occurred while retrieving job status",
      });
    }
  }
);

/**
 * POST /notify/batch
 * Send multiple notifications in a batch
 */
router.post(
  "/notify/batch",
  authenticateUser,
  [
    body("notifications")
      .isArray({ min: 1, max: 10 })
      .withMessage("Notifications must be an array with 1-10 items"),
    body("notifications.*.channel")
      .isIn(["slack", "email", "webhook"])
      .withMessage("Channel must be one of: slack, email, webhook"),
    body("notifications.*.message")
      .isString()
      .trim()
      .isLength({ min: 1, max: 10000 })
      .withMessage("Message is required and must be 1-10000 characters"),
    body("notifications.*.metadata")
      .optional()
      .isObject()
      .withMessage("Metadata must be an object"),
    body("notifications.*.target")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage("Target must be 1-500 characters if provided"),
  ],
  validateRequest,
  async (req: express.Request, res: express.Response) => {
    try {
      const { notifications } = req.body;
      const queue = getNotificationQueue(req.redis);
      const results = [];

      logger.info("Batch notification request received", {
        userId: req.userId,
        count: notifications.length,
      });

      // Process each notification
      for (const notification of notifications) {
        try {
          // Score the message
          const scoringResult = await aiScorer.scoreMessage({
            message: notification.message,
            metadata: notification.metadata,
            userId: req.userId,
            channel: notification.channel,
          });

          // Add to queue
          const jobId = await queue.addJob({
            userId: req.userId,
            channel: notification.channel,
            message: notification.message,
            metadata: {
              ...notification.metadata,
              priority: scoringResult.priority,
              reasoning: scoringResult.reasoning,
            },
            score: scoringResult.score,
            priority: scoringResult.priority,
            target: notification.target,
          });

          results.push({
            success: true,
            jobId,
            score: scoringResult.score,
            priority: scoringResult.priority,
          });
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;

      logger.info("Batch notification processed", {
        userId: req.userId,
        total: notifications.length,
        successful: successCount,
        failed: notifications.length - successCount,
      });

      res.status(202).json({
        success: true,
        message: `Processed ${notifications.length} notifications`,
        data: {
          total: notifications.length,
          successful: successCount,
          failed: notifications.length - successCount,
          results,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to process batch notification", {
        userId: req.userId,
        error: errorMessage,
      });

      res.status(500).json({
        error: "Failed to process batch notification",
        message: "An error occurred while processing the batch request",
      });
    }
  }
);

/**
 * Helper function to estimate delivery time based on score
 */
function getEstimatedDeliveryTime(score: number): string {
  if (score >= 80) return "immediate";
  if (score >= 60) return "within 5 minutes";
  if (score >= 30) return "within 10 minutes";
  return "within 30 minutes";
}

export default router;
