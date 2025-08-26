import type { DB } from "@/db/types";
import { Kysely } from "kysely";
import { TimeoutPostgresDialect } from "@/db/timeout-dialect";
import postgres from "postgres";

const pgSql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
  transform: {
    undefined: null,
  },
});

const oltpDb = new Kysely<DB>({
  dialect: new TimeoutPostgresDialect(pgSql, 5000),
});

const olapDb = new Kysely<DB>({
  dialect: new TimeoutPostgresDialect(pgSql, 120000),
});

// Export sql instance for direct use when needed, useful for SET LOCAL statement_timeout within OLAP transactions
export { pgSql, oltpDb, olapDb };
