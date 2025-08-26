import {
  ConsecutiveBreaker,
  circuitBreaker,
  ExponentialBackoff,
  handleAll,
  retry,
  TimeoutStrategy,
  timeout,
  wrap,
} from "cockatiel";
import type { DatabaseConnection, Driver, TransactionSettings } from "kysely";
import { CompiledQuery } from "kysely";
import { FailoverPoolManager, type PgBouncerEndpoint } from "./failover-pool";
import { ResilientConnection } from "./resilient-connection";

export class ResilientPostgresDriver implements Driver {
  private poolManager: FailoverPoolManager;
  private policy: any;

  constructor(endpoints: Array<PgBouncerEndpoint>) {
    this.poolManager = new FailoverPoolManager(endpoints);

    const retryPolicy = retry(handleAll, {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({ initialDelay: 100, maxDelay: 5000 }),
    });

    const circuitBreakerPolicy = circuitBreaker(handleAll, {
      halfOpenAfter: 30000,
      breaker: new ConsecutiveBreaker(2),
    });

    const timeoutPolicy = timeout(30000, TimeoutStrategy.Cooperative);

    this.policy = wrap(retryPolicy, circuitBreakerPolicy, timeoutPolicy);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new ResilientConnection(this.poolManager, this.policy);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings,
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
