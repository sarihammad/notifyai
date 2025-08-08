import express from "express";
import { query } from "express-validator";
import { validateRequest, authenticateUser } from "../index";
import { getNotificationQueue } from "../../queue/queue";
import logger from "../../utils/logger";

const router = express.Router();

/**
 * GET /usage
 * Get usage statistics for a user
 */
router.get(
  "/usage",
  authenticateUser,
  [
    query("period")
      .optional()
      .isIn(["24h", "7d", "30d", "all"])
      .withMessage("Period must be one of: 24h, 7d, 30d, all"),
  ],
  validateRequest,
  async (req: express.Request, res: express.Response) => {
    try {
      const { period = "24h" } = req.query;
      const userId = req.userId;

      logger.info("Usage statistics requested", {
        userId,
        period,
      });

      // get queue statistics
      const queue = getNotificationQueue(req.redis);
      const queueStats = await queue.getQueueStats();

      // get user-specific metrics from Redis
      const userMetrics = await getUserMetrics(
        req.redis,
        userId,
        period as string
      );

      // calculate summary statistics
      const summary = calculateSummary(userMetrics, queueStats);

      res.json({
        success: true,
        data: {
          userId,
          period,
          summary,
          breakdown: userMetrics.breakdown,
          recentActivity: userMetrics.recentActivity,
          queueStats: {
            waiting: queueStats.waiting,
            active: queueStats.active,
            completed: queueStats.completed,
            failed: queueStats.failed,
          },
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to get usage statistics", {
        userId: req.userId,
        error: errorMessage,
      });

      res.status(500).json({
        error: "Failed to get usage statistics",
        message: "An error occurred while retrieving usage data",
      });
    }
  }
);

/**
 * GET /usage/queue
 * Get detailed queue statistics
 */
router.get(
  "/usage/queue",
  authenticateUser,
  async (req: express.Request, res: express.Response) => {
    try {
      const queue = getNotificationQueue(req.redis);
      const queueStats = await queue.getQueueStats();

      res.json({
        success: true,
        data: {
          queue: queueStats,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to get queue statistics", {
        userId: req.userId,
        error: errorMessage,
      });

      res.status(500).json({
        error: "Failed to get queue statistics",
        message: "An error occurred while retrieving queue data",
      });
    }
  }
);

/**
 * GET /usage/channels
 * Get channel-specific usage statistics
 */
router.get(
  "/usage/channels",
  authenticateUser,
  async (req: express.Request, res: express.Response) => {
    try {
      const userId = req.userId;
      const channelStats = await getChannelStats(req.redis, userId);

      res.json({
        success: true,
        data: {
          userId,
          channels: channelStats,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to get channel statistics", {
        userId: req.userId,
        error: errorMessage,
      });

      res.status(500).json({
        error: "Failed to get channel statistics",
        message: "An error occurred while retrieving channel data",
      });
    }
  }
);

/**
 * Helper function to get user metrics from Redis
 */
async function getUserMetrics(
  redis: any,
  userId: string,
  period: string
): Promise<{
  totalSent: number;
  avgScore: number;
  breakdown: Record<string, number>;
  recentActivity: Array<{
    timestamp: string;
    channel: string;
    score: number;
    status: string;
  }>;
}> {
  const now = Date.now();
  let startTime: number;

  switch (period) {
    case "24h":
      startTime = now - 24 * 60 * 60 * 1000;
      break;
    case "7d":
      startTime = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case "30d":
      startTime = now - 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      startTime = 0; // All time
  }

  // Get user activity from Redis
  const activityKey = `user_activity:${userId}`;
  const activities = await redis.zrangebyscore(
    activityKey,
    startTime,
    now,
    "WITHSCORES"
  );

  const breakdown: Record<string, number> = { slack: 0, email: 0, webhook: 0 };
  const recentActivity: Array<{
    timestamp: string;
    channel: string;
    score: number;
    status: string;
  }> = [];

  let totalScore = 0;
  let count = 0;

  // Parse activities
  for (let i = 0; i < activities.length; i += 2) {
    const activity = JSON.parse(activities[i]);
    const timestamp = parseInt(activities[i + 1]);

    if (activity.channel && breakdown.hasOwnProperty(activity.channel)) {
      breakdown[activity.channel]++;
    }

    if (activity.score) {
      totalScore += activity.score;
      count++;
    }

    recentActivity.push({
      timestamp: new Date(timestamp).toISOString(),
      channel: activity.channel || "unknown",
      score: activity.score || 0,
      status: activity.status || "unknown",
    });
  }

  return {
    totalSent: count,
    avgScore: count > 0 ? totalScore / count : 0,
    breakdown,
    recentActivity: recentActivity.slice(-10), // Last 10 activities
  };
}

/**
 * Helper function to get channel statistics
 */
async function getChannelStats(
  redis: any,
  userId: string
): Promise<
  Record<
    string,
    {
      total: number;
      avgScore: number;
      successRate: number;
      lastUsed: string;
    }
  >
> {
  const channels = ["slack", "email", "webhook"];
  const stats: Record<string, any> = {};

  for (const channel of channels) {
    const channelKey = `user_channel:${userId}:${channel}`;
    const channelData = await redis.hgetall(channelKey);

    stats[channel] = {
      total: parseInt(channelData.total || "0"),
      avgScore: parseFloat(channelData.avgScore || "0"),
      successRate: parseFloat(channelData.successRate || "0"),
      lastUsed: channelData.lastUsed || null,
    };
  }

  return stats;
}

/**
 * Helper function to calculate summary statistics
 */
function calculateSummary(
  userMetrics: any,
  queueStats: any
): {
  totalNotifications: number;
  avgScore: number;
  successRate: number;
  activeJobs: number;
  failedJobs: number;
} {
  const totalNotifications = userMetrics.totalSent;
  const avgScore = userMetrics.avgScore;
  const successRate =
    queueStats.completed > 0
      ? (queueStats.completed / (queueStats.completed + queueStats.failed)) *
        100
      : 0;

  return {
    totalNotifications,
    avgScore: Math.round(avgScore * 100) / 100,
    successRate: Math.round(successRate * 100) / 100,
    activeJobs: queueStats.active,
    failedJobs: queueStats.failed,
  };
}

export default router;
