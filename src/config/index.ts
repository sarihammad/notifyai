import dotenv from "dotenv";
import { z } from "joi";

// Load environment variables
dotenv.config();

// Configuration schema for validation
const configSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().transform(Number).default("3000"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.string().transform(Number).default("6379"),
  REDIS_PASSWORD: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string(),
  OPENAI_MODEL: z.string().default("gpt-4"),
  OPENAI_MAX_TOKENS: z.string().transform(Number).default("150"),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default("3600000"),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default("100"),

  // Slack
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_DEFAULT_CHANNEL: z.string().default("#general"),

  // SendGrid
  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),

  // Logging
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  LOG_FORMAT: z.enum(["json", "simple"]).default("json"),

  // Retry
  MAX_RETRY_ATTEMPTS: z.string().transform(Number).default("3"),
  RETRY_DELAY_MS: z.string().transform(Number).default("2000"),
  RETRY_BACKOFF_MULTIPLIER: z.string().transform(Number).default("2.5"),

  // Queue
  QUEUE_NAME: z.string().default("notifications"),
  WORKER_CONCURRENCY: z.string().transform(Number).default("5"),
});

// Validate and parse configuration
const config = configSchema.parse(process.env);

// Export typed configuration
export const CONFIG = {
  server: {
    port: config.PORT,
    nodeEnv: config.NODE_ENV,
  },
  redis: {
    url: config.REDIS_URL,
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
  },
  openai: {
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
    maxTokens: config.OPENAI_MAX_TOKENS,
  },
  rateLimit: {
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
  },
  slack: {
    botToken: config.SLACK_BOT_TOKEN,
    defaultChannel: config.SLACK_DEFAULT_CHANNEL,
  },
  sendgrid: {
    apiKey: config.SENDGRID_API_KEY,
    fromEmail: config.SENDGRID_FROM_EMAIL,
  },
  logging: {
    level: config.LOG_LEVEL,
    format: config.LOG_FORMAT,
  },
  retry: {
    maxAttempts: config.MAX_RETRY_ATTEMPTS,
    delayMs: config.RETRY_DELAY_MS,
    backoffMultiplier: config.RETRY_BACKOFF_MULTIPLIER,
  },
  queue: {
    name: config.QUEUE_NAME,
    workerConcurrency: config.WORKER_CONCURRENCY,
  },
} as const;

// Export individual configs for convenience
export const {
  server,
  redis,
  openai,
  rateLimit,
  slack,
  sendgrid,
  logging,
  retry,
  queue,
} = CONFIG;
