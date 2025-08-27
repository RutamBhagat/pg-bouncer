import type {
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
} from "kysely";
import {
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

import type { DatabaseEndpoint } from "@/db/client";
import { FailoverPostgresDriver } from "@/db/drivers/failover-driver";

export class FailoverPostgresDialect implements Dialect {
  constructor(private endpoints: Array<DatabaseEndpoint>) {}

  createAdapter(): DialectAdapter {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new FailoverPostgresDriver(this.endpoints);
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }
}
