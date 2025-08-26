import type { DatabaseConnection, Driver } from "kysely";
import { TimeoutStrategy, timeout } from "cockatiel";

export class TimeoutDriver implements Driver {
  private timeoutPolicy;

  constructor(private driver: Driver, private timeoutMs: number) {
    this.timeoutPolicy = timeout(this.timeoutMs, TimeoutStrategy.Aggressive);
  }

  async init(): Promise<void> {
    return this.driver.init();
  }

  async destroy(): Promise<void> {
    return this.driver.destroy();
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    try {
      return await this.timeoutPolicy.execute(() =>
        this.driver.acquireConnection()
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        throw new Error(
          "Connection acquisition timeout - all PgBouncers may be unavailable"
        );
      }
      throw error;
    }
  }

  async beginTransaction(
    conn: DatabaseConnection,
    settings: any
  ): Promise<void> {
    return this.driver.beginTransaction(conn, settings);
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    return this.driver.commitTransaction(conn);
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    return this.driver.rollbackTransaction(conn);
  }

  async releaseConnection(conn: DatabaseConnection): Promise<void> {
    return this.driver.releaseConnection(conn);
  }
}
