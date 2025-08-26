import type { DatabaseConnection, CompiledQuery } from 'kysely';
import type { FailoverPoolManager } from './failover-pool';

export class ResilientConnection implements DatabaseConnection {
  constructor(
    private poolManager: FailoverPoolManager,
    private policy: any
  ) {}
  
  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<any> {
    return this.policy.execute(async () => {
      const { client, key } = await this.poolManager.getConnection();
      
      try {
        const parameters = Array.from(compiledQuery.parameters || []);
        const result = await client.query(compiledQuery.sql, parameters);
        return {
          rows: result.rows,
          numAffectedRows: result.rowCount,
        };
      } finally {
        client.release();
      }
    });
  }

  async *streamQuery<R>(compiledQuery: CompiledQuery): AsyncIterableIterator<any> {
    const { client, key } = await this.poolManager.getConnection();
    
    try {
      const parameters = Array.from(compiledQuery.parameters || []);
      const result = await client.query(compiledQuery.sql, parameters);
      for (const row of result.rows) {
        yield { ...row };
      }
    } finally {
      client.release();
    }
  }
}