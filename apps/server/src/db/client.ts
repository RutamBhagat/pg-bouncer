import { Kysely, PostgresDialect } from "kysely";

import { Pool } from "pg";

const databaseUrls = process.env.DATABASE_URL?.split(",") || [];

const configs = databaseUrls.map((url) => ({
  connectionString: url.trim(),
}));

let currentIndex = 0;
let pool = new Pool({ ...configs[currentIndex], max: 20 });

export let db = new Kysely({
  dialect: new PostgresDialect({ pool }),
});

// Recreate connection on failure
pool.on("error", (err) => {
  console.error("Pool error, switching to next PgBouncer:", err);
  currentIndex = (currentIndex + 1) % configs.length;
  pool = new Pool({ ...configs[currentIndex], max: 20 });
  db = new Kysely({ dialect: new PostgresDialect({ pool }) });
});
