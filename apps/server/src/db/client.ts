import type { DB } from "@/db/types";
import { FailoverPostgresDialect } from "@/db/drivers/failover-dialect";
import { Kysely } from "kysely";

export interface DatabaseEndpoint {
  connectionString: string;
}

const databaseEndpoints: Array<DatabaseEndpoint> = process.env
  .DATABASE_URL!.split(",")
  .map((url) => ({
    connectionString: url.trim(),
  }));

export const db = new Kysely<DB>({
  dialect: new FailoverPostgresDialect(databaseEndpoints),
});
