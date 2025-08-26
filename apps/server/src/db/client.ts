import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import CircuitBreaker from "opossum";

const databaseUrls = process.env.DATABASE_URL?.split(",") || [];

const configs = databaseUrls.map((url) => ({
  connectionString: url.trim(),
}));

// Circuit breaker for each database connection
const breakers = configs.map(config => 
  new CircuitBreaker(async () => {
    const sql = postgres(config.connectionString, {
      max: 20,
      connect_timeout: 2, // Fail fast - 2 seconds
      idle_timeout: 20,
      max_lifetime: 60 * 30,
    });
    
    await sql`SELECT 1`;
    
    return new Kysely({
      dialect: new PostgresJSDialect({ postgres: sql }),
    });
  }, {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10
  })
);

// Get a working db connection using circuit breakers
export async function getDb() {
  for (const breaker of breakers) {
    try {
      return await breaker.fire();
    } catch (err) {
      continue; // Try next breaker
    }
  }
  throw new Error('All database connections unavailable');
}
