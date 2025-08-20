# PG-Bouncer

## Project Overview

PgBouncer connection pooling demonstration project with failover support, built with TypeScript monorepo using Turborepo, Next.js frontend, and Hono API backend. Features multi-instance PgBouncer setup with health checking and automatic failover capabilities.

## Architecture

### Tech Stack
- **Monorepo**: Turborepo with pnpm workspaces
- **Frontend** (`apps/web/`): Next.js 15.3, React 19, TailwindCSS v4, shadcn/ui, TanStack Query
- **Backend** (`apps/server/`): Hono server, Prisma ORM, Kysely query builder, PostgreSQL
- **Database**: PostgreSQL + 3 PgBouncer instances with failover support
- **Connection Management**: Custom FailoverPostgresDialect with ConnectionPoolManager

### Database Configuration
- **PostgreSQL**: Port 5432 (container: pg-bouncer-postgres)
- **PgBouncer Instances**:
  - Primary: Port 6432
  - Secondary: Port 6433  
  - Tertiary: Port 6434
- **Pool Configuration** (per instance):
  - Pool mode: transaction
  - Default pool size: 200
  - Max client connections: 400
  - Server lifetime: 3600s (1 hour, not 15 minutes as previously stated)
  - Server idle timeout: 600s (10 minutes)

## Essential Commands

### Development Workflow
```bash
pnpm db:start           # ALWAYS run first - starts PostgreSQL + PgBouncer containers
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

### Server Architecture (`apps/server/src/db/`)
- **FailoverPostgresDialect**: Custom Kysely dialect with automatic failover
- **ConnectionPoolManager**: Manages connections across PgBouncer instances
- **PgBouncerHost**: Individual host connection management with circuit breaker pattern (Opossum)
- **HealthChecker**: Connection warmup and health monitoring
- **Database Config**: Centralized configuration in `database.config.ts`

### Path Aliases
- Server: `@/*` → `apps/server/src/*`
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
```

## Development Guidelines

### Server Development
- Entry point: `apps/server/src/index.ts`
- Uses tsx for hot-reload in development
- Prisma client generated to `apps/server/prisma/generated/`
- TypeScript target: ESNext with module: ESNext
- JSX configured for Hono's JSX runtime

### Frontend Development  
- Uses Next.js with Turbopack
- TailwindCSS v4 with PostCSS
- Component structure in `apps/web/src/components/`
- App router pages in `apps/web/src/app/`

### Docker & Persistence
- Volumes: PostgreSQL data persisted to `pg-bouncer_postgres_data`
- Logs: PgBouncer logs in `apps/server/logs/pgbouncer-*/`
- PID files: Using tmpfs mount at `/var/run/pgbouncer` for each instance
- Health checks configured for all services with auto-restart

## Important Notes

- No test framework currently configured
- Circuit breaker pattern implemented for connection resilience
- All PgBouncer instances use trust authentication internally
- Frontend runs on port 3001, API server on port 3000
- CORS configured for local development