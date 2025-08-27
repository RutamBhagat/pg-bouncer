import {
  ConsecutiveBreaker,
  circuitBreaker,
  handleAll,
} from "cockatiel";
import type { DatabaseConnection, Driver, TransactionSettings } from "kysely";

import { CompiledQuery } from "kysely";
import type { DatabaseEndpoint } from "@/db/client";
import { FailoverPoolManager } from "@/db/failover-pool";
import type { IPolicy } from "cockatiel";
import { ResilientConnection } from "@/db/resilient-connection";

const RESILIENT_DRIVER_CONFIG = {
  circuitBreaker: {
    halfOpenAfter: 6000,
    consecutiveFailures: 2,
  },
};

export class ResilientPostgresDriver implements Driver {
  private poolManager: FailoverPoolManager;
  private policy: IPolicy;

  constructor(endpoints: Array<DatabaseEndpoint>) {
    this.poolManager = new FailoverPoolManager(endpoints);

    this.policy = circuitBreaker(handleAll, {
      halfOpenAfter: RESILIENT_DRIVER_CONFIG.circuitBreaker.halfOpenAfter,
      breaker: new ConsecutiveBreaker(RESILIENT_DRIVER_CONFIG.circuitBreaker.consecutiveFailures),
    });
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
