import { olapDb, oltpDb, pgSql } from "@/db/client";

import { Hono } from "hono";
import { sql } from "kysely";

const health = new Hono();

health.get("/db", async (c) => {
  try {
    const startTime = Date.now();

    const result = await oltpDb
      .selectNoFrom((_eb) => [
        sql<string>`current_database()`.as("database_name"),
        sql<string>`current_user`.as("user_name"),
        sql<string>`inet_server_addr()::text`.as("server_ip"),
        sql<number>`inet_server_port()`.as("server_port"),
        sql<string>`version()`.as("postgres_version"),
      ])
      .executeTakeFirst();

    const endTime = Date.now();
    const queryTime = endTime - startTime;

    if (!result) {
      throw new Error("No result from database query");
    }

    return c.json({
      status: "healthy",
      message: "Database connection successful through PGBouncer",
      connection: {
        database: result.database_name,
        user: result.user_name,
        server_ip: result.server_ip,
        server_port: result.server_port,
        postgres_version: result.postgres_version,
      },
      performance: {
        query_time_ms: queryTime,
        timestamp: new Date().toISOString(),
      },
      pgbouncer_info: {
        note: "Connection routed through PGBouncer connection pooler",
      },
    });
  } catch (error) {
    return c.json(
      {
        status: "unhealthy",
        message: "Database connection failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

health.get("/db-olap", async (c) => {
  try {
    const startTime = Date.now();

    // Test with a heavy analytical query using extended timeout
    const result = await olapDb.transaction().execute(async (trx) => {
      // Set 2 minute timeout for OLAP queries
      await pgSql`SET LOCAL statement_timeout = '2min'`;

      // Simulate heavy OLAP query - aggregate pg_stat_activity
      return await trx
        .selectNoFrom((eb) => [
          sql<string>`current_database()`.as("database_name"),
          sql<number>`(SELECT COUNT(*) FROM pg_stat_activity)`.as(
            "connection_count"
          ),
          sql<number>`(SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active')`.as(
            "active_connections"
          ),
          sql<number>`(SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'idle')`.as(
            "idle_connections"
          ),
          sql<string>`(SELECT json_agg(json_build_object(
            'pid', pid,
            'state', state,
            'query_start', query_start,
            'state_change', state_change,
            'wait_event_type', wait_event_type,
            'query', LEFT(query, 100)
          )) FROM pg_stat_activity WHERE state != 'idle')::text`.as(
            "active_queries"
          ),
          sql<string>`pg_database_size(current_database())::text`.as(
            "database_size_bytes"
          ),
          sql<number>`(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public')`.as(
            "table_count"
          ),
        ])
        .executeTakeFirst();
    });

    const endTime = Date.now();
    const queryTime = endTime - startTime;

    if (!result) {
      throw new Error("No result from OLAP query");
    }

    const activeQueries = result.active_queries
      ? JSON.parse(result.active_queries)
      : [];

    return c.json({
      status: "healthy",
      message: "OLAP database connection successful",
      analytics: {
        database: result.database_name,
        database_size_mb: Math.round(
          parseInt(result.database_size_bytes || "0") / 1024 / 1024
        ),
        table_count: result.table_count,
        connections: {
          total: result.connection_count,
          active: result.active_connections,
          idle: result.idle_connections,
        },
        active_queries: activeQueries,
      },
      performance: {
        query_time_ms: queryTime,
        timeout_used: "2 minutes (SET LOCAL)",
        timestamp: new Date().toISOString(),
      },
      note: "This endpoint uses extended timeout for analytical queries",
    });
  } catch (error) {
    // Check if it's a timeout error
    const isTimeout =
      error instanceof Error &&
      (error.message.includes("timeout") ||
        error.message.includes("canceling statement due to statement timeout"));

    return c.json(
      {
        status: "unhealthy",
        message: isTimeout
          ? "OLAP query timeout"
          : "OLAP database connection failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timeout_info: isTimeout ? "Query exceeded 2 minute timeout" : undefined,
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

// Test endpoint to simulate a long-running query
health.get("/db-slow", async (c) => {
  const startTime = Date.now();
  try {
    // This should timeout after 2 minutes (OLAP timeout)
    const result = await olapDb
      .selectNoFrom(() => [
        sql<number>`pg_sleep(150)`.as("sleep_result"), // Sleep for 150 seconds (2.5 minutes)
      ])
      .executeTakeFirst();

    return c.json({
      status: "completed",
      message: "Slow query completed (should not happen if timeout works)",
      time_ms: Date.now() - startTime,
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error && error.message.includes("timeout");

    return c.json(
      {
        status: isTimeout ? "timeout" : "error",
        message: isTimeout ? "Query correctly timed out" : "Query failed",
        error: error instanceof Error ? error.message : "Unknown error",
        time_ms: Date.now() - startTime,
        expected: "Should timeout after 2 minutes",
      },
      isTimeout ? 200 : 500
    ); // Return 200 for expected timeout
  }
});

export { health };
