import { db, getDbDialect } from "@/db/client.js";

import { Hono } from "hono";
import { createLogger } from "@/logger.js";
import { sql } from "kysely";

const testLogger = createLogger("test-api");

const test = new Hono();

interface QueryResult {
  timestamp: Date;
  database: string;
}

test.get("/test-query", async (c) => {
  const startTime = Date.now();
  
  try {
    const result = await db
      .selectFrom(sql<QueryResult>`(SELECT NOW() as timestamp, current_database() as database)`.as("t"))
      .selectAll()
      .executeTakeFirst();

    const dialect = getDbDialect();
    const connectionInfo = dialect ? dialect.getConnectionInfo() : { currentHost: null, allHosts: [] };
    
    const currentHostDetails = connectionInfo.allHosts.find(h => h.id === connectionInfo.currentHost);
    
    const response = {
      status: "success",
      timestamp: new Date().toISOString(),
      query_result: result?.timestamp || null,
      database: result?.database || null,
      active_pgbouncer: connectionInfo.currentHost,
      all_pgbouncers: connectionInfo.allHosts.sort((a, b) => a.priority - b.priority),
      query_duration_ms: Date.now() - startTime,
    };

    testLogger.info(
      {
        activeHost: connectionInfo.currentHost,
        queryDuration: Date.now() - startTime,
        allHosts: connectionInfo.allHosts.map(h => `${h.id}:${h.status}`).join(", "),
      },
      "Test query executed successfully"
    );

    return c.json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    testLogger.error(
      {
        error: errorMessage,
        queryDuration: Date.now() - startTime,
      },
      "Test query failed"
    );

    return c.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        error: errorMessage,
        query_duration_ms: Date.now() - startTime,
      },
      500
    );
  }
});

export { test };