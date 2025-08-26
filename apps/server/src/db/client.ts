import type { DB } from "@/db/types";
import { Kysely } from "kysely";
import { TimeoutPostgresDialect } from "@/db/timeout-dialect";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: {
    undefined: null,
  },
});

const db = new Kysely<DB>({
  dialect: new TimeoutPostgresDialect(sql, 30000),
});

// Export sql instance for direct use when needed, useful for SET LOCAL statement_timeout within OLAP transactions
export { sql, db };
