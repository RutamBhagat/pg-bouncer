import type { PgBouncerConfig } from "@/db/config/types.js";
import { Pool } from "pg";

export async function checkDatabaseHealth(
  config: PgBouncerConfig
): Promise<boolean> {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 1,
    connectionTimeoutMillis: 3000,
  });

  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    await pool.end();
    return true;
  } catch (error) {
    await pool.end();
    return false;
  }
}

export async function warmupConnections(
  configs: readonly PgBouncerConfig[]
): Promise<void> {
  console.log("Warming up database connections...");

  const results = await Promise.all(
    configs.map(async (config) => ({
      id: config.id,
      healthy: await checkDatabaseHealth(config),
    }))
  );

  results.forEach(({ id, healthy }) => {
    console.log(
      `${healthy ? "✅" : "❌"} ${id} ${healthy ? "healthy" : "failed"}`
    );
  });

  const healthyCount = results.filter((r) => r.healthy).length;
  if (healthyCount === 0) {
    throw new Error("No healthy PgBouncer instances found during warmup");
  }

  console.log(
    `Database warmup complete: ${healthyCount}/${results.length} hosts healthy`
  );
}
