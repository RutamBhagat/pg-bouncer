import "dotenv/config";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { databaseConfig } from "@/db/config/database.config.js";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { warmupConnections } from "@/db/health/HealthChecker.js";

const app = new Hono();

app.use(logger());
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

await warmupConnections(databaseConfig.hosts);

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  }
);
