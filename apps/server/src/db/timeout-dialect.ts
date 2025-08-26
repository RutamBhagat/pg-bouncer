import type {
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  QueryCompiler,
} from "kysely";

import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import { TimeoutDriver } from "@/db/timeout-driver";
import type postgres from "postgres";

export class TimeoutPostgresDialect implements Dialect {
  private baseDialect: PostgresJSDialect;

  constructor(sql: postgres.Sql<{}>, private timeoutMs: number = 5000) {
    this.baseDialect = new PostgresJSDialect({ postgres: sql });
  }

  createAdapter(): DialectAdapter {
    return this.baseDialect.createAdapter();
  }

  createDriver(): Driver {
    return new TimeoutDriver(this.baseDialect.createDriver(), this.timeoutMs);
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return this.baseDialect.createIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return this.baseDialect.createQueryCompiler();
  }
}
  