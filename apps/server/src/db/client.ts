import type { DB } from "@/db/types";
import { Kysely } from "kysely";
import { ResilientPostgresDialect } from "@/db/drivers/resilient-dialect";

export interface DatabaseEndpoint {
  connectionString: string;
}

const databaseEndpoints: Array<DatabaseEndpoint> =
  process.env.DATABASE_URL!.split(",").map((url) => ({
    connectionString: url.trim(),
  }));

export const db = new Kysely<DB>({
  dialect: new ResilientPostgresDialect(databaseEndpoints),
});
