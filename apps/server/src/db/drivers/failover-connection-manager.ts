import {
  BrokenCircuitError,
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from "cockatiel";

import type { DatabaseEndpoint } from "@/db/client";
import type { IPolicy } from "cockatiel";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import { logDbError } from "@/db/error-handler";

// AWS Lambda automatically sets AWS_LAMBDA_FUNCTION_NAME
const isStatelessEnvironment = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const FAILOVER_CONNECTION_CONFIG = {
  isStateless: isStatelessEnvironment,
  pool: {
    max: 33,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  },
  healthCheck: {
    enabled: !isStatelessEnvironment, // Disable health checks in Lambda
    intervalMs: 5000,
    retryAfterMs: 6000,
  },
  circuitBreaker: {
    halfOpenAfter: isStatelessEnvironment ? 2000 : 4000, // Faster recovery in Lambda
    consecutiveFailures: 3,
  },
};

export interface ConnectionResult {
  client: PoolClient;
  key: string;
}

export class FailoverConnectionManager {
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
        halfOpenAfter: FAILOVER_CONNECTION_CONFIG.circuitBreaker.halfOpenAfter,
        breaker: new ConsecutiveBreaker(
          FAILOVER_CONNECTION_CONFIG.circuitBreaker.consecutiveFailures
        ),
      });
      this.circuitBreakers.set(key, breaker);

      const pool = new Pool({
        connectionString: endpoint.connectionString,
        max: FAILOVER_CONNECTION_CONFIG.pool.max,
        connectionTimeoutMillis:
          FAILOVER_CONNECTION_CONFIG.pool.connectionTimeoutMillis,
        idleTimeoutMillis: FAILOVER_CONNECTION_CONFIG.pool.idleTimeoutMillis,
      });

      pool.on("error", (error) => {
        logDbError(error, {
          event: "db_pool_error",
          endpoint: key,
          pgbouncer_index: index,
          level: "warn",
        });
        // Only track health status in stateful environments
        if (!isStatelessEnvironment) {
          this.healthStatus.set(key, false);
        }
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

      // Only track health status in stateful environments
      if (!isStatelessEnvironment) {
        this.healthStatus.set(key, true);
        this.lastHealthCheck.set(key, Date.now());
      }
    });

    // Only start health checks in stateful environments
    if (
      FAILOVER_CONNECTION_CONFIG.healthCheck.enabled &&
      !isStatelessEnvironment
    ) {
      this.healthCheckInterval = setInterval(
        () => this.performHealthChecks(),
        FAILOVER_CONNECTION_CONFIG.healthCheck.intervalMs
      );
    }
  }

  private async performHealthChecks() {
    // Skip health checks in stateless environments
    if (isStatelessEnvironment) {
      return;
    }

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
    // In stateless environments, always retry (let circuit breaker handle failures)
    if (isStatelessEnvironment) {
      return true;
    }

    // In stateful environments, use health status tracking
    const isHealthy = this.healthStatus.get(key);
    if (isHealthy) return true;

    const lastCheck = this.lastHealthCheck.get(key) || 0;
    const timeSinceLastCheck = Date.now() - lastCheck;
    return (
      timeSinceLastCheck > FAILOVER_CONNECTION_CONFIG.healthCheck.retryAfterMs
    );
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
      // (Only in stateful environments)
      if (!isStatelessEnvironment && !this.healthStatus.get(key)) {
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
          // Only track health status in stateful environments
          if (!isStatelessEnvironment) {
            this.healthStatus.set(key, false);
          }
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
