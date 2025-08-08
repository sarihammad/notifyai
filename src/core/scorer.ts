import OpenAI from "openai";
import { openai } from "../config";
import logger from "../utils/logger";

// Types for scoring
export interface ScoringRequest {
  message: string;
  metadata?: Record<string, any>;
  userId: string;
  channel: string;
}

export interface ScoringResult {
  score: number; // 0-100
  reasoning: string;
  priority: "low" | "medium" | "high" | "critical";
  shouldSend: boolean;
}

export class AIScorer {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: openai.apiKey,
    });
  }

  /**
   * Score a notification message using OpenAI
   * Returns a score from 0-100 indicating importance
   */
  async scoreMessage(request: ScoringRequest): Promise<ScoringResult> {
    try {
      const prompt = this.buildScoringPrompt(request);

      const response = await this.openai.chat.completions.create({
        model: openai.model,
        messages: [
          {
            role: "system",
            content: `You are an AI assistant that scores notification messages for importance and urgency. 
            Analyze the message content, context, and metadata to determine how critical this notification is.
            Consider factors like:
            - Urgency of the situation
            - Impact on business operations
            - Time sensitivity
            - User role and context
            - Channel appropriateness
            
            Respond with a JSON object containing:
            - score: number (0-100, where 0=not important, 100=critical)
            - reasoning: string explaining your score
            - priority: "low" | "medium" | "high" | "critical"
            - shouldSend: boolean (whether this should be sent immediately)`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: openai.maxTokens,
        temperature: 0.3, // Lower temperature for more consistent scoring
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from OpenAI");
      }

      const result = this.parseScoringResponse(content);

      logger.info("Message scored", {
        userId: request.userId,
        score: result.score,
        priority: result.priority,
        shouldSend: result.shouldSend,
        messageLength: request.message.length,
      });

      return result;
    } catch (error) {
      logger.error("Error scoring message", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: request.userId,
        message: request.message.substring(0, 100) + "...",
      });

      // Fallback to medium priority if AI scoring fails
      return {
        score: 50,
        reasoning: "Fallback score due to AI scoring error",
        priority: "medium",
        shouldSend: true,
      };
    }
  }

  /**
   * Build the prompt for AI scoring
   */
  private buildScoringPrompt(request: ScoringRequest): string {
    const { message, metadata, userId, channel } = request;

    let prompt = `Please score this notification message for importance:\n\n`;
    prompt += `Message: "${message}"\n`;
    prompt += `Channel: ${channel}\n`;
    prompt += `User ID: ${userId}\n`;

    if (metadata) {
      prompt += `Metadata: ${JSON.stringify(metadata)}\n`;
    }

    prompt += `\nConsider the urgency, business impact, and whether this notification should be sent immediately.`;

    return prompt;
  }

  /**
   * Parse the AI response into a structured result
   */
  private parseScoringResponse(content: string): ScoringResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        return {
          score: Math.max(0, Math.min(100, Number(parsed.score) || 50)),
          reasoning: parsed.reasoning || "No reasoning provided",
          priority: this.validatePriority(parsed.priority),
          shouldSend: Boolean(parsed.shouldSend),
        };
      }
    } catch (error) {
      logger.warn("Failed to parse AI response as JSON", { content });
    }

    // Fallback parsing
    const scoreMatch = content.match(/score[:\s]*(\d+)/i);
    const priorityMatch = content.match(
      /priority[:\s]*(low|medium|high|critical)/i
    );
    const shouldSendMatch = content.match(/shouldSend[:\s]*(true|false)/i);

    return {
      score: scoreMatch
        ? Math.max(0, Math.min(100, Number(scoreMatch[1])))
        : 50,
      reasoning: content.substring(0, 200),
      priority: this.validatePriority(priorityMatch?.[1] || "medium"),
      shouldSend: shouldSendMatch ? shouldSendMatch[1] === "true" : true,
    };
  }

  /**
   * Validate and normalize priority values
   */
  private validatePriority(
    priority: string
  ): "low" | "medium" | "high" | "critical" {
    const validPriorities = ["low", "medium", "high", "critical"] as const;
    const normalized = priority?.toLowerCase();

    if (validPriorities.includes(normalized as any)) {
      return normalized as "low" | "medium" | "high" | "critical";
    }

    return "medium";
  }

  /**
   * Get priority level based on score
   */
  static getPriorityFromScore(
    score: number
  ): "low" | "medium" | "high" | "critical" {
    if (score >= 80) return "critical";
    if (score >= 60) return "high";
    if (score >= 30) return "medium";
    return "low";
  }
}

// Export singleton instance
export const aiScorer = new AIScorer();
