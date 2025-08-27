import type { DatabaseEndpoint } from "@/db/client";
import { Pool } from "pg";
import { logDbError } from "@/db/error-handler";
import {
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from "cockatiel";
import type { IPolicy } from "cockatiel";

const FAILOVER_POOL_CONFIG = {
  pool: {
    max: 10,
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

export class FailoverPoolManager {
  private pools: Map<string, Pool> = new Map();
  private circuitBreakers: Map<string, IPolicy> = new Map();
  private currentIndex = 0;
  private healthStatus: Map<string, boolean> = new Map();
  private lastHealthCheck: Map<string, number> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(private endpoints: Array<DatabaseEndpoint>) {
    endpoints.forEach((endpoint, index) => {
      const key = endpoint.connectionString;
      
      // Create circuit breaker for this endpoint
      const breaker = circuitBreaker(handleAll, {
        halfOpenAfter: FAILOVER_POOL_CONFIG.circuitBreaker.halfOpenAfter,
        breaker: new ConsecutiveBreaker(FAILOVER_POOL_CONFIG.circuitBreaker.consecutiveFailures),
      });
      this.circuitBreakers.set(key, breaker);
      
      const pool = new Pool({
        connectionString: endpoint.connectionString,
        max: FAILOVER_POOL_CONFIG.pool.max,
        connectionTimeoutMillis: FAILOVER_POOL_CONFIG.pool.connectionTimeoutMillis,
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
    for (const [key, pool] of this.pools) {
      try {
        await pool.query("SELECT 1");
        this.healthStatus.set(key, true);
      } catch (_error) {
        this.healthStatus.set(key, false);
      }
      this.lastHealthCheck.set(key, Date.now());
    }
  }

  async getConnection() {
    const attempts = this.endpoints.length;

    for (let i = 0; i < attempts; i++) {
      const endpoint = this.endpoints[this.currentIndex];
      const key = endpoint.connectionString;
      const breaker = this.circuitBreakers.get(key);

      const lastCheck = this.lastHealthCheck.get(key) || 0;
      if (!this.healthStatus.get(key) && Date.now() - lastCheck > FAILOVER_POOL_CONFIG.healthCheck.retryAfterMs) {
        this.healthStatus.set(key, true);
      }

      if (this.healthStatus.get(key) && breaker) {
        try {
          const pool = this.pools.get(key);
          if (!pool) {
            throw new Error(`Pool not found for ${key}`);
          }
          
          // Wrap the connection attempt in this endpoint's circuit breaker
          const client = await breaker.execute(async () => {
            return await pool.connect();
          });
          
          return { client, key };
        } catch (error) {
          // If circuit breaker is open, it will throw immediately
          // Otherwise, it's a real connection failure
          if (error.message?.includes("Circuit breaker is open")) {
            // Circuit breaker is open for this endpoint, try next one
            console.log(`Circuit breaker open for ${key}, trying next endpoint`);
          } else {
            this.healthStatus.set(key, false);
            console.error(`Failed to connect to ${key}:`, error);
          }
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
