import type { DatabaseConfig, HostHealth } from "@/db/config/types.js";

import { HostStatus } from "@/db/config/types.js";
import { PgBouncerHost } from "@/db/connection/PgBouncerHost.js";
import type { PoolClient } from "pg";
import { dbLogger, failoverLogger } from "@/logger.js";
import { AlertService, type FailoverEvent } from "@/monitoring/AlertService.js";

type ConnectionStrategy = "FAILOVER" | "LOAD_BALANCE";

export class ConnectionPoolManager {
  private hosts: PgBouncerHost[];
  private strategy: ConnectionStrategy = "FAILOVER";
  private lastSuccessfulHostId: string | null = null;
  private alertService: AlertService;

  constructor(private readonly config: DatabaseConfig) {
    this.hosts = config.hosts
      .map((hostConfig) => new PgBouncerHost(hostConfig))
      .sort((a, b) => a.getPriority() - b.getPriority());
    this.alertService = new AlertService();
  }

  async getConnection(): Promise<PoolClient> {
    const availableHosts = this.getAvailableHosts();

    if (availableHosts.length === 0) {
      throw new Error("All PgBouncer instances are unavailable");
    }

    const maxAttempts = this.config.failover.maxRetryAttempts;
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const host = this.strategy === "FAILOVER"
        ? this.selectHostForFailover(availableHosts, attempt)
        : this.selectHostForLoadBalance(availableHosts, attempt);

      dbLogger.debug({
        hostId: host.getId(),
        attempt,
        strategy: this.strategy,
        priority: host.getPriority()
      }, 'Attempting database connection');

      try {
        const connection = await host.getConnection();

        if (!connection) {
          throw new Error(`Failed to connect to ${host.getId()}`);
        }

        if (
          this.lastSuccessfulHostId !== null &&
          this.lastSuccessfulHostId !== host.getId()
        ) {
          const failoverEvent: FailoverEvent = {
            fromHost: this.lastSuccessfulHostId,
            toHost: host.getId(),
            toHostPriority: host.getPriority(),
            timestamp: new Date().toISOString(),
            event: 'failover_detected'
          };

          failoverLogger.warn(failoverEvent, 'FAILOVER: Database host switched - this could indicate an issue');
          
          this.alertService.sendFailoverAlert(failoverEvent).catch(error => {
            failoverLogger.error({ error: error.message }, 'Failed to send failover alert');
          });
        } else if (this.lastSuccessfulHostId === null) {
          dbLogger.info({
            hostId: host.getId(),
            priority: host.getPriority(),
            event: 'initial_connection'
          }, 'Initial database connection established');
        }

        this.lastSuccessfulHostId = host.getId();
        return connection;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        dbLogger.warn({
          hostId: host.getId(),
          attempt,
          error: lastError.message,
          attemptsLeft: maxAttempts - attempt
        }, 'Database connection attempt failed');
      }
    }

    throw new Error(`Failed to connect to any PgBouncer instance after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
  }

  // FAILOVER: (1 → 2 → 3)
  private selectHostForFailover(
    availableHosts: PgBouncerHost[],
    attempt: number
  ): PgBouncerHost {
    return availableHosts[0]; // Always try highest priority available
  }

  // LOAD_BALANCE: Cycle through hosts
  private selectHostForLoadBalance(
    availableHosts: PgBouncerHost[],
    attempt: number
  ): PgBouncerHost {
    const index = (attempt - 1) % availableHosts.length;
    return availableHosts[index];
  }

  private getAvailableHosts(): PgBouncerHost[] {
    return this.hosts.filter((host) => {
      const health = host.getHealth();
      return (
        health.status === HostStatus.HEALTHY ||
        health.status === HostStatus.DEGRADED
      );
    });
  }

  setStrategy(strategy: ConnectionStrategy): void {
    this.strategy = strategy;
    dbLogger.info({ strategy }, 'Connection strategy changed');
  }

  getAllHostsHealth(): HostHealth[] {
    return this.hosts.map((host) => host.getHealth());
  }

  resetConnectionState(): void {
    this.lastSuccessfulHostId = null;
    dbLogger.info('Connection state reset');
  }

  getCurrentHost(): string | null {
    return this.lastSuccessfulHostId;
  }

  async destroy(): Promise<void> {
    await Promise.all(this.hosts.map((host) => host.destroy()));
  }
}
