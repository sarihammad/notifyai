import axios from "axios";
import { slack } from "../config";
import logger from "../utils/logger";

export interface SlackMessage {
  channel: string;
  message: string;
  metadata?: Record<string, any>;
}

export interface SlackResponse {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
}

/**
 * Slack service for sending notifications
 */
export class SlackService {
  private baseUrl = "https://slack.com/api";
  private token: string | undefined;

  constructor() {
    this.token = slack.botToken;
  }

  /**
   * Send a message to Slack
   */
  async sendMessage(message: SlackMessage): Promise<SlackResponse> {
    if (!this.token) {
      throw new Error("Slack bot token not configured");
    }

    try {
      const payload = this.buildMessagePayload(message);

      const response = await axios.post(
        `${this.baseUrl}/chat.postMessage`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 second timeout
        }
      );

      const result = response.data;

      if (!result.ok) {
        throw new Error(`Slack API error: ${result.error || "Unknown error"}`);
      }

      logger.info("Slack message sent successfully", {
        channel: message.channel,
        messageId: result.ts,
        userId: message.metadata?.userId,
      });

      return {
        ok: true,
        channel: result.channel,
        ts: result.ts,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to send Slack message", {
        channel: message.channel,
        error: errorMessage,
        userId: message.metadata?.userId,
      });

      throw new Error(`Slack delivery failed: ${errorMessage}`);
    }
  }

  /**
   * Build the message payload for Slack API
   */
  private buildMessagePayload(message: SlackMessage): any {
    const payload: any = {
      channel: message.channel,
      text: message.message,
    };

    // Add metadata as attachments if provided
    if (message.metadata && Object.keys(message.metadata).length > 0) {
      const attachment = {
        color: this.getPriorityColor(message.metadata.priority),
        fields: [] as any[],
        footer: "AI Notifier",
        ts: Math.floor(Date.now() / 1000),
      };

      // Add metadata fields
      Object.entries(message.metadata).forEach(([key, value]) => {
        if (key !== "priority" && key !== "userId") {
          attachment.fields.push({
            title: key.charAt(0).toUpperCase() + key.slice(1),
            value: String(value),
            short: true,
          });
        }
      });

      // Add priority field
      if (message.metadata.priority) {
        attachment.fields.push({
          title: "Priority",
          value: message.metadata.priority.toUpperCase(),
          short: true,
        });
      }

      payload.attachments = [attachment];
    }

    return payload;
  }

  /**
   * Get color for priority level
   */
  private getPriorityColor(priority?: string): string {
    switch (priority?.toLowerCase()) {
      case "critical":
        return "#ff0000"; // Red
      case "high":
        return "#ff9900"; // Orange
      case "medium":
        return "#ffff00"; // Yellow
      case "low":
        return "#00ff00"; // Green
      default:
        return "#36a64f"; // Default green
    }
  }

  /**
   * Test Slack connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.token) {
      return false;
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/auth.test`,
        {},
        {
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          timeout: 5000,
        }
      );

      const result = response.data;
      return result.ok === true;
    } catch (error) {
      logger.error("Slack connection test failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channel: string): Promise<{
    id: string;
    name: string;
    isMember: boolean;
  } | null> {
    if (!this.token) {
      return null;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/conversations.info`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        params: {
          channel: channel.startsWith("#") ? channel.slice(1) : channel,
        },
        timeout: 5000,
      });

      const result = response.data;

      if (!result.ok) {
        return null;
      }

      return {
        id: result.channel.id,
        name: result.channel.name,
        isMember: result.channel.is_member,
      };
    } catch (error) {
      logger.error("Failed to get channel info", {
        channel,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }
}
