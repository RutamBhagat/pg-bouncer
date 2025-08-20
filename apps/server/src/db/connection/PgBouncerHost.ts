import { Pool, type PoolClient } from "pg";
import CircuitBreaker from "opossum";
import type { PgBouncerConfig, HostHealth } from "@/db/config/types.js";
import { HostStatus } from "@/db/config/types.js";

export class PgBouncerHost {
  private pool: Pool;
  private circuitBreaker: CircuitBreaker<[], PoolClient>;
  private health: HostHealth;

  constructor(private readonly config: PgBouncerConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.circuitBreaker = new CircuitBreaker(async () => this.pool.connect(), {
      timeout: 5000, // 5s timeout per connection attempt
      errorThresholdPercentage: 50, // Open circuit at 50% failure rate
      resetTimeout: 30000, // Try again after 30s
      volumeThreshold: 5, // Need at least 5 requests to calculate percentage
    });

    this.health = {
      id: config.id,
      status: HostStatus.HEALTHY,
      consecutiveFailures: 0,
      lastCheckedAt: new Date(),
    };

    this.circuitBreaker.on("open", () => {
      this.health.status = HostStatus.CIRCUIT_OPEN;
      console.error(
        `SLACK: [CIRCUIT_BREAKER_OPEN] ${config.id} circuit breaker opened`
      );
    });

    this.circuitBreaker.on("halfOpen", () => {
      this.health.status = HostStatus.DEGRADED;
    });

    this.circuitBreaker.on("close", () => {
      this.health.status = HostStatus.HEALTHY;
      this.health.consecutiveFailures = 0;
      this.health.lastSuccessAt = new Date();
    });
  }

  async getConnection(): Promise<PoolClient | null> {
    try {
      const client = await this.circuitBreaker.fire();
      this.health.lastCheckedAt = new Date();
      return client;
    } catch (error) {
      this.health.consecutiveFailures++;
      this.health.lastCheckedAt = new Date();
      return null;
    }
  }

  getHealth(): HostHealth {
    return { ...this.health };
  }

  getId(): string {
    return this.config.id;
  }

  getPriority(): number {
    return this.config.priority;
  }

  async destroy(): Promise<void> {
    await this.pool.end();
  }
}
