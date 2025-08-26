import type { DB } from "./types";
import { Kysely } from "kysely";
import { ResilientPostgresDialect } from "./resilient-dialect";

export interface PgBouncerEndpoint {
  host: string;
  port: number;
}

const pgBouncerEndpoints: Array<PgBouncerEndpoint> = process.env.PGBOUNCER_HOSTS
  ? process.env.PGBOUNCER_HOSTS.split(",").map((host) => {
      const [hostname, port] = host.trim().split(":");
      return {
        host: hostname,
        port: Number.parseInt(port, 10) || 6432,
      };
    })
  : [{ host: "localhost", port: 6432 }];

export const db = new Kysely<DB>({
  dialect: new ResilientPostgresDialect(pgBouncerEndpoints),
});
