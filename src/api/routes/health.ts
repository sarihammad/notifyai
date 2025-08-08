import express from "express";
import { SlackService } from "../../services/slack";
import { EmailService } from "../../services/email";
import { WebhookService } from "../../services/webhook";
import { getNotificationQueue } from "../../queue/queue";
import { getNotificationWorker } from "../../queue/worker";
import logger from "../../utils/logger";

const router = express.Router();

/**
 * GET /health
 * Basic health check endpoint
 */
router.get("/", async (req: express.Request, res: express.Response) => {
  try {
    const startTime = Date.now();

    //health check
    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV || "development",
    };

    const responseTime = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        ...health,
        responseTime: `${responseTime}ms`,
      },
    });
  } catch (error) {
    logger.error("Health check failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    res.status(503).json({
      success: false,
      error: "Service unhealthy",
      message: "Health check failed",
    });
  }
});

/**
 * GET /health/detailed
 * Detailed health check with service status
 */
router.get("/detailed", async (req: express.Request, res: express.Response) => {
  try {
    const startTime = Date.now();
    const checks: Record<string, any> = {};

    // Redis connection check
    try {
      const redis = req.redis;
      await redis.ping();
      checks.redis = {
        status: "healthy",
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      checks.redis = {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // queue status check
    try {
      const queue = getNotificationQueue(req.redis);
      const queueStats = await queue.getQueueStats();
      checks.queue = {
        status: "healthy",
        stats: queueStats,
      };
    } catch (error) {
      checks.queue = {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // worker status check
    try {
      const worker = getNotificationWorker(req.redis);
      const workerStatus = await worker.getStatus();
      checks.worker = {
        status: "healthy",
        status: workerStatus,
      };
    } catch (error) {
      checks.worker = {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // slack service check
    try {
      const slackService = new SlackService();
      const slackHealthy = await slackService.testConnection();
      checks.slack = {
        status: slackHealthy ? "healthy" : "unhealthy",
        configured: !!process.env.SLACK_BOT_TOKEN,
      };
    } catch (error) {
      checks.slack = {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    // email service check
    try {
      const emailService = new EmailService();
      const emailHealthy = await emailService.testConnection();
      checks.email = {
        status: emailHealthy ? "healthy" : "unhealthy",
        configured: !!process.env.SENDGRID_API_KEY,
      };
    } catch (error) {
      checks.email = {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }

    //determine overall health
    const allHealthy = Object.values(checks).every(
      (check) => check.status === "healthy"
    );
    const overallStatus = allHealthy ? "healthy" : "degraded";

    const responseTime = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        responseTime: `${responseTime}ms`,
        checks,
      },
    });
  } catch (error) {
    logger.error("Detailed health check failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    res.status(503).json({
      success: false,
      error: "Service unhealthy",
      message: "Detailed health check failed",
    });
  }
});

/**
 * GET /health/ready
 * Readiness probe for Kubernetes
 */
router.get("/ready", async (req: express.Request, res: express.Response) => {
  try {
    //check if Redis is available
    const redis = req.redis;
    await redis.ping();

    //check if queue is accessible
    const queue = getNotificationQueue(req.redis);
    await queue.getQueueStats();

    res.json({
      success: true,
      status: "ready",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Readiness check failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    res.status(503).json({
      success: false,
      status: "not ready",
      message: "Service is not ready to accept requests",
    });
  }
});

/**
 * GET /health/live
 * Liveness probe for Kubernetes
 */
router.get("/live", (req: express.Request, res: express.Response) => {
  res.json({
    success: true,
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
