import type { IPolicy } from "cockatiel";
import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from "cockatiel";
import { Pool, type PoolClient } from "pg";
import type { DatabaseEndpoint } from "@/db/client";
import { logDbError } from "@/db/error-handler";

const FAILOVER_POOL_CONFIG = {
  pool: {
    max: 33,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  },
  healthCheck: {
    intervalMs: 5000,
    retryAfterMs: 6000,
  },
  circuitBreaker: {
    halfOpenAfter: 4000,
    consecutiveFailures: 3,
  },
};

export interface ConnectionResult {
  client: PoolClient;
  key: string;
}

export class FailoverPoolManager {
  private readonly pools: Map<string, Pool> = new Map();
  private readonly circuitBreakers: Map<string, IPolicy> = new Map();
  private currentIndex = 0;
  private readonly healthStatus: Map<string, boolean> = new Map();
  private readonly lastHealthCheck: Map<string, number> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(private endpoints: Array<DatabaseEndpoint>) {
    endpoints.forEach((endpoint, index) => {
      const key = endpoint.connectionString;

      // Create circuit breaker for this endpoint
      const breaker = circuitBreaker(handleAll, {
        halfOpenAfter: FAILOVER_POOL_CONFIG.circuitBreaker.halfOpenAfter,
        breaker: new ConsecutiveBreaker(
          FAILOVER_POOL_CONFIG.circuitBreaker.consecutiveFailures,
        ),
      });
      this.circuitBreakers.set(key, breaker);

      const pool = new Pool({
        connectionString: endpoint.connectionString,
        max: FAILOVER_POOL_CONFIG.pool.max,
        connectionTimeoutMillis:
          FAILOVER_POOL_CONFIG.pool.connectionTimeoutMillis,
        idleTimeoutMillis: FAILOVER_POOL_CONFIG.pool.idleTimeoutMillis,
      });

      pool.on("error", (error) => {
        logDbError(error, {
          event: "db_pool_error",
          endpoint: key,
          pgbouncer_index: index,
          level: "warn",
        });
        this.healthStatus.set(key, false);
      });

      pool.on("connect", (client) => {
        logDbError(new Error("Connection established"), {
          event: "db_connection_success",
          endpoint: key,
          pgbouncer_index: index,
          level: "info",
        });

        client.on("error", (error) => {
          logDbError(error, {
            event: "db_connection_error",
            endpoint: key,
            pgbouncer_index: index,
            level: "warn",
          });
        });
      });

      this.pools.set(key, pool);
      this.healthStatus.set(key, true);
      this.lastHealthCheck.set(key, Date.now());
    });

    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      FAILOVER_POOL_CONFIG.healthCheck.intervalMs,
    );
  }

  private async performHealthChecks() {
    const checks = Array.from(this.pools.entries()).map(async ([key, pool]) => {
      try {
        await pool.query("SELECT 1");
        this.healthStatus.set(key, true);
      } catch (_error) {
        this.healthStatus.set(key, false);
      }
      this.lastHealthCheck.set(key, Date.now());
    });

    await Promise.allSettled(checks);
  }

  private shouldRetryEndpoint(key: string): boolean {
    const isHealthy = this.healthStatus.get(key);
    if (isHealthy) return true;

    const lastCheck = this.lastHealthCheck.get(key) || 0;
    const timeSinceLastCheck = Date.now() - lastCheck;
    return timeSinceLastCheck > FAILOVER_POOL_CONFIG.healthCheck.retryAfterMs;
  }

  async getConnection(): Promise<ConnectionResult> {
    const attempts = this.endpoints.length;

    for (let i = 0; i < attempts; i++) {
      const endpoint = this.endpoints[this.currentIndex];
      const key = endpoint.connectionString;
      const breaker = this.circuitBreakers.get(key);
      const pool = this.pools.get(key);

      if (!pool || !breaker) {
        this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
        continue;
      }

      if (!this.shouldRetryEndpoint(key)) {
        this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
        continue;
      }

      // If endpoint was marked unhealthy but enough time has passed, try it again
      if (!this.healthStatus.get(key)) {
        this.healthStatus.set(key, true);
      }

      try {
        const client = await breaker.execute(async () => {
          return await pool.connect();
        });

        return { client, key };
      } catch (error) {
        if (error instanceof BrokenCircuitError) {
          console.log(`Circuit breaker open for ${key}, trying next endpoint`);
        } else {
          this.healthStatus.set(key, false);
          console.error(`Failed to connect to ${key}:`, error);
        }
      }

      this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    }

    throw new Error("All PgBouncer instances are unavailable");
  }

  async destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    for (const [, pool] of this.pools) {
      await pool.end();
    }
  }
}
