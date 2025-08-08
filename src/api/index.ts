import express from "express";
import cors from "cors";
import helmet from "helmet";
import { body, validationResult } from "express-validator";
import { logRequest } from "../utils/logger";
import { RateLimiter } from "../core/limiter";
import { getNotificationQueue } from "../queue/queue";
import { aiScorer } from "../core/scorer";
import notifyRoutes from "./routes/notify";
import metricsRoutes from "./routes/metrics";
import healthRoutes from "./routes/health";

/**
 * Create and configure the Express application
 */
export function createApp(redis: any): express.Application {
  const app = express();
  const rateLimiter = new RateLimiter(redis);

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable for API
    })
  );
  app.use(
    cors({
      origin:
        process.env.NODE_ENV === "production"
          ? process.env.ALLOWED_ORIGINS?.split(",") || []
          : true,
      credentials: true,
    })
  );

  // Body parsing middleware
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Request logging middleware
  app.use(logRequest);

  // Rate limiting middleware
  app.use(rateLimiter.middleware());

  // Health check endpoint
  app.use("/health", healthRoutes);

  // API routes
  app.use("/api/v1", notifyRoutes);
  app.use("/api/v1", metricsRoutes);

  // Global error handler
  app.use(
    (
      error: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      console.error("Unhandled error:", error);

      res.status(500).json({
        error: "Internal server error",
        message:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Something went wrong",
      });
    }
  );

  // 404 handler
  app.use("*", (req: express.Request, res: express.Response) => {
    res.status(404).json({
      error: "Not found",
      message: `Route ${req.method} ${req.originalUrl} not found`,
    });
  });

  return app;
}

/**
 * Validation helper for API routes
 */
export function validateRequest(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: "Validation failed",
      message: "Invalid request data",
      details: errors.array(),
    });
  }
  next();
}

/**
 * Authentication middleware (placeholder for future implementation)
 */
export function authenticateUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  // For now, extract user ID from headers or query params
  // In production, this should validate JWT tokens or API keys
  const userId =
    (req.headers["x-user-id"] as string) ||
    (req.query.userId as string) ||
    (req.body.userId as string) ||
    "anonymous";

  if (!userId) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "User ID is required",
    });
  }

  req.userId = userId;
  next();
}

/**
 * Common validation schemas
 */
export const notificationValidation = [
  body("userId")
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("User ID is required and must be 1-100 characters"),

  body("channel")
    .isIn(["slack", "email", "webhook"])
    .withMessage("Channel must be one of: slack, email, webhook"),

  body("message")
    .isString()
    .trim()
    .isLength({ min: 1, max: 10000 })
    .withMessage("Message is required and must be 1-10000 characters"),

  body("metadata")
    .optional()
    .isObject()
    .withMessage("Metadata must be an object"),

  body("target")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Target must be 1-500 characters if provided"),
];
