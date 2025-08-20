import type {
  DatabaseConfig,
  FailoverConfig,
  PgBouncerConfig,
} from "./types.js";

interface EnvConfig {
  POSTGRES_HOST: string;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_DB: string;
  NODE_ENV: string;
}

const parseEnvConfig = (): EnvConfig => {
  const required = [
    "POSTGRES_HOST",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_DB",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    POSTGRES_HOST: process.env.POSTGRES_HOST!,
    POSTGRES_USER: process.env.POSTGRES_USER!,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD!,
    POSTGRES_DB: process.env.POSTGRES_DB!,
    NODE_ENV: process.env.NODE_ENV || "development",
  };
};

const env = parseEnvConfig();

const createPgBouncerConfig = (
  id: string,
  port: number,
  priority: number
): PgBouncerConfig => ({
  id,
  host: env.POSTGRES_HOST,
  port,
  database: env.POSTGRES_DB,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  priority,
  ssl: env.NODE_ENV === "production",
});

export const databaseConfig: DatabaseConfig = {
  hosts: [
    createPgBouncerConfig("pgbouncer-primary", 6432, 1),
    createPgBouncerConfig("pgbouncer-secondary", 6433, 2),
    createPgBouncerConfig("pgbouncer-tertiary", 6434, 3),
  ] as const,
  poolConfig: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  failover: {
    maxRetryAttempts: 3,
    connectionTimeoutMs: 5000,
    queryTimeoutMs: 30000,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerRecoveryTimeoutMs: 30000,
    healthCheckIntervalMs: 10000,
  },
};
