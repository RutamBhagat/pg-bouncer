import pino from "pino";

const logger = pino({
  level: "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

// Common PostgreSQL error codes
const DB_ERROR_CODES = {
  CONNECTION_EXCEPTION: "08000",
  CONNECTION_DOES_NOT_EXIST: "08003",
  CONNECTION_FAILURE: "08006",
  TOO_MANY_CONNECTIONS: "53300",
  CANNOT_CONNECT_NOW: "57P03",
  ADMIN_SHUTDOWN: "57P01",
  CRASH_SHUTDOWN: "57P02",
  QUERY_CANCELED: "57014",
  LOCK_NOT_AVAILABLE: "55P03",
  DEADLOCK_DETECTED: "40P01",
  SERIALIZATION_FAILURE: "40001",
  DISK_FULL: "53100",
  OUT_OF_MEMORY: "53200",
  INSUFFICIENT_PRIVILEGE: "42501",
} as const;

type DbErrorCode = (typeof DB_ERROR_CODES)[keyof typeof DB_ERROR_CODES];

interface DbErrorLog {
  timestamp: string;
  level: "warn" | "error";
  event: "db_connection_error" | "db_pool_error" | "db_failover";
  error_code?: string;
  error_type: string;
  message: string;
  pgbouncer_index?: number;
  endpoint?: string;
  retry_count?: number;
}

export function logDbError(error: Error, context: Partial<DbErrorLog>) {
  const pgError = error as any;
  const errorCode = pgError.code as DbErrorCode;

  const logData = {
    event: context.event || "db_connection_error",
    error_code: errorCode,
    error_type: getErrorType(errorCode, error.message),
    pgbouncer_index: context.pgbouncer_index,
    endpoint: context.endpoint,
    retry_count: context.retry_count,
  };

  const message = getErrorMessage(errorCode, error.message);
  const level = context.level || "warn";

  if (level === "error") {
    logger.error(logData, message);
  } else {
    logger.warn(logData, message);
  }
}

function getErrorType(code: string | undefined, message: string): string {
  if (!code) return getErrorTypeFromMessage(message);

  switch (code) {
    case DB_ERROR_CODES.CONNECTION_EXCEPTION:
    case DB_ERROR_CODES.CONNECTION_DOES_NOT_EXIST:
    case DB_ERROR_CODES.CONNECTION_FAILURE:
      return "connection_error";
    case DB_ERROR_CODES.TOO_MANY_CONNECTIONS:
      return "connection_limit_exceeded";
    case DB_ERROR_CODES.CANNOT_CONNECT_NOW:
    case DB_ERROR_CODES.ADMIN_SHUTDOWN:
    case DB_ERROR_CODES.CRASH_SHUTDOWN:
      return "server_unavailable";
    case DB_ERROR_CODES.QUERY_CANCELED:
      return "query_timeout";
    case DB_ERROR_CODES.DEADLOCK_DETECTED:
      return "deadlock";
    case DB_ERROR_CODES.SERIALIZATION_FAILURE:
      return "serialization_conflict";
    case DB_ERROR_CODES.DISK_FULL:
    case DB_ERROR_CODES.OUT_OF_MEMORY:
      return "resource_exhaustion";
    case DB_ERROR_CODES.INSUFFICIENT_PRIVILEGE:
      return "permission_denied";
    default:
      return getErrorTypeFromMessage(message);
  }
}

function getErrorTypeFromMessage(message: string): string {
  if (message.includes("Connection terminated")) return "connection_terminated";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("ECONNREFUSED")) return "connection_refused";
  if (message.includes("ENOTFOUND")) return "host_not_found";
  if (message.includes("ECONNRESET")) return "connection_reset";
  if (message.includes("ETIMEDOUT")) return "connection_timeout";
  return "unknown_error";
}

function getErrorMessage(
  code: string | undefined,
  originalMessage: string,
): string {
  if (!code) {
    return getSimplifiedMessage(originalMessage);
  }

  switch (code) {
    case DB_ERROR_CODES.CONNECTION_EXCEPTION:
    case DB_ERROR_CODES.CONNECTION_FAILURE:
      return "Failed to establish database connection";
    case DB_ERROR_CODES.TOO_MANY_CONNECTIONS:
      return "Database has reached maximum connection limit";
    case DB_ERROR_CODES.CANNOT_CONNECT_NOW:
      return "Database is not accepting connections";
    case DB_ERROR_CODES.ADMIN_SHUTDOWN:
      return "Database is shutting down";
    case DB_ERROR_CODES.DEADLOCK_DETECTED:
      return "Database deadlock detected";
    case DB_ERROR_CODES.DISK_FULL:
      return "Database disk space full";
    case DB_ERROR_CODES.OUT_OF_MEMORY:
      return "Database out of memory";
    case DB_ERROR_CODES.INSUFFICIENT_PRIVILEGE:
      return "Insufficient database privileges";
    default:
      return getSimplifiedMessage(originalMessage);
  }
}

function getSimplifiedMessage(originalMessage: string): string {
  if (originalMessage.includes("Connection terminated"))
    return "Database connection was terminated unexpectedly";
  if (originalMessage.includes("ECONNREFUSED"))
    return "Connection refused - database server may be down";
  if (originalMessage.includes("ENOTFOUND")) return "Database host not found";
  if (
    originalMessage.includes("timeout") ||
    originalMessage.includes("ETIMEDOUT")
  )
    return "Database connection timed out";
  if (originalMessage.includes("ECONNRESET"))
    return "Database connection was reset";
  return "Database connection error";
}
