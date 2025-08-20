import type { PoolConfig } from "pg";

export interface PgBouncerConfig {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly priority: number; // 1 = primary, 2 = secondary, 3 = tertiary, etc.
  readonly ssl?: boolean;
}

export interface FailoverConfig {
  readonly maxRetryAttempts: number;
  readonly connectionTimeoutMs: number;
  readonly queryTimeoutMs: number;
  readonly circuitBreakerFailureThreshold: number;
  readonly circuitBreakerRecoveryTimeoutMs: number;
  readonly healthCheckIntervalMs: number;
}

export interface DatabaseConfig {
  readonly hosts: readonly PgBouncerConfig[];
  readonly poolConfig: Omit<
    PoolConfig,
    "host" | "port" | "database" | "user" | "password"
  >;
  readonly failover: FailoverConfig;
}

export interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
  failoverCount: number;
  lastFailoverAt?: Date;
}

export enum HostStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  FAILED = "failed",
  CIRCUIT_OPEN = "circuit_open",
}

export interface HostHealth {
  readonly id: string;
  status: HostStatus;
  consecutiveFailures: number;
  lastCheckedAt: Date;
  lastSuccessAt?: Date;
  responseTimeMs?: number;
}
