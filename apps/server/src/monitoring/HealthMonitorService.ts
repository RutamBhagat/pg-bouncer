import {
  AlertService,
  NotificationType,
  type InstanceNotification,
} from "@/monitoring/AlertService.js";
import { checkDatabaseHealth } from "@/db/health/HealthChecker.js";
import type { PgBouncerConfig } from "@/db/config/types.js";
import { HostStatus } from "@/db/config/types.js";
import { healthLogger, metricsLogger } from "@/logger.js";

export interface InstanceState {
  id: string;
  priority: number;
  isHealthy: boolean;
  status: HostStatus;
  lastCheckTime: Date;
  lastStateChange?: Date;
  failedAt?: Date;
  recoveredAt?: Date;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export interface HealthSnapshot {
  timestamp: Date;
  states: Map<string, InstanceState>;
  activeHost: string | null;
  healthyCount: number;
  totalCount: number;
}

export class HealthMonitorService {
  private currentStates = new Map<string, InstanceState>();
  private previousSnapshot: HealthSnapshot | null = null;
  private alertService: AlertService;
  private isRunning = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 5000; // 5 seconds

  constructor(
    private readonly hosts: readonly PgBouncerConfig[],
    alertService?: AlertService
  ) {
    this.alertService = alertService || new AlertService();
    this.initializeStates();
  }

  private initializeStates(): void {
    for (const host of this.hosts) {
      this.currentStates.set(host.id, {
        id: host.id,
        priority: host.priority,
        isHealthy: false, // Start pessimistic
        status: HostStatus.FAILED,
        lastCheckTime: new Date(),
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      });
    }

    healthLogger.info(
      {
        hostCount: this.hosts.length,
        hosts: this.hosts.map((h) => h.id),
      },
      "HealthMonitorService initialized"
    );
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      healthLogger.warn("HealthMonitorService already running");
      return;
    }

    this.isRunning = true;
    healthLogger.info("Starting HealthMonitorService");

    // Perform initial health check
    await this.performHealthCheck();

    // Start periodic monitoring
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck().catch((error) => {
        healthLogger.error(
          { error: error instanceof Error ? error.message : "Unknown error" },
          "Health check failed"
        );
      });
    }, this.CHECK_INTERVAL);

    healthLogger.info(
      { checkInterval: this.CHECK_INTERVAL },
      "HealthMonitorService started successfully"
    );
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      healthLogger.warn("HealthMonitorService not running");
      return;
    }

    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    healthLogger.info("HealthMonitorService stopped");
  }

  private async performHealthCheck(): Promise<void> {
    const startTime = Date.now();
    const newStates = new Map<string, InstanceState>();

    // Check health of all instances
    const healthChecks = await Promise.allSettled(
      this.hosts.map(async (host) => ({
        id: host.id,
        config: host,
        healthy: await checkDatabaseHealth(host),
      }))
    );

    // Update states based on health check results
    for (let i = 0; i < healthChecks.length; i++) {
      const result = healthChecks[i];
      const host = this.hosts[i];
      const currentState = this.currentStates.get(host.id);

      if (!currentState) continue;

      const isHealthy =
        result.status === "fulfilled" ? result.value.healthy : false;
      const now = new Date();

      const newState: InstanceState = {
        ...currentState,
        isHealthy,
        status: isHealthy ? HostStatus.HEALTHY : HostStatus.FAILED,
        lastCheckTime: now,
        consecutiveFailures: isHealthy
          ? 0
          : currentState.consecutiveFailures + 1,
        consecutiveSuccesses: isHealthy
          ? currentState.consecutiveSuccesses + 1
          : 0,
      };

      if (currentState.isHealthy !== isHealthy) {
        newState.lastStateChange = now;

        if (isHealthy) {
          newState.recoveredAt = now;
          if (currentState.failedAt) {
            const downtime = now.getTime() - currentState.failedAt.getTime();
            await this.sendInstanceRecoveredNotification(host, downtime);
          } else {
            await this.sendInstanceRecoveredNotification(host);
          }
        } else {
          newState.failedAt = now;
          await this.sendInstanceDownNotification(host);
        }
      }

      newStates.set(host.id, newState);
    }

    this.currentStates = newStates;

    const currentSnapshot = this.createSnapshot();

    this.previousSnapshot = currentSnapshot;

    const checkDuration = Date.now() - startTime;
    metricsLogger.debug(
      {
        checkDuration,
        healthyCount: currentSnapshot.healthyCount,
        totalCount: currentSnapshot.totalCount,
        activeHost: currentSnapshot.activeHost,
      },
      "Health check completed"
    );
  }

  private createSnapshot(): HealthSnapshot {
    const healthyHosts = Array.from(this.currentStates.values()).filter(
      (s) => s.isHealthy
    );
    const activeHost = this.determineActiveHost(healthyHosts);

    return {
      timestamp: new Date(),
      states: new Map(this.currentStates),
      activeHost,
      healthyCount: healthyHosts.length,
      totalCount: this.currentStates.size,
    };
  }

  private determineActiveHost(healthyHosts: InstanceState[]): string | null {
    if (healthyHosts.length === 0) return null;

    return healthyHosts.sort((a, b) => a.priority - b.priority)[0].id;
  }

  private async sendInstanceDownNotification(
    host: PgBouncerConfig
  ): Promise<void> {
    const notification: InstanceNotification = {
      type: NotificationType.INSTANCE_DOWN,
      hostId: host.id,
      hostPriority: host.priority,
      timestamp: new Date().toISOString(),
      message: `PgBouncer instance ${host.id} is down`,
    };

    await this.alertService.sendInstanceNotification(notification);

    healthLogger.warn(
      {
        hostId: host.id,
        priority: host.priority,
        port: host.port,
      },
      "Instance down notification sent"
    );
  }

  private async sendInstanceRecoveredNotification(
    host: PgBouncerConfig,
    downtime?: number
  ): Promise<void> {
    const notification: InstanceNotification = {
      type: NotificationType.INSTANCE_RECOVERED,
      hostId: host.id,
      hostPriority: host.priority,
      timestamp: new Date().toISOString(),
      downtime,
      message: `PgBouncer instance ${host.id} has recovered`,
    };

    await this.alertService.sendInstanceNotification(notification);

    healthLogger.info(
      {
        hostId: host.id,
        priority: host.priority,
        port: host.port,
        downtime,
      },
      "Instance recovery notification sent"
    );
  }

  // Public API methods
  getCurrentStates(): Map<string, InstanceState> {
    return new Map(this.currentStates);
  }

  getCurrentSnapshot(): HealthSnapshot | null {
    if (this.currentStates.size === 0) return null;
    return this.createSnapshot();
  }

  getMetrics(): {
    isRunning: boolean;
    totalHosts: number;
    healthyHosts: number;
    checkInterval: number;
    lastCheckTime: string | null;
  } {
    const lastCheckTime = Math.max(
      ...Array.from(this.currentStates.values()).map((s) =>
        s.lastCheckTime.getTime()
      )
    );

    return {
      isRunning: this.isRunning,
      totalHosts: this.hosts.length,
      healthyHosts: Array.from(this.currentStates.values()).filter(
        (s) => s.isHealthy
      ).length,
      checkInterval: this.CHECK_INTERVAL,
      lastCheckTime: lastCheckTime
        ? new Date(lastCheckTime).toISOString()
        : null,
    };
  }
}