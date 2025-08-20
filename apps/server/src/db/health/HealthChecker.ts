import type { PgBouncerConfig } from "@/db/config/types.js";
import { Pool } from "pg";
import type { PoolClient } from "pg";

export interface HealthCheckResult {
  hostId: string;
  isHealthy: boolean;
  responseTimeMs?: number;
  error?: string;
  timestamp: Date;
}

export class HealthChecker {
  private pools: Map<string, Pool> = new Map();

  constructor(private readonly configs: readonly PgBouncerConfig[]) {
    // health checks
    configs.forEach((config) => {
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
        max: 1,
        idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 3000,
      });

      this.pools.set(config.id, pool);
    });
  }

  async checkHost(hostId: string): Promise<HealthCheckResult> {
    const pool = this.pools.get(hostId);
    const timestamp = new Date();

    if (!pool) {
      return {
        hostId,
        isHealthy: false,
        error: "Pool not found for host",
        timestamp,
      };
    }

    let client: PoolClient | undefined;
    const startTime = Date.now();

    try {
      client = await pool.connect();

      await client.query("SELECT 1 as health_check");

      const responseTimeMs = Date.now() - startTime;

      return {
        hostId,
        isHealthy: true,
        responseTimeMs,
        timestamp,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startTime;

      return {
        hostId,
        isHealthy: false,
        responseTimeMs,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp,
      };
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  async checkAllHosts(): Promise<HealthCheckResult[]> {
    const promises = Array.from(this.pools.keys()).map((hostId) =>
      this.checkHost(hostId)
    );

    return Promise.all(promises);
  }

  async warmupConnections(): Promise<void> {
    console.log("Warming up database connections...");

    const results = await this.checkAllHosts();

    results.forEach((result) => {
      if (result.isHealthy) {
        console.log(`✅ ${result.hostId} healthy (${result.responseTimeMs}ms)`);
      } else {
        console.error(`❌ ${result.hostId} failed: ${result.error}`);
      }
    });

    const healthyHosts = results.filter((r) => r.isHealthy);
    if (healthyHosts.length === 0) {
      throw new Error("No healthy PgBouncer instances found during warmup");
    }

    console.log(
      `Database warmup complete: ${healthyHosts.length}/${results.length} hosts healthy`
    );
  }

  async destroy(): Promise<void> {
    const promises = Array.from(this.pools.values()).map((pool) => pool.end());
    await Promise.all(promises);
    this.pools.clear();
    console.log("Health checker destroyed");
  }
}
