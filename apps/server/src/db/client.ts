import type { DB } from "./types";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

export const sql = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 5, // 5 seconds to detect failed PgBouncer quickly
  prepare: false, // Required for PgBouncer transaction mode
  connection: {
    statement_timeout: 30, // Default 30 second timeout for ALL queries (NOTE: API Gateway + Lambda: Limited to 29 seconds for REST APIs)
  },
});

const dialect = new PostgresJSDialect({
  postgres: sql,
});

export const db = new Kysely<DB>({
  dialect,
});
