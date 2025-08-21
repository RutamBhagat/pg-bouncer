import { Hono } from "hono";
import { checkDatabaseHealth } from "@/db/health/HealthChecker.js";
import { databaseConfig } from "@/db/config/database.config.js";
import { db } from "@/db/client.js";
import { getDbDialect } from "@/db/client.js";
import { metricsLogger } from "@/logger.js";
import { sql } from "kysely";

const monitoring = new Hono();

monitoring.get("/health", (c) => {
  return c.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

monitoring.get("/health/detailed", async (c) => {
  const startTime = Date.now();

  try {
    try {
      await db.selectFrom(sql<{ test: number }>`(SELECT 1 as test)`.as("t")).select("test").execute();
    } catch (error) {
      metricsLogger.warn({ error: error instanceof Error ? error.message : "Unknown error" }, "Test query failed during health check");
    }

    const healthChecks = await Promise.allSettled(
      databaseConfig.hosts.map(async (host) => ({
        id: host.id,
        healthy: await checkDatabaseHealth(host),
        host: host.host,
        port: host.port,
        priority: host.priority,
      }))
    );

    const results = healthChecks.map((result, index) => ({
      ...databaseConfig.hosts[index],
      healthy: result.status === "fulfilled" ? result.value.healthy : false,
      error: result.status === "rejected" ? result.reason?.message : null,
    }));

    const healthyCount = results.filter((r) => r.healthy).length;
    const totalCount = results.length;
    const isHealthy = healthyCount > 0;

    const dialect = getDbDialect();
    let currentActiveHost = dialect?.getConnectionManager()?.getCurrentHost() || null;
    
    if (!currentActiveHost && healthyCount > 0) {
      const healthyHosts = results.filter(r => r.healthy).sort((a, b) => a.priority - b.priority);
      currentActiveHost = healthyHosts[0]?.id || null;
    }

    const response = {
      status: isHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      checkDurationMs: Date.now() - startTime,
      currentActiveHost,
      summary: {
        healthy: healthyCount,
        total: totalCount,
        percentage: Math.round((healthyCount / totalCount) * 100),
      },
      hosts: results,
    };

    metricsLogger.info(
      {
        healthyHosts: healthyCount,
        totalHosts: totalCount,
        checkDuration: Date.now() - startTime,
      },
      "Health check completed"
    );

    return c.json(response);
  } catch (error) {
    metricsLogger.error(
      {
        error: error instanceof Error ? error.message : "Unknown error",
        checkDuration: Date.now() - startTime,
      },
      "Health check failed"
    );

    return c.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

monitoring.get("/metrics", async (c) => {
  try {
    const healthChecks = await Promise.allSettled(
      databaseConfig.hosts.map(async (host) => ({
        id: host.id,
        healthy: (await checkDatabaseHealth(host)) ? 1 : 0,
        priority: host.priority,
      }))
    );

    let metrics = `# HELP pgbouncer_host_healthy Whether a PgBouncer host is healthy (1) or not (0)
# TYPE pgbouncer_host_healthy gauge
`;

    healthChecks.forEach((result, index) => {
      if (result.status === "fulfilled") {
        const host = databaseConfig.hosts[index];
        metrics += `pgbouncer_host_healthy{host="${host.host}",port="${host.port}",priority="${host.priority}",id="${host.id}"} ${result.value.healthy}\n`;
      }
    });

    const healthyCount = healthChecks.filter(
      (r) => r.status === "fulfilled" && r.value.healthy === 1
    ).length;

    metrics += `
# HELP pgbouncer_healthy_hosts_total Total number of healthy PgBouncer hosts
# TYPE pgbouncer_healthy_hosts_total gauge
pgbouncer_healthy_hosts_total ${healthyCount}

# HELP pgbouncer_total_hosts_total Total number of configured PgBouncer hosts  
# TYPE pgbouncer_total_hosts_total gauge
pgbouncer_total_hosts_total ${databaseConfig.hosts.length}
`;

    return c.text(metrics, 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  } catch (error) {
    metricsLogger.error(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Metrics endpoint failed"
    );

    return c.text("# Metrics unavailable\n", 500, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  }
});

export { monitoring };
