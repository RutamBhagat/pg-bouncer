# PG-Bouncer

## Project Overview

PgBouncer connection pooling demonstration project with automatic failover support. Built as a TypeScript monorepo using Turborepo, with Next.js frontend and Hono API backend. Features multi-instance PgBouncer setup with health checking, circuit breaker pattern, and automatic failover capabilities.

## Architecture

### Tech Stack
- **Monorepo**: Turborepo with pnpm workspaces (pnpm@10.14.0)
- **Frontend** (`apps/web/`): Next.js 15.3, React 19, TailwindCSS v4, shadcn/ui, TanStack Query
- **Backend** (`apps/server/`): Hono server, Prisma ORM, Kysely query builder, PostgreSQL
- **Database**: PostgreSQL + 3 PgBouncer instances with failover support
- **Connection Management**: Custom FailoverPostgresDialect with ConnectionPoolManager
- **Monitoring**: Prometheus + Grafana (port 3002), PgBouncer exporters, custom metrics endpoint
- **Logging**: Structured logging with Pino (pino-pretty in development)

### Database Configuration
- **PostgreSQL**: Port 5432 (container: pg-bouncer-postgres)
- **PgBouncer Instances**:
  - Primary: Port 6432 (priority 1)
  - Secondary: Port 6433 (priority 2)  
  - Tertiary: Port 6434 (priority 3)
- **Pool Configuration** (per instance):
  - Pool mode: transaction
  - Default pool size: 200
  - Max client connections: 400
  - Server lifetime: 3600s (1 hour)
  - Server idle timeout: 600s (10 minutes)
- **Failover Configuration**:
  - Circuit breaker: Opossum library (failure threshold: 5, recovery timeout: 30s)
  - Health check interval: 10s
  - Connection timeout: 5s
  - Query timeout: 30s
  - Max retry attempts: 3

## Essential Commands

### Development Workflow
```bash
pnpm db:start           # ALWAYS run first - starts PostgreSQL + PgBouncer containers + monitoring stack
pnpm dev                # Start all services (web on 3001, server on 3000)
pnpm dev:web            # Start only Next.js frontend
pnpm dev:server         # Start only Hono API server
```

### Database Management
```bash
pnpm db:push            # Push Prisma schema changes to database
pnpm db:generate        # Generate Prisma client
pnpm db:migrate         # Run Prisma migrations
pnpm db:migrate-create  # Create migration without applying
pnpm db:studio          # Open Prisma Studio GUI
pnpm db:watch           # Start containers with logs visible
pnpm db:stop            # Stop containers (preserves data)
pnpm db:down            # Stop and remove containers
```

### Build & Validation
```bash
pnpm build              # Build all apps (uses tsdown for server, Next.js for web)
pnpm check-types        # TypeScript type checking across monorepo
```

## Key Components

### Server Architecture (`apps/server/src/`)
- **Entry point**: `src/index.ts` - Hono server with monitoring endpoints
- **Database Layer** (`src/db/`):
  - `client.ts`: Singleton Kysely database client
  - `dialect/FailoverPostgresDialect.ts`: Custom Kysely dialect with automatic failover
  - `connection/ConnectionPoolManager.ts`: Manages connections across PgBouncer instances, handles failover logic
  - `connection/PgBouncerHost.ts`: Individual host connection management with circuit breaker pattern
  - `health/HealthChecker.ts`: Connection warmup and health monitoring
  - `config/database.config.ts`: Centralized database configuration
- **Monitoring** (`src/monitoring/`):
  - `AlertService.ts`: Failover alerts with cooldown period (Slack webhook support)
- **Logging**: Structured logging via `src/logger.ts` (dbLogger, failoverLogger, healthLogger, metricsLogger)

### Path Aliases
- Server: `@/*` → `apps/server/src/*`
- Web: `@/*` → `apps/web/src/*`
- TypeScript configured with `moduleResolution: bundler` and `verbatimModuleSyntax: true`

### Environment Setup
Required `.env` file in `apps/server/`:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/pg-bouncer
CORS_ORIGIN=http://localhost:3001
POSTGRES_PASSWORD=password
POSTGRES_HOST=localhost
POSTGRES_USER=postgres
POSTGRES_DB=pg-bouncer
NODE_ENV=development
SLACK_WEBHOOK_URL=  # Optional for failover alerts
```

## Development Guidelines

### Server Development
- Uses tsx for hot-reload in development
- Prisma schema: `apps/server/prisma/schema/schema.prisma`
- Prisma client generated to `apps/server/prisma/generated/`
- TypeScript target: ESNext with module: ESNext
- JSX configured for Hono's JSX runtime
- Build output: `apps/server/dist/`

### Frontend Development  
- Uses Next.js with Turbopack
- TailwindCSS v4 with PostCSS
- Component structure in `apps/web/src/components/`
- App router pages in `apps/web/src/app/`
- Port 3001 (API server on port 3000)

### Docker & Persistence
- Docker Compose file: `apps/server/docker-compose.yml`
- Volumes: 
  - PostgreSQL data: `pg-bouncer_postgres_data`
  - Prometheus data: `prometheus_data`
  - Grafana data: `grafana_data`
- Logs: PgBouncer logs in `apps/server/logs/pgbouncer-*/`
- PID files: Using tmpfs mount at `/var/run/pgbouncer` for each instance
- Health checks configured for all services with auto-restart

### Monitoring Stack
- **Prometheus**: Port 9090, scrapes metrics every 15s
- **Grafana**: Port 3002 (admin/admin)
- **PgBouncer Exporters**: Ports 9127-9129 for primary/secondary/tertiary
- **App Metrics**: Available at `/monitoring/metrics` (port 3000)
- **Health Check**: `/monitoring/health` endpoint

## Testing & Verification

### Failover Testing
```bash
# Run comprehensive failover test (requires containers running)
bash apps/server/tests/test-failover.sh
```
The test script validates:
- Normal operation with primary PgBouncer
- Automatic failover to secondary when primary fails
- Recovery detection when primary comes back online
- Cascading failover to tertiary instance
- Full recovery with all instances restored

### API Testing Endpoints
- `/api/test-query` - Tests database connectivity and shows active PgBouncer
- `/monitoring/health` - Basic health check
- `/monitoring/health/detailed` - Detailed health status of all PgBouncer instances
- `/monitoring/metrics` - Prometheus-compatible metrics endpoint

## Important Notes

- No unit test framework currently configured (only integration test script)
- Circuit breaker pattern implemented for connection resilience (Opossum library)
- All PgBouncer instances use trust authentication internally
- CORS configured for local development (localhost:3001)
- Connection strategy supports both FAILOVER and LOAD_BALANCE modes
- Failover events trigger alerts with 5-minute cooldown to prevent spam
- All database operations use structured logging for debugging
- TypeScript strict mode enabled across monorepo
- No linting configured for server app (Next.js app has ESLint)