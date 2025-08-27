import type { CompiledQuery, DatabaseConnection, QueryResult } from "kysely";

import type { FailoverConnectionManager } from "@/db/drivers/failover-connection-manager";

export class ManagedConnection implements DatabaseConnection {
  constructor(private poolManager: FailoverConnectionManager) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const { client } = await this.poolManager.getConnection();

    try {
      const parameters = Array.from(compiledQuery.parameters || []);
      const result = await client.query(compiledQuery.sql, parameters);
      return {
        rows: result.rows,
        numAffectedRows:
          result.rowCount !== null ? BigInt(result.rowCount) : undefined,
      };
    } finally {
      client.release();
    }
  }

  async *streamQuery<R>(
    compiledQuery: CompiledQuery
  ): AsyncIterableIterator<R> {
    const { client } = await this.poolManager.getConnection();

    try {
      const parameters = Array.from(compiledQuery.parameters || []);
      const result = await client.query(compiledQuery.sql, parameters);
      for (const row of result.rows) {
        yield { ...row } as R;
      }
    } finally {
      client.release();
    }
  }
}
