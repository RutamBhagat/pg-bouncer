import type { DB } from "@/db/types.js";
import { FailoverPostgresDialect } from "@/db/dialect/FailoverPostgresDialect.js";
import { Kysely } from "kysely";
import { databaseConfig } from "@/db/config/database.config.js";

class DatabaseClient {
  private static instance: Kysely<DB> | null = null;
  private static dialect: FailoverPostgresDialect | null = null;

  static getInstance(): Kysely<DB> {
    if (!DatabaseClient.instance) {
      console.log("Initializing database client with failover support...");

      DatabaseClient.dialect = new FailoverPostgresDialect(databaseConfig);
      DatabaseClient.instance = new Kysely<DB>({
        dialect: DatabaseClient.dialect,
      });

      console.log(
        `Database client initialized with hosts: ${databaseConfig.hosts
          .map((h) => `${h.id}:${h.port}`)
          .join(", ")}`
      );
    }

    return DatabaseClient.instance;
  }

  static getDialect(): FailoverPostgresDialect | null {
    return DatabaseClient.dialect;
  }

  static async destroy(): Promise<void> {
    if (DatabaseClient.instance) {
      await DatabaseClient.instance.destroy();
      DatabaseClient.instance = null;
      DatabaseClient.dialect = null;
      console.log("Database client destroyed");
    }
  }
}

export const db = DatabaseClient.getInstance();

export const getDbDialect = DatabaseClient.getDialect;

export const destroyDatabaseClient = DatabaseClient.destroy;
