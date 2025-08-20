import type { DB } from "@/db/types.js";
import { FailoverPostgresDialect } from "@/db/dialect/FailoverPostgresDialect.js";
import { Kysely } from "kysely";
import { databaseConfig } from "@/db/config/database.config.js";

class DatabaseClient {
  private static instance: Kysely<DB> | null = null;

  static getInstance(): Kysely<DB> {
    if (!DatabaseClient.instance) {
      console.log("Initializing database client with failover support...");

      DatabaseClient.instance = new Kysely<DB>({
        dialect: new FailoverPostgresDialect(databaseConfig),
      });

      console.log(
        `Database client initialized with hosts: ${databaseConfig.hosts
          .map((h) => `${h.id}:${h.port}`)
          .join(", ")}`
      );
    }

    return DatabaseClient.instance;
  }

  static async destroy(): Promise<void> {
    if (DatabaseClient.instance) {
      await DatabaseClient.instance.destroy();
      DatabaseClient.instance = null;
      console.log("Database client destroyed");
    }
  }
}

export const db = DatabaseClient.getInstance();

export const destroyDatabaseClient = DatabaseClient.destroy;
