import { Kysely, PostgresDialect } from "kysely";
import pRetry, { AbortError } from "p-retry";

import CircuitBreaker from "opossum";
import type { DB } from "./types";
import { Pool } from "pg";

interface PgBouncerEndpoint {
  host: string;
  port: number;
  priority: number;
}

class ResilientDatabaseClient {
  private pools: Map<string, Pool> = new Map();
  private currentEndpointIndex: number = 0;
  private readonly endpoints: PgBouncerEndpoint[];
  private readonly circuitBreaker: CircuitBreaker;
  private db: Kysely<DB> | null = null;
  private activePoolKey: string | null = null;

  constructor() {
    // Define your PgBouncer endpoints
    this.endpoints = [
      { host: "localhost", port: 6432, priority: 1 },
      { host: "localhost", port: 6433, priority: 2 },
      { host: "localhost", port: 6434, priority: 3 },
    ];

    // Sort by priority
    this.endpoints.sort((a, b) => a.priority - b.priority);

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      async (operation: () => Promise<any>) => {
        return await operation();
      },
      {
        timeout: 8000, // 8 second timeout per your requirement
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10,
        name: "db-circuit-breaker",
        volumeThreshold: 10,
        allowWarmUp: true,
      }
    );

    // Set up circuit breaker event handlers
    this.setupCircuitBreakerEvents();

