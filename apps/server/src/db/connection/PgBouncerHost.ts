import { Pool, type PoolClient } from "pg";
import pRetry from "p-retry";
import type {
  PgBouncerConfig,
  HostHealth,
  ConnectionMetrics,
} from "../config/types.js";
import { HostStatus } from "../config/types.js";

export class PgBouncerHost {
  private pool: Pool;
  private health: HostHealth;
  private metrics: ConnectionMetrics;
  private circuitBreakerOpenUntil?: Date;

  constructor(
    private readonly config: PgBouncerConfig,
    private readonly failoverConfig: {
      circuitBreakerFailureThreshold: number;
      circuitBreakerRecoveryTimeoutMs: number;
      connectionTimeoutMs: number;
    }
  ) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: failoverConfig.connectionTimeoutMs,
    });

    this.health = {
      id: config.id,
      status: HostStatus.HEALTHY,
      consecutiveFailures: 0,
      lastCheckedAt: new Date(),
    };

    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingClients: 0,
      failoverCount: 0,
    };
  }

  async getConnection(): Promise<PoolClient | null> {
    if (this.isCircuitOpen()) {
      return null;
    }

    try {
      const startTime = Date.now();
      const client = await this.pool.connect();

      this.recordSuccess(Date.now() - startTime);
      return client;
    } catch (error) {
      this.recordFailure(error as Error);
      return null;
    }
  }

  private isCircuitOpen(): boolean {
    if (!this.circuitBreakerOpenUntil) return false;

    if (Date.now() < this.circuitBreakerOpenUntil.getTime()) {
      return true;
    }

    this.health.status = HostStatus.DEGRADED;
    this.circuitBreakerOpenUntil = undefined;
    return false;
  }

  private recordSuccess(responseTimeMs: number): void {
    this.health.consecutiveFailures = 0;
    this.health.status = HostStatus.HEALTHY;
    this.health.lastSuccessAt = new Date();
    this.health.responseTimeMs = responseTimeMs;
    this.health.lastCheckedAt = new Date();
  }

  private recordFailure(error: Error): void {
    this.health.consecutiveFailures++;
    this.health.lastCheckedAt = new Date();

    if (
      this.health.consecutiveFailures >=
      this.failoverConfig.circuitBreakerFailureThreshold
    ) {
      this.health.status = HostStatus.CIRCUIT_OPEN;
      this.circuitBreakerOpenUntil = new Date(
        Date.now() + this.failoverConfig.circuitBreakerRecoveryTimeoutMs
      );

      console.error(
        `SLACK: [CIRCUIT_BREAKER_OPEN] ${this.config.id} opened circuit breaker after ${this.health.consecutiveFailures} failures`
      );
    } else {
      this.health.status = HostStatus.FAILED;
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
