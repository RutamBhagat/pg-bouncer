import "dotenv/config";

import { createLogger, logger } from "@/logger.js";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { databaseConfig } from "@/db/config/database.config.js";
import { monitoring } from "@/routers/monitoring.js";
import { test } from "@/routers/test.js";
import { serve } from "@hono/node-server";
import { warmupConnections } from "@/db/health/HealthChecker.js";

const appLogger = createLogger("app");

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: process.env.CORS_ORIGIN || "",
    allowMethods: ["GET", "POST", "OPTIONS"],
  })
);

app.get("/", (c) => {
  return c.text("OK");
});

app.route("/monitoring", monitoring);

appLogger.info("Starting PgBouncer failover application");
await warmupConnections(databaseConfig.hosts);

const port = 3000;
serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    appLogger.info(
      {
        port: info.port,
        environment: process.env.NODE_ENV || "development",
        cors_origin: process.env.CORS_ORIGIN || "not_set",
      },
      "Server started successfully"
    );
  }
);