    // Initialize the primary connection
    this.initializePrimaryConnection();
  }

  private setupCircuitBreakerEvents(): void {
    this.circuitBreaker.on("open", () => {
      console.error("[Circuit Breaker] Circuit opened - too many failures");
      this.attemptFailover();
    });

    this.circuitBreaker.on("halfOpen", () => {
      console.log("[Circuit Breaker] Circuit half-open - testing recovery");
    });

    this.circuitBreaker.fallback(() => {
      console.log(
        "[Circuit Breaker] Fallback triggered - attempting alternate endpoint"
      );
      return this.attemptFailover();
    });
  }

  private createPool(endpoint: PgBouncerEndpoint): Pool {
    const poolKey = `${endpoint.host}:${endpoint.port}`;

    if (this.pools.has(poolKey)) {
      return this.pools.get(poolKey)!;
    }

    const pool = new Pool({
      host: endpoint.host,
      port: endpoint.port,
      database: "postgres",
      user: "postgres",
      password: "password",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      statement_timeout: 5000,
      allowExitOnIdle: false,
    });

    // Pool-level error handling
    pool.on("error", (err) => {
      console.error(`[Pool ${poolKey}] Idle client error:`, err.message);
      // Mark this endpoint as unhealthy
      if (this.activePoolKey === poolKey) {
        this.attemptFailover();
      }
    });

    pool.on("connect", (client) => {
      console.log(`[Pool ${poolKey}] New client connected`);
    });

    pool.on("remove", () => {
      console.log(`[Pool ${poolKey}] Client removed from pool`);
    });

    this.pools.set(poolKey, pool);
    return pool;
  }

  private async testConnection(pool: Pool): Promise<boolean> {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query("SELECT 1");
        return result.rows.length === 1;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Connection test failed:", error);
      return false;
    }
  }

  private async initializePrimaryConnection(): Promise<void> {
    for (let i = 0; i < this.endpoints.length; i++) {
      const endpoint = this.endpoints[i];
      const pool = this.createPool(endpoint);

      if (await this.testConnection(pool)) {
        this.currentEndpointIndex = i;
        this.activePoolKey = `${endpoint.host}:${endpoint.port}`;
        this.db = new Kysely<DB>({
          dialect: new PostgresDialect({ pool }),
        });
        console.log(
          `[Database] Connected to primary endpoint: ${this.activePoolKey}`
        );
        return;
      }
    }

    throw new Error("Failed to connect to any database endpoint");
  }

  private async attemptFailover(): Promise<void> {
    console.log("[Failover] Starting failover process...");

    const startIndex = this.currentEndpointIndex;
    let attempts = 0;

    while (attempts < this.endpoints.length) {
      this.currentEndpointIndex =
        (this.currentEndpointIndex + 1) % this.endpoints.length;

      if (this.currentEndpointIndex === startIndex && attempts > 0) {
        // We've cycled through all endpoints
        break;
      }

      const endpoint = this.endpoints[this.currentEndpointIndex];
      const pool = this.createPool(endpoint);

      if (await this.testConnection(pool)) {
        const oldPoolKey = this.activePoolKey;
        this.activePoolKey = `${endpoint.host}:${endpoint.port}`;
        this.db = new Kysely<DB>({
          dialect: new PostgresDialect({ pool }),
        });

        console.log(
          `[Failover] Successfully failed over from ${oldPoolKey} to ${this.activePoolKey}`
        );

        // Clean up old pool after successful failover
        if (oldPoolKey && this.pools.has(oldPoolKey)) {
          const oldPool = this.pools.get(oldPoolKey)!;
          await oldPool.end();
          this.pools.delete(oldPoolKey);
        }

        return;
      }

      attempts++;
    }

    throw new Error("Failed to failover to any available endpoint");
  }

  public async query<T>(queryFn: (db: Kysely<DB>) => Promise<T>): Promise<T> {
    if (!this.db) {
      await this.initializePrimaryConnection();
    }

    return this.circuitBreaker.fire(async () => {
      return pRetry(
        async () => {
          if (!this.db) {
            throw new Error("Database connection not initialized");
          }

          try {
            // Execute the actual query
            return await queryFn(this.db);
          } catch (error: any) {
            // Check if this is a connection error that should trigger failover
            const isConnectionError =
              error.code === "ECONNREFUSED" ||
              error.code === "ECONNRESET" ||
              error.code === "ETIMEDOUT" ||
              error.code === "57P01" || // admin_shutdown
              error.code === "57P02" || // crash_shutdown
              error.code === "57P03" || // cannot_connect_now
              error.code === "08000" || // connection_exception
              error.code === "08003" || // connection_does_not_exist
              error.code === "08006"; // connection_failure

            if (isConnectionError) {
              console.error(
                `[Database] Connection error detected: ${error.code} - ${error.message}`
              );
              await this.attemptFailover();

              // Retry with the new connection
              if (!this.db) {
                throw new AbortError(
                  "Unable to establish database connection after failover"
                );
              }

              return await queryFn(this.db);
            }

            // For non-connection errors, just throw
            throw error;
          }
        },
        {
          retries: 3,
          factor: 2,
          minTimeout: 200,
          maxTimeout: 3000,
          randomize: true,
          onFailedAttempt: (error) => {
            console.log(
              `[Retry] Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
            );
          },
        }
      );
    }) as Promise<T>;
  }

  public async healthCheck(): Promise<
    { endpoint: string; healthy: boolean }[]
  > {
    const results = [];

    for (const endpoint of this.endpoints) {
      const pool = this.createPool(endpoint);
      const key = `${endpoint.host}:${endpoint.port}`;
      const healthy = await this.testConnection(pool);
      results.push({ endpoint: key, healthy });
    }

    return results;
  }

  public getActiveEndpoint(): string | null {
    return this.activePoolKey;
  }

  public getCircuitBreakerStats() {
    return this.circuitBreaker.toJSON();
  }

  public async shutdown(): Promise<void> {
    console.log("[Database] Shutting down all connections...");

    for (const [key, pool] of this.pools) {
      try {
        await pool.end();
        console.log(`[Database] Closed pool: ${key}`);
      } catch (error) {
        console.error(`[Database] Error closing pool ${key}:`, error);
      }
    }

    this.pools.clear();
    this.db = null;
    this.activePoolKey = null;
  }
}

// Create singleton instance
let dbInstance: ResilientDatabaseClient | null = null;

export function getDb(): ResilientDatabaseClient {
  if (!dbInstance) {
    dbInstance = new ResilientDatabaseClient();
  }
  return dbInstance;
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  if (dbInstance) {
    await dbInstance.shutdown();
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  if (dbInstance) {
    await dbInstance.shutdown();
  }
  process.exit(0);
});
