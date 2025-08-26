import type { 
  Dialect, 
  Driver, 
  QueryCompiler,
  DialectAdapter,
  DatabaseIntrospector,
  Kysely
} from 'kysely';
import {
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely';
import { ResilientPostgresDriver } from './resilient-driver';
import type { PgBouncerEndpoint } from './failover-pool';

export class ResilientPostgresDialect implements Dialect {
  constructor(private endpoints: Array<PgBouncerEndpoint>) {}

  createAdapter(): DialectAdapter {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new ResilientPostgresDriver(this.endpoints);
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }
}