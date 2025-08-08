import winston from "winston";
import { logging } from "../config";

// Custom log format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Simple format for development
const simpleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return `${timestamp} [${level}]: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ""
    }`;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: logging.level,
  format: logging.format === "json" ? logFormat : simpleFormat,
  defaultMeta: { service: "ai-notifier" },
  transports: [
    // Console transport for all environments
    new winston.transports.Console({
      format: logging.format === "json" ? logFormat : simpleFormat,
    }),
    // File transport for production
    ...(logging.level === "production"
      ? [
          new winston.transports.File({
            filename: "logs/error.log",
            level: "error",
            maxsize: 5242880, // 5MB
            maxFiles: 5,
          }),
          new winston.transports.File({
            filename: "logs/combined.log",
            maxsize: 5242880, // 5MB
            maxFiles: 5,
          }),
        ]
      : []),
  ],
});

// Create a stream object for Morgan HTTP logging
export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

// Helper methods for common logging patterns
export const logRequest = (req: any, res: any, next: any) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info("HTTP Request", {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get("User-Agent"),
      ip: req.ip,
      userId: req.userId || "anonymous",
    });
  });

  next();
};

export const logNotification = (data: {
  userId: string;
  channel: string;
  message: string;
  score: number;
  status: "queued" | "delivered" | "failed";
  error?: string;
}) => {
  logger.info("Notification Event", data);
};

export const logQueueEvent = (event: string, jobId: string, data?: any) => {
  logger.info("Queue Event", {
    event,
    jobId,
    ...data,
  });
};

export const logError = (error: Error, context?: any) => {
  logger.error("Application Error", {
    message: error.message,
    stack: error.stack,
    ...context,
  });
};

export default logger;
