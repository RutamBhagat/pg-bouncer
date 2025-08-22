import { AlertService, NotificationType, type InstanceNotification, type FailoverNotification, type CriticalNotification } from "@/monitoring/AlertService.js";
import { checkDatabaseHealth } from "@/db/health/HealthChecker.js";
import type { PgBouncerConfig } from "@/db/config/types.js";
import { HostStatus } from "@/db/config/types.js";
import { healthLogger, metricsLogger, failoverLogger } from "@/logger.js";
import { StateStore } from "@/monitoring/StateStore.js";

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
  private stateStore: StateStore;
  private isRunning = false;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 5000; // 5 seconds

  constructor(
    private readonly hosts: readonly PgBouncerConfig[],
    alertService?: AlertService,
    stateStore?: StateStore
  ) {
    this.alertService = alertService || new AlertService();
    this.stateStore = stateStore || new StateStore();
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
        hosts: this.hosts.map(h => h.id) 
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

    // Load persisted state
    await this.loadPersistedState();

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

  private async loadPersistedState(): Promise<void> {
    try {
      const persistedData = await this.stateStore.loadState();
      
      if (persistedData) {
        // Compare persisted state with current health check
        healthLogger.info(
          { 
            persistedStates: persistedData.states.size,
            lastActiveHost: persistedData.lastActiveHost 
          },
          "Loading persisted state"
        );

        // Check for state differences and send notifications
        await this.checkStateChangesOnStartup(persistedData.states);
        
        // Use persisted states as starting point (but will be updated by first health check)
        for (const [id, persistedState] of persistedData.states) {
          if (this.currentStates.has(id)) {
            // Merge persisted data with current state, keeping structure
            const currentState = this.currentStates.get(id)!;
            this.currentStates.set(id, {
              ...currentState,
              consecutiveFailures: persistedState.consecutiveFailures,
              consecutiveSuccesses: persistedState.consecutiveSuccesses,
              failedAt: persistedState.failedAt,
              recoveredAt: persistedState.recoveredAt,
            });
          }
        }
      }
    } catch (error) {
      healthLogger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to load persisted state, starting fresh"
      );
    }
  }

  private async checkStateChangesOnStartup(persistedStates: Map<string, InstanceState>): Promise<void> {
    // Perform quick health check to compare with persisted state
    const quickHealthChecks = await Promise.allSettled(
      this.hosts.map(async (host) => ({
        id: host.id,
        config: host,
        healthy: await checkDatabaseHealth(host),
      }))
    );

    for (let i = 0; i < quickHealthChecks.length; i++) {
      const result = quickHealthChecks[i];
      const host = this.hosts[i];
      const persistedState = persistedStates.get(host.id);

      if (result.status === "fulfilled" && persistedState) {
        const currentlyHealthy = result.value.healthy;
        const wasHealthy = persistedState.isHealthy;

        // If state changed while server was down, send notification
        if (wasHealthy && !currentlyHealthy) {
          healthLogger.warn(
            { hostId: host.id, wasHealthy, currentlyHealthy },
            "Instance went down while server was offline"
          );
          await this.sendInstanceDownNotification(host);
        } else if (!wasHealthy && currentlyHealthy) {
          healthLogger.info(
            { hostId: host.id, wasHealthy, currentlyHealthy },
            "Instance recovered while server was offline"
          );
          // Calculate approximate downtime if we have failure time
          const downtime = persistedState.failedAt 
            ? Date.now() - persistedState.failedAt.getTime() 
            : undefined;
          await this.sendInstanceRecoveredNotification(host, downtime);
        }
      }
    }
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

      const isHealthy = result.status === "fulfilled" ? result.value.healthy : false;
      const now = new Date();

      const newState: InstanceState = {
        ...currentState,
        isHealthy,
        status: isHealthy ? HostStatus.HEALTHY : HostStatus.FAILED,
        lastCheckTime: now,
        consecutiveFailures: isHealthy ? 0 : currentState.consecutiveFailures + 1,
        consecutiveSuccesses: isHealthy ? currentState.consecutiveSuccesses + 1 : 0,
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

    await this.analyzeSystemState(currentSnapshot);

    this.previousSnapshot = currentSnapshot;

    // Save current state to persistent store
    await this.saveCurrentState(currentSnapshot.activeHost);

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
    const healthyHosts = Array.from(this.currentStates.values()).filter(s => s.isHealthy);
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

    return healthyHosts
      .sort((a, b) => a.priority - b.priority)[0].id;
  }

  private async analyzeSystemState(currentSnapshot: HealthSnapshot): Promise<void> {
    if (currentSnapshot.healthyCount === 0 && currentSnapshot.totalCount > 0) {
      await this.sendCriticalNotification();
      return;
    }

    if (this.previousSnapshot && this.previousSnapshot.activeHost !== currentSnapshot.activeHost) {
      await this.sendFailoverNotification(
        this.previousSnapshot.activeHost,
        currentSnapshot.activeHost
      );
    }

    if (currentSnapshot.healthyCount > 0 && currentSnapshot.healthyCount < currentSnapshot.totalCount) {
      if (this.previousSnapshot && this.previousSnapshot.healthyCount >= this.previousSnapshot.totalCount) {
        await this.sendDegradedServiceNotification();
      }
    }
  }

  private async sendInstanceDownNotification(host: PgBouncerConfig): Promise<void> {
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

  private async sendInstanceRecoveredNotification(host: PgBouncerConfig, downtime?: number): Promise<void> {
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

  private async sendFailoverNotification(fromHost: string | null, toHost: string | null): Promise<void> {
    if (!fromHost || !toHost) return;

    const fromHostConfig = this.hosts.find(h => h.id === fromHost);
    const toHostConfig = this.hosts.find(h => h.id === toHost);

    if (!fromHostConfig || !toHostConfig) return;

    const notification: FailoverNotification = {
      type: NotificationType.FAILOVER_OCCURRED,
      fromHost,
      toHost,
      fromPriority: fromHostConfig.priority,
      toPriority: toHostConfig.priority,
      timestamp: new Date().toISOString(),
      message: `Failover from ${fromHost} to ${toHost}`,
    };

    await this.alertService.sendFailoverNotification(notification);

    failoverLogger.warn(
      {
        fromHost,
        toHost,
        fromPriority: fromHostConfig.priority,
        toPriority: toHostConfig.priority,
      },
      "Failover notification sent"
    );
  }

  private async sendDegradedServiceNotification(): Promise<void> {
    const unhealthyHosts = Array.from(this.currentStates.values())
      .filter(state => !state.isHealthy);

    const primaryUnhealthyHost = unhealthyHosts
      .sort((a, b) => a.priority - b.priority)[0];

    if (primaryUnhealthyHost) {
      const hostConfig = this.hosts.find(h => h.id === primaryUnhealthyHost.id);
      if (hostConfig) {
        const notification: InstanceNotification = {
          type: NotificationType.DEGRADED_SERVICE,
          hostId: primaryUnhealthyHost.id,
          hostPriority: primaryUnhealthyHost.priority,
          timestamp: new Date().toISOString(),
          message: `Service degraded - ${primaryUnhealthyHost.id} unavailable`,
        };

        await this.alertService.sendInstanceNotification(notification);

        healthLogger.warn(
          {
            healthyCount: this.previousSnapshot?.healthyCount,
            totalCount: this.previousSnapshot?.totalCount,
            affectedHosts: unhealthyHosts.map(h => h.id),
          },
          "Degraded service notification sent"
        );
      }
    }
  }

  private async sendCriticalNotification(): Promise<void> {
    const notification: CriticalNotification = {
      type: NotificationType.ALL_DOWN_CRITICAL,
      totalHosts: this.hosts.length,
      timestamp: new Date().toISOString(),
      message: "All PgBouncer instances are down",
    };

    await this.alertService.sendCriticalNotification(notification);

    healthLogger.error(
      { totalHosts: this.hosts.length },
      "Critical notification sent - all instances down"
    );
  }

  private async saveCurrentState(activeHost: string | null): Promise<void> {
    try {
      await this.stateStore.saveState(this.currentStates, activeHost);
    } catch (error) {
      healthLogger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to save current state"
      );
    }
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
      ...Array.from(this.currentStates.values()).map(s => s.lastCheckTime.getTime())
    );

    return {
      isRunning: this.isRunning,
      totalHosts: this.hosts.length,
      healthyHosts: Array.from(this.currentStates.values()).filter(s => s.isHealthy).length,
      checkInterval: this.CHECK_INTERVAL,
      lastCheckTime: lastCheckTime ? new Date(lastCheckTime).toISOString() : null,
    };
  }
}