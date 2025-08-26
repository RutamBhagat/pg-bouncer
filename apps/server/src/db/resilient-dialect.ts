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

import type { PgBouncerEndpoint } from "@/db/client";
import { ResilientPostgresDriver } from "@/db/resilient-driver";

export class ResilientPostgresDialect implements Dialect {
  constructor(private endpoints: Array<PgBouncerEndpoint>) {}

  createAdapter(): DialectAdapter {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new ResilientPostgresDriver(this.endpoints);
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }
}
