import { Hono } from "hono";
import { checkDatabaseHealth } from "@/db/health/HealthChecker.js";
import { databaseConfig } from "@/db/config/database.config.js";
import { db } from "@/db/client.js";
import { getDbDialect } from "@/db/client.js";
import { metricsLogger } from "@/logger.js";
import { randomUUID } from "crypto";
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
  const correlationId = randomUUID();

  try {
    await db.selectFrom(sql<{ test: number }>`(SELECT 1 as test)`.as("t")).select("test").execute();

    const dialect = getDbDialect();
    const connectionManager = dialect?.getConnectionManager();
    const currentActiveHost = connectionManager?.getCurrentHost() || null;
    
    const hostsHealth = connectionManager?.getAllHostsHealth() || [];
    
    const results = hostsHealth.map((health) => {
      const hostConfig = databaseConfig.hosts.find(h => h.id === health.id);
      return {
        id: health.id,
        host: hostConfig?.host || 'unknown',
        port: hostConfig?.port || 0,
        priority: hostConfig?.priority || 999,
        healthy: health.status === 'healthy' || health.status === 'degraded',
        status: health.status,
        circuitState: (health as any).circuitState || 'unknown',
        consecutiveFailures: health.consecutiveFailures,
        lastCheckedAt: health.lastCheckedAt,
        error: null,
      };
    });

    const healthyCount = results.filter((r) => r.healthy).length;
    const totalCount = results.length;
    const isHealthy = healthyCount > 0;

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
        activeHost: currentActiveHost,
        checkDuration: Date.now() - startTime,
      },
      "Health check completed"
    );

    return c.json(response);
  } catch (error) {
    const dialect = getDbDialect();
    const connectionManager = dialect?.getConnectionManager();
    const currentActiveHost = connectionManager?.getCurrentHost() || null;

    metricsLogger.error(
      {
        correlationId,
        error: error instanceof Error ? error.message : "Unknown error",
        errorStack: error instanceof Error ? error.stack : undefined,
        activeHost: currentActiveHost,
        checkDuration: Date.now() - startTime,
      },
      "Database query failed - circuit breaker may open"
    );

    return c.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        currentActiveHost,
        error: "Database connection failed",
        correlationId,
        checkDurationMs: Date.now() - startTime,
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
        metrics += `pgbouncer_host_healthy{port="${host.port}",priority="${host.priority}",id="${host.id}"} ${result.value.healthy}\n`;
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
