import type { DatabaseConfig, HostHealth } from "@/db/config/types.js";

import { HostStatus } from "@/db/config/types.js";
import { PgBouncerHost } from "@/db/connection/PgBouncerHost";
import type { PoolClient } from "pg";
import pRetry from "p-retry";

export class ConnectionPoolManager {
  private hosts: PgBouncerHost[];

  constructor(private readonly config: DatabaseConfig) {
    this.hosts = config.hosts
      .map((hostConfig) => new PgBouncerHost(hostConfig))
      .sort((a, b) => a.getPriority() - b.getPriority());
  }

  async getConnection(): Promise<PoolClient> {
    const healthyHosts = this.getHealthyHosts();

    if (healthyHosts.length === 0) {
      throw new Error("All PgBouncer instances are unavailable");
    }

    return pRetry(
      async (attempt) => {
        const host = healthyHosts[(attempt - 1) % healthyHosts.length];
        const connection = await host.getConnection();

        if (!connection) {
          throw new Error(`Failed to connect to ${host.getId()}`);
        }

        if (host.getPriority() !== 1) {
          console.error(
            `SLACK: [FAILOVER] Using ${host.getId()} (priority ${host.getPriority()}) at ${new Date().toISOString()}`
          );
        }

        return connection;
      },
      {
        retries: this.config.failover.maxRetryAttempts,
        factor: 2, // Exponential backoff: 1s, 2s, 4s
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

  private getHealthyHosts(): PgBouncerHost[] {
    return this.hosts.filter((host) => {
      const health = host.getHealth();
      return (
        health.status === HostStatus.HEALTHY ||
        health.status === HostStatus.DEGRADED
      );
    });
  }

  getAllHostsHealth(): HostHealth[] {
    return this.hosts.map((host) => host.getHealth());
  }

  async destroy(): Promise<void> {
    await Promise.all(this.hosts.map((host) => host.destroy()));
  }
}
