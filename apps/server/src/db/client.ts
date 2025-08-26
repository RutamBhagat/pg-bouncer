import { Kysely } from "kysely";
import { ResilientPostgresDialect } from "./resilient-dialect";
import type { DB, PgBouncerEndpoint } from "./types";

const pgBouncerEndpoints: Array<PgBouncerEndpoint> = process.env.PGBOUNCER_HOSTS
  ? process.env.PGBOUNCER_HOSTS.split(",").map((host) => {
      const [hostname, port] = host.trim().split(":");
      return {
        host: hostname,
        port: Number.parseInt(port, 10) || 6432,
      };
    })
  : [{ host: "localhost", port: 6432 }];

const dialect = new ResilientPostgresDialect(pgBouncerEndpoints);

export const db = new Kysely<DB>({
  dialect,
});
