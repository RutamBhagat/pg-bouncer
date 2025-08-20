import { failoverLogger, metricsLogger } from "@/logger.js";

export interface FailoverEvent {
  fromHost: string;
  toHost: string;
  toHostPriority: number;
  timestamp: string;
  event: "failover_detected";
}

export interface AlertChannel {
  name: string;
  webhook?: string;
  enabled: boolean;
}

export class AlertService {
  private alertChannels: AlertChannel[] = [
    {
      name: "slack",
      webhook: process.env.SLACK_WEBHOOK_URL,
      enabled: !!process.env.SLACK_WEBHOOK_URL,
    },
  ];

  private lastFailoverTime: Date | null = null;
  private failoverCount = 0;
  private readonly cooldownPeriod = 5 * 60 * 1000; // 5 minutes

  async sendFailoverAlert(event: FailoverEvent): Promise<void> {
    const now = new Date();

    // Check if we're in cooldown period to avoid spam`
    if (
      this.lastFailoverTime &&
      now.getTime() - this.lastFailoverTime.getTime() < this.cooldownPeriod
    ) {
      failoverLogger.debug("Failover alert suppressed due to cooldown period");
      return;
    }

    this.failoverCount++;
    this.lastFailoverTime = now;

    const message = this.formatFailoverMessage(event);

    failoverLogger.warn(
      {
        ...event,
        failoverCount: this.failoverCount,
        alertsSent: this.alertChannels.filter((c) => c.enabled).length,
      },
      "Failover detected - sending alerts"
    );

    // Send to all enabled channels
    const alertPromises = this.alertChannels
      .filter((channel) => channel.enabled)
      .map((channel) => this.sendToChannel(channel, message));

    try {
      await Promise.allSettled(alertPromises);
      metricsLogger.info(
        {
          channelsSent: alertPromises.length,
          event: "alerts_sent",
        },
        "Failover alerts sent"
      );
    } catch (error) {
      failoverLogger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to send failover alerts"
      );
    }
  }

  private formatFailoverMessage(event: FailoverEvent): string {
    return `🚨 **PgBouncer Failover Detected** 🚨
    
**From:** ${event.fromHost}
**To:** ${event.toHost} (Priority: ${event.toHostPriority})
**Time:** ${event.timestamp}
**Total Failovers:** ${this.failoverCount}

This indicates that the primary database connection failed and the system automatically switched to a backup. Please investigate the source of the connection failure.`;
  }

  private async sendToChannel(
    channel: AlertChannel,
    message: string
  ): Promise<void> {
    switch (channel.name) {
      case "slack":
        await this.sendToSlack(channel.webhook!, message);
        break;
      default:
        failoverLogger.warn(
          { channelName: channel.name },
          "Unknown alert channel"
        );
    }
  }

  private async sendToSlack(webhook: string, message: string): Promise<void> {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: message,
          username: "PgBouncer Monitor",
          icon_emoji: ":warning:",
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Slack API error: ${response.status} ${response.statusText}`
        );
      }

      failoverLogger.info("Slack alert sent successfully");
    } catch (error) {
      failoverLogger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          webhook: webhook.substring(0, 50) + "...", // Only log part of webhook for security
        },
        "Failed to send Slack alert"
      );
      throw error;
    }
  }

  getMetrics() {
    return {
      failoverCount: this.failoverCount,
      lastFailoverTime: this.lastFailoverTime?.toISOString() || null,
      alertChannels: this.alertChannels.map((c) => ({
        name: c.name,
        enabled: c.enabled,
      })),
    };
  }
}
