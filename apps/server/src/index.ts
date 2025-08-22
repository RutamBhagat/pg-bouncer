import "dotenv/config";

import { createLogger, logger } from "@/logger.js";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { databaseConfig } from "@/db/config/database.config.js";
import { monitoring } from "@/routers/monitoring.js";
import { test } from "@/routers/test.js";
import { serve } from "@hono/node-server";
import { warmupConnections } from "@/db/health/HealthChecker.js";
import { HealthMonitorService } from "@/monitoring/HealthMonitorService.js";
import { AlertService } from "@/monitoring/AlertService.js";

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
app.route("/api", test);

appLogger.info("Starting PgBouncer failover application");

// Initialize monitoring services
const alertService = new AlertService();
const healthMonitorService = new HealthMonitorService(
  databaseConfig.hosts,
  alertService
);

// Warm up database connections
await warmupConnections(databaseConfig.hosts);

// Start health monitoring
await healthMonitorService.start();

appLogger.info("Health monitoring started");

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

// Graceful shutdown
process.on("SIGINT", async () => {
  appLogger.info("Received SIGINT, shutting down gracefully");
  
  try {
    await healthMonitorService.stop();
    appLogger.info("Health monitoring stopped");
    process.exit(0);
  } catch (error) {
    appLogger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Error during shutdown"
    );
    process.exit(1);
  }
});

process.on("SIGTERM", async () => {
  appLogger.info("Received SIGTERM, shutting down gracefully");
  
  try {
    await healthMonitorService.stop();
    appLogger.info("Health monitoring stopped");
    process.exit(0);
  } catch (error) {
    appLogger.error(
      { error: error instanceof Error ? error.message : "Unknown error" },
      "Error during shutdown"
    );
    process.exit(1);
  }
});
