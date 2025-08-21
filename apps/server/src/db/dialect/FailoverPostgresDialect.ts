import type {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
  TransactionSettings,
} from "kysely";
import {
  CompiledQuery as CompiledQueryCreator,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

import { ConnectionPoolManager } from "@/db/connection/ConnectionPoolManager.js";
import type { DatabaseConfig } from "@/db/config/types.js";
import type { PoolClient } from "pg";

export class FailoverPostgresDialect implements Dialect {
  private connectionManager: ConnectionPoolManager;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.connectionManager = new ConnectionPoolManager(config);
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new FailoverDriver(this.connectionManager);
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }

  getConnectionManager(): ConnectionPoolManager {
    return this.connectionManager;
  }

  getConnectionInfo(): { 
    currentHost: string | null; 
    allHosts: { id: string; status: string; priority: number; consecutiveFailures: number }[] 
  } {
    const currentHostId = this.connectionManager.getCurrentHost();
    const healthStatus = this.connectionManager.getAllHostsHealth();
    
    return {
      currentHost: currentHostId,
      allHosts: healthStatus.map((h) => {
        const hostConfig = this.config.hosts.find(host => host.id === h.id);
        return {
          id: h.id,
          status: h.status,
          priority: hostConfig?.priority || 999,
          consecutiveFailures: h.consecutiveFailures
        };
      })
    };
  }
}

class FailoverDriver implements Driver {
  constructor(private connectionManager: ConnectionPoolManager) {}

  async init(): Promise<void> {
    // Connection pools are initialized lazily
    console.log("FailoverDriver initialized");
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const client = await this.connectionManager.getConnection();
    return new FailoverDatabaseConnection(client);
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings
  ): Promise<void> {
    const compiledQuery = CompiledQueryCreator.raw("BEGIN");
    await connection.executeQuery(compiledQuery);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const compiledQuery = CompiledQueryCreator.raw("COMMIT");
    await connection.executeQuery(compiledQuery);
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const compiledQuery = CompiledQueryCreator.raw("ROLLBACK");
    await connection.executeQuery(compiledQuery);
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    // Release the underlying pg client back to its pool
    if (connection instanceof FailoverDatabaseConnection) {
      connection.release();
    }
  }

  async destroy(): Promise<void> {
    await this.connectionManager.destroy();
    console.log("FailoverDriver destroyed");
  }
}

class FailoverDatabaseConnection implements DatabaseConnection {
  constructor(private client: PoolClient) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    try {
      const result = await this.client.query(
        compiledQuery.sql,
        compiledQuery.parameters as any[]
      );
      return {
        rows: (result.rows || []) as R[],
        insertId: undefined,
        numAffectedRows: BigInt(result.rowCount || 0),
      };
    } catch (error) {
      console.error("Query execution failed:", error);
      throw error;
    }
  }

  async *streamQuery<R>(
    _compiledQuery: CompiledQuery,
    _chunkSize?: number
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("Streaming queries not implemented for failover dialect");
  }

  release(): void {
    this.client.release();
  }
}
