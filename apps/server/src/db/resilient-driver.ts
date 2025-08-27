import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  TimeoutStrategy,
  circuitBreaker,
  handleAll,
  retry,
  timeout,
  wrap,
} from "cockatiel";
import type { DatabaseConnection, Driver, TransactionSettings } from "kysely";

import { CompiledQuery } from "kysely";
import type { DatabaseEndpoint } from "@/db/client";
import { FailoverPoolManager } from "@/db/failover-pool";
import type { IPolicy } from "cockatiel";
import { ResilientConnection } from "@/db/resilient-connection";

const RESILIENT_DRIVER_CONFIG = {
  retry: {
    maxAttempts: 3,
    initialDelay: 100,
    maxDelay: 5000,
  },
  circuitBreaker: {
    halfOpenAfter: 6000,
    consecutiveFailures: 2,
  },
  timeout: {
    duration: 30000,
    strategy: TimeoutStrategy.Cooperative,
  },
};

export class ResilientPostgresDriver implements Driver {
  private poolManager: FailoverPoolManager;
  private policy: IPolicy;

  constructor(endpoints: Array<DatabaseEndpoint>) {
    this.poolManager = new FailoverPoolManager(endpoints);

    const retryPolicy = retry(handleAll, {
      maxAttempts: RESILIENT_DRIVER_CONFIG.retry.maxAttempts,
      backoff: new ExponentialBackoff({ 
        initialDelay: RESILIENT_DRIVER_CONFIG.retry.initialDelay, 
        maxDelay: RESILIENT_DRIVER_CONFIG.retry.maxDelay 
      }),
    });

    const circuitBreakerPolicy = circuitBreaker(handleAll, {
      halfOpenAfter: RESILIENT_DRIVER_CONFIG.circuitBreaker.halfOpenAfter,
      breaker: new ConsecutiveBreaker(RESILIENT_DRIVER_CONFIG.circuitBreaker.consecutiveFailures),
    });

    const timeoutPolicy = timeout(RESILIENT_DRIVER_CONFIG.timeout.duration, RESILIENT_DRIVER_CONFIG.timeout.strategy);

    this.policy = wrap(retryPolicy, circuitBreakerPolicy, timeoutPolicy);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new ResilientConnection(this.poolManager, this.policy);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings
  ): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("BEGIN"));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("COMMIT"));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw("ROLLBACK"));
  }

  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}

  async destroy(): Promise<void> {
    await this.poolManager.destroy();
  }
}
