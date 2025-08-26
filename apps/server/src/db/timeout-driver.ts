import type { DatabaseConnection, Driver } from "kysely";

import { TimeoutConnection } from "@/db/timeout-connection";
import { timeout, TimeoutStrategy } from "cockatiel";

export class TimeoutDriver implements Driver {
  private acquisitionTimeout;

  constructor(private driver: Driver, private timeoutMs: number) {
    // Add timeout for connection acquisition to prevent hanging when PgBouncers are down
    this.acquisitionTimeout = timeout(timeoutMs, TimeoutStrategy.Aggressive);
  }

  async init(): Promise<void> {
    return this.driver.init();
  }

  async destroy(): Promise<void> {
    return this.driver.destroy();
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    try {
      // Wrap the connection acquisition with timeout
      const conn = await this.acquisitionTimeout.execute(() =>
        this.driver.acquireConnection()
      );
      return new TimeoutConnection(conn, this.timeoutMs);
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        throw new Error(
          `Connection acquisition timeout after ${this.timeoutMs}ms - all PgBouncers may be unavailable`
        );
      }
      throw error;
    }
  }

  async beginTransaction(
    conn: DatabaseConnection,
    settings: any
  ): Promise<void> {
    const actualConn = this.unwrapConnection(conn);
    return this.driver.beginTransaction(actualConn, settings);
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    const actualConn = this.unwrapConnection(conn);
    return this.driver.commitTransaction(actualConn);
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    const actualConn = this.unwrapConnection(conn);
    return this.driver.rollbackTransaction(actualConn);
  }

  async releaseConnection(conn: DatabaseConnection): Promise<void> {
    const actualConn = this.unwrapConnection(conn);
    return this.driver.releaseConnection(actualConn);
  }

  private unwrapConnection(conn: DatabaseConnection): DatabaseConnection {
    return conn instanceof TimeoutConnection ? (conn as any).connection : conn;
  }
}
