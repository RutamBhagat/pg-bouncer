import type { DatabaseConnection, Driver } from "kysely";

import { TimeoutConnection } from "@/db/timeout-connection";

export class TimeoutDriver implements Driver {
  constructor(private driver: Driver, private timeoutMs: number) {}

  async init(): Promise<void> {
    return this.driver.init();
  }

  async destroy(): Promise<void> {
    return this.driver.destroy();
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const conn = await this.driver.acquireConnection();
    return new TimeoutConnection(conn, this.timeoutMs);
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
