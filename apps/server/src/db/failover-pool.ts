import { Pool } from "pg";
import { logDbError } from "./error-handler";

export interface PgBouncerEndpoint {
  host: string;
  port: number;
}

export class FailoverPoolManager {
  private pools: Map<string, Pool> = new Map();
  private currentIndex = 0;
  private healthStatus: Map<string, boolean> = new Map();
  private lastHealthCheck: Map<string, number> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(private endpoints: Array<PgBouncerEndpoint>) {
    endpoints.forEach((endpoint, index) => {
      const key = `${endpoint.host}:${endpoint.port}`;
      const pool = new Pool({
        host: endpoint.host,
        port: endpoint.port,
        database: process.env.DATABASE_NAME,
        user: process.env.DATABASE_USER,
        password: process.env.DATABASE_PASSWORD,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
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
      5000,
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
      const key = `${endpoint.host}:${endpoint.port}`;

      const lastCheck = this.lastHealthCheck.get(key) || 0;
      if (!this.healthStatus.get(key) && Date.now() - lastCheck > 6000) {
        this.healthStatus.set(key, true);
      }

      if (this.healthStatus.get(key)) {
        try {
          const pool = this.pools.get(key);
          if (!pool) {
            throw new Error(`Pool not found for ${key}`);
          }
          const client = await pool.connect();
          return { client, key };
        } catch (error) {
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
