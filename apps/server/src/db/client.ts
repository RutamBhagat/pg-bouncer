import type { DB } from "./types";
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

const dialect = new PostgresJSDialect({
  postgres: sql,
});

export const db = new Kysely<DB>({
  dialect,
});
