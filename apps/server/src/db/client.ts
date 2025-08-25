import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolConfig, type PoolClient } from "pg";
import { logDbError } from "./error-handler.js";

class SimpleFailoverManager {
  private currentIndex: number;
  private pools: Pool[];

  constructor(endpoints: PoolConfig[]) {
    this.currentIndex = 0;
    this.pools = endpoints.map(
      (config: PoolConfig) => {
        const pool = new Pool({
          ...config,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
        
        // Add error handlers to prevent server crashes
        pool.on('error', (err) => {
          logDbError(err, {
            level: 'error',
            event: 'db_pool_error',
            endpoint: `${config.host}:${config.port}`
          });
        });
        
        return pool;
      }
    );
  }

  async getHealthyPool() {
    const startIndex = this.currentIndex;

    do {
      const pool = this.pools[this.currentIndex];
      try {
        // Quick health check
        const client = await pool.connect();
        
        // Add error handler to client to prevent crashes
        client.on('error', (err) => {
          logDbError(err, {
            level: 'error',
            event: 'db_connection_error',
            pgbouncer_index: this.currentIndex
          });
        });
        
        await client.query("SELECT 1");
        client.release();
        return pool;
      } catch (error) {
        logDbError(error as Error, {
          level: 'warn',
          event: 'db_failover',
          pgbouncer_index: this.currentIndex,
          endpoint: `localhost:${6432 + this.currentIndex}`
        });
        this.currentIndex = (this.currentIndex + 1) % this.pools.length;
      }
    } while (this.currentIndex !== startIndex);

    throw new Error("All PgBouncer endpoints are unavailable");
  }

  async createKyselyInstance() {
    // Create a dynamic pool wrapper that always gets a healthy pool
    const dynamicPool = {
      connect: async (): Promise<PoolClient> => {
        const pool = await this.getHealthyPool();
        return pool.connect();
      },
      end: async () => {
        // End all pools
        await Promise.all(this.pools.map(pool => pool.end()));
      },
      query: async (text: string, params?: any[]) => {
        const pool = await this.getHealthyPool();
        return pool.query(text, params);
      },
      on: () => {}, // No-op for event handling
      removeListener: () => {}, // No-op for event handling
    };
    
    return new Kysely({
      dialect: new PostgresDialect({ pool: dynamicPool as any }),
    });
  }
}

// Usage
const manager = new SimpleFailoverManager([
  { host: "localhost", port: 6432, database: "postgres", user: "postgres", password: "password" },
  { host: "localhost", port: 6433, database: "postgres", user: "postgres", password: "password" },
  { host: "localhost", port: 6434, database: "postgres", user: "postgres", password: "password" },
]);

export const db = await manager.createKyselyInstance();
