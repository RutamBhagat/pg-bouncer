import type { DatabaseConnection, Driver, TransactionSettings } from "kysely";

import { CompiledQuery } from "kysely";
import type { DatabaseEndpoint } from "@/db/client";
import { FailoverConnectionManager } from "@/db/drivers/failover-connection-manager";
import { ManagedConnection } from "@/db/drivers/managed-connection";

export class FailoverPostgresDriver implements Driver {
  private poolManager: FailoverConnectionManager;

  constructor(endpoints: Array<DatabaseEndpoint>) {
    this.poolManager = new FailoverConnectionManager(endpoints);
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new ManagedConnection(this.poolManager);
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
