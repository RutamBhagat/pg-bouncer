import { FailoverPostgresDialect } from "@/db/dialect/FailoverPostgresDialect.js";
import { Kysely } from "kysely";
import { databaseConfig } from "@/db/config/database.config.js";

// Your database schema types would go here
interface Database {
  // Add your table types here as you create them
  // Example:
  // users: UsersTable;
  // posts: PostsTable;
}

class DatabaseClient {
  private static instance: Kysely<Database> | null = null;

  static getInstance(): Kysely<Database> {
    if (!DatabaseClient.instance) {
      console.log("Initializing database client with failover support...");

      DatabaseClient.instance = new Kysely<Database>({
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
