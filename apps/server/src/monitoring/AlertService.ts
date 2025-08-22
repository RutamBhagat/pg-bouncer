import { failoverLogger, metricsLogger } from "@/logger.js";

export enum NotificationType {
  INSTANCE_DOWN = "instance_down",
  INSTANCE_RECOVERED = "instance_recovered"
}

export interface InstanceNotification {
  type: NotificationType;
  hostId: string;
  hostPriority: number;
  timestamp: string;
  downtime?: number;
  message: string;
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

  private recoveryCount = 0;
  private downCount = 0;

  async sendInstanceNotification(notification: InstanceNotification): Promise<void> {
    this.updateNotificationCount(notification.type);

    const message = this.formatInstanceMessage(notification);

    failoverLogger.info(
      {
        ...notification,
        alertsSent: this.alertChannels.filter((c) => c.enabled).length,
      },
      `${notification.type} detected - sending alerts`
    );

    await this.sendNotificationToChannels(message, notification.type);
  }

  private updateNotificationCount(type: NotificationType): void {
    switch (type) {
      case NotificationType.INSTANCE_RECOVERED:
        this.recoveryCount++;
        break;
      case NotificationType.INSTANCE_DOWN:
        this.downCount++;
        break;
    }
  }

  private formatInstanceMessage(notification: InstanceNotification): string {
    const priorityName = this.getPriorityName(notification.hostPriority);
    
    switch (notification.type) {
      case NotificationType.INSTANCE_RECOVERED:
        return `PgBouncer Instance Recovered

Host: ${notification.hostId} (${priorityName})
Time: ${notification.timestamp}${notification.downtime ? `
Downtime: ${this.formatDuration(notification.downtime)}` : ''}
Total Recoveries: ${this.recoveryCount}

The PgBouncer instance has successfully recovered and is now accepting connections again.`;

      case NotificationType.INSTANCE_DOWN:
        return `PgBouncer Instance Down

Host: ${notification.hostId} (${priorityName})
Time: ${notification.timestamp}
Total Failures: ${this.downCount}

The PgBouncer instance is no longer responding to health checks. This may trigger automatic failover to backup instances.`;

      default:
        return notification.message;
    }
  }

  private getPriorityName(priority: number): string {
    switch (priority) {
      case 1: return "Primary";
      case 2: return "Secondary";
      case 3: return "Tertiary";
      default: return `Priority ${priority}`;
    }
  }

  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private async sendNotificationToChannels(message: string, type: NotificationType): Promise<void> {
    const alertPromises = this.alertChannels
      .filter((channel) => channel.enabled)
      .map((channel) => this.sendToChannelWithType(channel, message, type));

    try {
      await Promise.allSettled(alertPromises);
      metricsLogger.info(
        {
          channelsSent: alertPromises.length,
          event: "notification_sent",
          type,
        },
        "Notifications sent"
      );
    } catch (error) {
      failoverLogger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          type,
        },
        "Failed to send notifications"
      );
    }
  }

  private async sendToChannelWithType(
    channel: AlertChannel,
    message: string,
    type: NotificationType
  ): Promise<void> {
    switch (channel.name) {
      case "slack":
        if (!channel.webhook) {
          failoverLogger.error({ channelName: channel.name }, "Slack webhook URL not configured");
          return;
        }
        await this.sendToSlackWithType(channel.webhook, message, type);
        break;
      default:
        failoverLogger.warn(
          { channelName: channel.name },
          "Unknown alert channel"
        );
    }
  }

  private async sendToSlackWithType(webhook: string, message: string, type: NotificationType): Promise<void> {
    const color = this.getSlackColor(type);
    const icon = this.getSlackIcon(type);

    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attachments: [
            {
              color,
              text: message,
              username: "PgBouncer Monitor",
              icon_emoji: icon,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Slack API error: ${response.status} ${response.statusText}`
        );
      }

      failoverLogger.info(`Slack ${type} alert sent successfully`);
    } catch (error) {
      failoverLogger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          webhook: webhook.substring(0, 50) + "...",
          type,
        },
        "Failed to send Slack alert"
      );
      throw error;
    }
  }

  private getSlackColor(type: NotificationType): string {
    switch (type) {
      case NotificationType.INSTANCE_RECOVERED:
        return "good"; // Green
      case NotificationType.INSTANCE_DOWN:
        return "danger"; // Red
      default:
        return "#808080"; // Gray
    }
  }

  private getSlackIcon(type: NotificationType): string {
    switch (type) {
      case NotificationType.INSTANCE_RECOVERED:
        return ":white_check_mark:";
      case NotificationType.INSTANCE_DOWN:
        return ":x:";
      default:
        return ":information_source:";
    }
  }

  getMetrics() {
    return {
      recoveryCount: this.recoveryCount,
      downCount: this.downCount,
      alertChannels: this.alertChannels.map((c) => ({
        name: c.name,
        enabled: c.enabled,
      })),
    };
  }
}