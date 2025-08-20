import type { PgBouncerConfig } from "@/db/config/types.js";
import { Pool } from "pg";
import { healthLogger } from "@/logger.js";

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
    healthLogger.debug({ host: config.host, port: config.port, id: config.id }, 'Health check passed');
    return true;
  } catch (error) {
    await pool.end();
    healthLogger.warn({ 
      host: config.host, 
      port: config.port, 
      id: config.id, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 'Health check failed');
    return false;
  }
}

export async function warmupConnections(
  configs: readonly PgBouncerConfig[]
): Promise<void> {
  healthLogger.info({ hostCount: configs.length }, "Starting database connection warmup");

  const results = await Promise.all(
    configs.map(async (config) => ({
      id: config.id,
      healthy: await checkDatabaseHealth(config),
    }))
  );

  results.forEach(({ id, healthy }) => {
    healthLogger.info({ 
      instanceId: id, 
      healthy,
      status: healthy ? "healthy" : "failed"
    }, `Instance ${id} warmup ${healthy ? "succeeded" : "failed"}`);
  });

  const healthyCount = results.filter((r) => r.healthy).length;
  if (healthyCount === 0) {
    healthLogger.error({ totalHosts: results.length }, "No healthy PgBouncer instances found during warmup");
    throw new Error("No healthy PgBouncer instances found during warmup");
  }

  healthLogger.info({ 
    healthyCount, 
    totalCount: results.length,
    healthyHosts: results.filter(r => r.healthy).map(r => r.id)
  }, "Database warmup completed successfully");
}
