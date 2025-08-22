import { failoverLogger, metricsLogger } from "@/logger.js";

export interface FailoverEvent {
  fromHost: string;
  toHost: string;
  toHostPriority: number;
  timestamp: string;
  event: "failover_detected";
}

export interface RecoveryEvent {
  hostId: string;
  hostPriority: number;
  timestamp: string;
  event: "recovery_detected";
}

export enum NotificationType {
  INSTANCE_DOWN = "instance_down",
  INSTANCE_RECOVERED = "instance_recovered",
  FAILOVER_OCCURRED = "failover_occurred",
  ALL_DOWN_CRITICAL = "all_down_critical",
  DEGRADED_SERVICE = "degraded_service"
}

export interface InstanceNotification {
  type: NotificationType;
  hostId: string;
  hostPriority: number;
  timestamp: string;
  downtime?: number;
  message: string;
}

export interface FailoverNotification {
  type: NotificationType.FAILOVER_OCCURRED;
  fromHost: string;
  toHost: string;
  fromPriority: number;
  toPriority: number;
  timestamp: string;
  message: string;
}

export interface CriticalNotification {
  type: NotificationType.ALL_DOWN_CRITICAL;
  totalHosts: number;
  timestamp: string;
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

  private lastFailoverTime: Date | null = null;
  private failoverCount = 0;
  private lastRecoveryTime: Date | null = null;
  private recoveryCount = 0;
  private lastInstanceDownTime: Date | null = null;
  private lastCriticalTime: Date | null = null;
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



