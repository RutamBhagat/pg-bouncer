import { Hono } from "hono";
import { db } from "../db/client";
import { sql } from "kysely";

const health = new Hono();

health.get("/db", async (c) => {
  try {
    const startTime = Date.now();

    const result = await db
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
    console.error("Database health check failed:", error);

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

export { health };
