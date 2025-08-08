import express from "express";
import Redis from "ioredis";
import { server, redis } from "./config";
import { createApp } from "./api";
import { getNotificationWorker } from "./queue/worker";
import logger from "./utils/logger";

/**
 * Main application class
 */
class Application {
  private app: express.Application;
  private redis: Redis;
  private worker: any;
  private server: any;

  constructor() {
    this.redis = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.setupRedis();
    this.app = createApp(this.redis);
    this.setupMiddleware();
  }

  /**
   * Setup Redis connection and event handlers
   */
  private setupRedis(): void {
    this.redis.on("connect", () => {
      logger.info("Redis connected successfully");
    });

    this.redis.on("error", (error) => {
      logger.error("Redis connection error", {
        error: error.message,
      });
    });

    this.redis.on("close", () => {
      logger.warn("Redis connection closed");
    });

    this.redis.on("reconnecting", () => {
      logger.info("Redis reconnecting...");
    });
  }

  /**
   * Setup application middleware
   */
  private setupMiddleware(): void {
    // Add Redis to request object
    this.app.use(
      (req: any, res: express.Response, next: express.NextFunction) => {
        req.redis = this.redis;
        next();
      }
    );

    // Graceful shutdown handler
    process.on("SIGTERM", () => this.gracefulShutdown());
    process.on("SIGINT", () => this.gracefulShutdown());
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    try {
      // Connect to Redis
      await this.redis.connect();
      logger.info("Connected to Redis");

      // Start the worker
      this.worker = getNotificationWorker(this.redis);
      logger.info("Notification worker started");

      // Start the HTTP server
      this.server = this.app.listen(server.port, () => {
        logger.info(`AI Notifier server started on port ${server.port}`, {
          environment: server.nodeEnv,
          port: server.port,
          redisHost: redis.host,
          redisPort: redis.port,
        });
      });

      // Handle server errors
      this.server.on("error", (error: any) => {
        logger.error("Server error", {
          error: error.message,
          code: error.code,
        });
      });
    } catch (error) {
      logger.error("Failed to start application", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      process.exit(1);
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(): Promise<void> {
    logger.info("Received shutdown signal, starting graceful shutdown...");

    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          logger.info("HTTP server closed");
        });
      }

      // Close worker
      if (this.worker) {
        await this.worker.close();
        logger.info("Worker closed");
      }

      // Close Redis connection
      if (this.redis) {
        await this.redis.quit();
        logger.info("Redis connection closed");
      }

      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      process.exit(1);
    }
  }

  /**
   * Get the Express app instance
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Get the Redis instance
   */
  getRedis(): Redis {
    return this.redis;
  }
}

// Create and start the application
const app = new Application();

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled promise rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: promise.toString(),
  });
  process.exit(1);
});

// Start the application
app.start().catch((error) => {
  logger.error("Failed to start application", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  process.exit(1);
});

export default app;
