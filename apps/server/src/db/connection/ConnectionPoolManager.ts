import type { DatabaseConfig, HostHealth } from "@/db/config/types.js";

import { HostStatus } from "@/db/config/types.js";
import { PgBouncerHost } from "@/db/connection/PgBouncerHost.js";
import type { PoolClient } from "pg";
import pRetry from "p-retry";

type ConnectionStrategy = "FAILOVER" | "LOAD_BALANCE";

export class ConnectionPoolManager {
  private hosts: PgBouncerHost[];
  private strategy: ConnectionStrategy = "FAILOVER";
  private lastSuccessfulHostId: string | null = null;

  constructor(private readonly config: DatabaseConfig) {
    this.hosts = config.hosts
      .map((hostConfig) => new PgBouncerHost(hostConfig))
      .sort((a, b) => a.getPriority() - b.getPriority());
  }

  async getConnection(): Promise<PoolClient> {
    const availableHosts = this.getAvailableHosts();

    if (availableHosts.length === 0) {
      throw new Error("All PgBouncer instances are unavailable");
    }

    return pRetry(
      async (attempt) => {
        const host =
          this.strategy === "FAILOVER"
            ? this.selectHostForFailover(availableHosts, attempt)
            : this.selectHostForLoadBalance(availableHosts, attempt);

        console.log(
          `Attempting connection to ${host.getId()} (attempt ${attempt}, strategy: ${
            this.strategy
          })`
        );

        const connection = await host.getConnection();

        if (!connection) {
          throw new Error(`Failed to connect to ${host.getId()}`);
        }

        if (
          this.lastSuccessfulHostId !== null &&
          this.lastSuccessfulHostId !== host.getId()
        ) {
          console.error(
            `SLACK: [FAILOVER] Switched from ${
              this.lastSuccessfulHostId
            } to ${host.getId()} (priority ${host.getPriority()}) at ${new Date().toISOString()}`
          );
        } else if (this.lastSuccessfulHostId === null) {
          console.log(`Initial connection established to ${host.getId()}`);
        }

        this.lastSuccessfulHostId = host.getId();

        return connection;
      },
      {
        retries: this.config.failover.maxRetryAttempts,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 8000,
        onFailedAttempt: (error) => {
          console.warn(
            `Connection attempt ${error.attemptNumber} failed: ${error.message}`
          );
        },
      }
    );
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
    console.log(`Connection strategy changed to: ${strategy}`);
  }

  getAllHostsHealth(): HostHealth[] {
    return this.hosts.map((host) => host.getHealth());
  }

  resetConnectionState(): void {
    this.lastSuccessfulHostId = null;
    console.log("Connection state reset");
  }

  getCurrentHost(): string | null {
    return this.lastSuccessfulHostId;
  }

  async destroy(): Promise<void> {
    await Promise.all(this.hosts.map((host) => host.destroy()));
  }
}