  async sendRecoveryAlert(event: RecoveryEvent): Promise<void> {
    const now = new Date();

    if (
      this.lastRecoveryTime &&
      now.getTime() - this.lastRecoveryTime.getTime() < this.cooldownPeriod
    ) {
      failoverLogger.debug("Recovery alert suppressed due to cooldown period");
      return;
    }

    this.recoveryCount++;
    this.lastRecoveryTime = now;

    const message = this.formatRecoveryMessage(event);

    failoverLogger.info(
      {
        ...event,
        recoveryCount: this.recoveryCount,
        alertsSent: this.alertChannels.filter((c) => c.enabled).length,
      },
      "Recovery detected - sending alerts"
    );

    // Send to all enabled channels
    const alertPromises = this.alertChannels
      .filter((channel) => channel.enabled)
      .map((channel) => this.sendRecoveryToChannel(channel, message));

    try {
      await Promise.allSettled(alertPromises);
      metricsLogger.info(
        {
          channelsSent: alertPromises.length,
          event: "recovery_alerts_sent",
        },
        "Recovery alerts sent"
      );
    } catch (error) {
      failoverLogger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to send recovery alerts"
      );
    }
  }

  private formatRecoveryMessage(event: RecoveryEvent): string {
    return `**PgBouncer Instance Recovered**

**Host:** ${event.hostId} (Priority: ${event.hostPriority})
**Time:** ${event.timestamp}
**Total Recoveries:** ${this.recoveryCount}

The PgBouncer instance has successfully recovered and is now accepting connections again.`;
  }

  private async sendRecoveryToChannel(
    channel: AlertChannel,
    message: string
  ): Promise<void> {
    switch (channel.name) {
      case "slack":
        if (!channel.webhook) {
          failoverLogger.error({ channelName: channel.name }, "Slack webhook URL not configured");
          return;
        }
        await this.sendRecoveryToSlack(channel.webhook, message);
        break;
      default:
        failoverLogger.warn(
          { channelName: channel.name },
          "Unknown alert channel"
        );
    }
  }

  private async sendRecoveryToSlack(webhook: string, message: string): Promise<void> {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attachments: [
            {
              color: "good",
              text: message,
              username: "PgBouncer Monitor",
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Slack API error: ${response.status} ${response.statusText}`
        );
      }

      failoverLogger.info("Slack recovery alert sent successfully");
    } catch (error) {
      failoverLogger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          webhook: webhook.substring(0, 50) + "...", // Only log part of webhook for security
        },
        "Failed to send Slack recovery alert"
      );
      throw error;
    }
  }

  async sendInstanceNotification(notification: InstanceNotification): Promise<void> {
    const now = new Date();

    // Apply cooldown based on notification type
    const shouldSkip = this.shouldSkipNotification(notification.type, now);
    if (shouldSkip) {
      failoverLogger.debug(`${notification.type} alert suppressed due to cooldown period`);
      return;
    }

    this.updateLastNotificationTime(notification.type, now);

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

  async sendFailoverNotification(notification: FailoverNotification): Promise<void> {
    const now = new Date();

    if (
      this.lastFailoverTime &&
      now.getTime() - this.lastFailoverTime.getTime() < this.cooldownPeriod
    ) {
      failoverLogger.debug("Failover alert suppressed due to cooldown period");
      return;
    }

    this.failoverCount++;
    this.lastFailoverTime = now;

    const message = this.formatFailoverMessage(notification);

    failoverLogger.warn(
      {
        ...notification,
        failoverCount: this.failoverCount,
        alertsSent: this.alertChannels.filter((c) => c.enabled).length,
      },
      "Failover detected - sending alerts"
    );

    await this.sendNotificationToChannels(message, NotificationType.FAILOVER_OCCURRED);
  }

  async sendCriticalNotification(notification: CriticalNotification): Promise<void> {
    const now = new Date();

    if (
      this.lastCriticalTime &&
      now.getTime() - this.lastCriticalTime.getTime() < this.cooldownPeriod
    ) {
      failoverLogger.debug("Critical alert suppressed due to cooldown period");
      return;
    }

    this.lastCriticalTime = now;

    const message = this.formatCriticalMessage(notification);

    failoverLogger.error(
      {
        ...notification,
        alertsSent: this.alertChannels.filter((c) => c.enabled).length,
      },
      "Critical alert - all instances down"
    );

    await this.sendNotificationToChannels(message, NotificationType.ALL_DOWN_CRITICAL);
  }

  private shouldSkipNotification(type: NotificationType, now: Date): boolean {
    switch (type) {
      case NotificationType.INSTANCE_RECOVERED:
        return this.lastRecoveryTime && 
               now.getTime() - this.lastRecoveryTime.getTime() < this.cooldownPeriod;
      case NotificationType.INSTANCE_DOWN:
      case NotificationType.DEGRADED_SERVICE:
        return this.lastInstanceDownTime && 
               now.getTime() - this.lastInstanceDownTime.getTime() < this.cooldownPeriod;
      default:
        return false;
    }
  }

  private updateLastNotificationTime(type: NotificationType, now: Date): void {
    switch (type) {
      case NotificationType.INSTANCE_RECOVERED:
        this.recoveryCount++;
        this.lastRecoveryTime = now;
        break;
      case NotificationType.INSTANCE_DOWN:
      case NotificationType.DEGRADED_SERVICE:
        this.lastInstanceDownTime = now;
        break;
    }
  }

  private formatInstanceMessage(notification: InstanceNotification): string {
    const priorityName = this.getPriorityName(notification.hostPriority);
    
    switch (notification.type) {
      case NotificationType.INSTANCE_RECOVERED:
        return `**PgBouncer Instance Recovered**

**Host:** ${notification.hostId} (${priorityName})
**Time:** ${notification.timestamp}
${notification.downtime ? `**Downtime:** ${this.formatDuration(notification.downtime)}` : ''}
**Total Recoveries:** ${this.recoveryCount}

The PgBouncer instance has successfully recovered and is now accepting connections again.`;

      case NotificationType.INSTANCE_DOWN:
        return `**PgBouncer Instance Down**

**Host:** ${notification.hostId} (${priorityName})
**Time:** ${notification.timestamp}

The PgBouncer instance is no longer responding to health checks. This may trigger automatic failover to backup instances.`;

      case NotificationType.DEGRADED_SERVICE:
        return `**PgBouncer Service Degraded**

**Host:** ${notification.hostId} (${priorityName})
**Time:** ${notification.timestamp}

Some PgBouncer instances are unavailable. Service is operating in degraded mode with reduced capacity.`;

      default:
        return notification.message;
    }
  }

  private formatFailoverMessage(notification: FailoverNotification): string {
    const fromPriorityName = this.getPriorityName(notification.fromPriority);
    const toPriorityName = this.getPriorityName(notification.toPriority);

    return `**PgBouncer Failover Occurred**

**From:** ${notification.fromHost} (${fromPriorityName})
**To:** ${notification.toHost} (${toPriorityName})
**Time:** ${notification.timestamp}
**Total Failovers:** ${this.failoverCount}

The system has automatically switched to a backup PgBouncer instance due to connection failures.`;
  }

  private formatCriticalMessage(notification: CriticalNotification): string {
    return `**CRITICAL: All PgBouncer Instances Down**

**Total Hosts:** ${notification.totalHosts}
**Time:** ${notification.timestamp}

All PgBouncer instances are unavailable. Database connectivity is completely lost. Immediate intervention required.`;
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
      case NotificationType.ALL_DOWN_CRITICAL:
        return "danger"; // Red
      case NotificationType.FAILOVER_OCCURRED:
      case NotificationType.DEGRADED_SERVICE:
        return "warning"; // Yellow
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
      case NotificationType.ALL_DOWN_CRITICAL:
        return ":rotating_light:";
      case NotificationType.FAILOVER_OCCURRED:
        return ":arrows_counterclockwise:";
      case NotificationType.DEGRADED_SERVICE:
        return ":warning:";
      default:
        return ":information_source:";
    }
  }

  getMetrics() {
    return {
      failoverCount: this.failoverCount,
      lastFailoverTime: this.lastFailoverTime?.toISOString() || null,
      recoveryCount: this.recoveryCount,
      lastRecoveryTime: this.lastRecoveryTime?.toISOString() || null,
      lastInstanceDownTime: this.lastInstanceDownTime?.toISOString() || null,
      lastCriticalTime: this.lastCriticalTime?.toISOString() || null,
      alertChannels: this.alertChannels.map((c) => ({
        name: c.name,
        enabled: c.enabled,
      })),
    };
  }
}
