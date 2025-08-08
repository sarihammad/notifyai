import sgMail from "@sendgrid/mail";
import { sendgrid } from "../config";
import logger from "../utils/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  message: string;
  metadata?: Record<string, any>;
}

export interface EmailResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Email service using SendGrid
 */
export class EmailService {
  private apiKey: string | undefined;
  private fromEmail: string | undefined;

  constructor() {
    this.apiKey = sendgrid.apiKey;
    this.fromEmail = sendgrid.fromEmail;

    if (this.apiKey) {
      sgMail.setApiKey(this.apiKey);
    }
  }

  /**
   * Send an email notification
   */
  async sendEmail(message: EmailMessage): Promise<EmailResponse> {
    if (!this.apiKey) {
      throw new Error("SendGrid API key not configured");
    }

    if (!this.fromEmail) {
      throw new Error("From email address not configured");
    }

    try {
      const emailContent = this.buildEmailContent(message);

      const msg = {
        to: message.to,
        from: this.fromEmail,
        subject: message.subject,
        html: emailContent.html,
        text: emailContent.text,
        ...this.buildEmailHeaders(message),
      };

      const response = await sgMail.send(msg);

      logger.info("Email sent successfully", {
        to: message.to,
        subject: message.subject,
        messageId: response[0]?.headers["x-message-id"],
        userId: message.metadata?.userId,
      });

      return {
        success: true,
        messageId: response[0]?.headers["x-message-id"],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error("Failed to send email", {
        to: message.to,
        subject: message.subject,
        error: errorMessage,
        userId: message.metadata?.userId,
      });

      throw new Error(`Email delivery failed: ${errorMessage}`);
    }
  }

  /**
   * Build email content with HTML and text versions
   */
  private buildEmailContent(message: EmailMessage): {
    html: string;
    text: string;
  } {
    const priority = message.metadata?.priority || "medium";
    const priorityColor = this.getPriorityColor(priority);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${message.subject}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: ${priorityColor}; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
          .content { background-color: #f9f9f9; padding: 20px; border-radius: 0 0 5px 5px; }
          .priority { display: inline-block; background-color: ${priorityColor}; color: white; padding: 5px 10px; border-radius: 3px; font-size: 12px; text-transform: uppercase; }
          .metadata { background-color: #f0f0f0; padding: 15px; margin-top: 20px; border-radius: 5px; }
          .metadata-item { margin-bottom: 10px; }
          .metadata-label { font-weight: bold; color: #666; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${message.subject}</h1>
            <span class="priority">${priority}</span>
          </div>
          <div class="content">
            <p>${message.message.replace(/\n/g, "<br>")}</p>
            ${this.buildMetadataHtml(message.metadata)}
          </div>
          <div class="footer">
            <p>Sent by AI Notifier</p>
            <p>${new Date().toLocaleString()}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
${message.subject}
${"=".repeat(message.subject.length)}

Priority: ${priority.toUpperCase()}

${message.message}

${this.buildMetadataText(message.metadata)}

---
Sent by AI Notifier
${new Date().toLocaleString()}
    `.trim();

    return { html, text };
  }

  /**
   * Build metadata HTML
   */
  private buildMetadataHtml(metadata?: Record<string, any>): string {
    if (!metadata || Object.keys(metadata).length === 0) {
      return "";
    }

    let html = '<div class="metadata"><h3>Additional Information</h3>';

    Object.entries(metadata).forEach(([key, value]) => {
      if (key !== "priority" && key !== "userId") {
        html += `
          <div class="metadata-item">
            <span class="metadata-label">${
              key.charAt(0).toUpperCase() + key.slice(1)
            }:</span>
            <span>${String(value)}</span>
          </div>
        `;
      }
    });

    html += "</div>";
    return html;
  }

  /**
   * Build metadata text
   */
  private buildMetadataText(metadata?: Record<string, any>): string {
    if (!metadata || Object.keys(metadata).length === 0) {
      return "";
    }

    let text = "\nAdditional Information:\n";

    Object.entries(metadata).forEach(([key, value]) => {
      if (key !== "priority" && key !== "userId") {
        text += `${key.charAt(0).toUpperCase() + key.slice(1)}: ${String(
          value
        )}\n`;
      }
    });

    return text;
  }

  /**
   * Build email headers
   */
  private buildEmailHeaders(message: EmailMessage): Record<string, any> {
    const headers: Record<string, any> = {};

    // Add custom headers for tracking
    if (message.metadata?.userId) {
      headers["X-User-ID"] = message.metadata.userId;
    }

    if (message.metadata?.priority) {
      headers["X-Priority"] = message.metadata.priority;
    }

    headers["X-Source"] = "ai-notifier";

    return headers;
  }

  /**
   * Get color for priority level
   */
  private getPriorityColor(priority: string): string {
    switch (priority.toLowerCase()) {
      case "critical":
        return "#dc3545"; // Red
      case "high":
        return "#fd7e14"; // Orange
      case "medium":
        return "#ffc107"; // Yellow
      case "low":
        return "#28a745"; // Green
      default:
        return "#6c757d"; // Gray
    }
  }

  /**
   * Test SendGrid connection
   */
  async testConnection(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      // Send a test email to verify API key
      const testMsg = {
        to: "test@example.com",
        from: this.fromEmail || "test@example.com",
        subject: "Test Connection",
        text: "This is a test email to verify SendGrid connection.",
      };

      await sgMail.send(testMsg);
      return true;
    } catch (error) {
      // If it's an invalid recipient error, the API key is working
      if (
        error instanceof Error &&
        error.message.includes("Invalid recipient")
      ) {
        return true;
      }

      logger.error("SendGrid connection test failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return false;
    }
  }

  /**
   * Validate email address format
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
