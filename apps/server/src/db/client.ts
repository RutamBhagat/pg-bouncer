import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

const databaseUrls = process.env.DATABASE_URL?.split(",") || [];

const configs = databaseUrls.map((url) => ({
  connectionString: url.trim(),
}));

// Track dead connections with timestamp
const deadConnections = new Map<string, number>(); // connectionString -> deadUntil timestamp
const BLACKLIST_DURATION = 30000; // 30 seconds

let currentIndex = 0;

// Create a new db instance that tries the next config
export async function getDb() {
  const now = Date.now();
  
  // Clear expired blacklists
  for (const [connectionString, deadUntil] of deadConnections) {
    if (now > deadUntil) deadConnections.delete(connectionString);
  }
  
  // Find alive connections
  const aliveConfigs = configs.filter(config => !deadConnections.has(config.connectionString));
  
  if (aliveConfigs.length === 0) {
    throw new Error('All database connections are blacklisted');
  }
  
  let lastError;

  for (const config of aliveConfigs) {

    try {
      const sql = postgres(config.connectionString, {
        max: 20,
        connect_timeout: 2, // Fail fast - 2 seconds
        idle_timeout: 20,
        max_lifetime: 60 * 30,
      });

      // Quick test to verify connection works
      await sql`SELECT 1`;

      return new Kysely({
        dialect: new PostgresJSDialect({ postgres: sql }),
      });
    } catch (err) {
      lastError = err;
      console.error(
        `Database connection failed, blacklisting:`,
        err instanceof Error ? err.message : String(err)
      );
      deadConnections.set(config.connectionString, now + BLACKLIST_DURATION);
    }
  }

  throw new Error(
    `No available database connections: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}
