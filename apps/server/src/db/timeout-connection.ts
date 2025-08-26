import type { CompiledQuery, DatabaseConnection, QueryResult } from "kysely";
import { TimeoutStrategy, timeout } from "cockatiel";

export class TimeoutConnection implements DatabaseConnection {
  private timeoutPolicy;

  constructor(
    private connection: DatabaseConnection,
    private timeoutMs: number = 10000
  ) {
    this.timeoutPolicy = timeout(timeoutMs, TimeoutStrategy.Aggressive);
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    try {
      return await this.timeoutPolicy.execute(() =>
        this.connection.executeQuery<R>(compiledQuery)
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        throw new Error(`Query timeout after ${this.timeoutMs}ms`);
      }
      throw error;
    }
  }

  async *streamQuery<R>(compiledQuery: CompiledQuery, chunkSize?: number) {
    yield* this.connection.streamQuery<R>(compiledQuery, chunkSize);
  }
}
