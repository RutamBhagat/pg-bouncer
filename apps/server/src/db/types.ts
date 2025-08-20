import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type User = {
    id: string;
    email: string;
    name: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Timestamp;
};
export type DB = {
    User: User;
};
