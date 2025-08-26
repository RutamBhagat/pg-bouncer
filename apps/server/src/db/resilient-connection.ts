import type { CompiledQuery, DatabaseConnection, QueryResult } from "kysely";

import type { FailoverPoolManager } from "@/db/failover-pool";
import type { IPolicy } from "cockatiel";

export class ResilientConnection implements DatabaseConnection {
  constructor(
    private poolManager: FailoverPoolManager,
    private policy: IPolicy,
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    return this.policy.execute(async () => {
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
    });
  }

  async *streamQuery<R>(
    compiledQuery: CompiledQuery,
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
