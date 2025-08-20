# PG-Bouncer

## Project Overview

This is a PgBouncer connection pooling demonstration project built with the Better-T-Stack (TypeScript, Next.js, Hono, Prisma). It features a monorepo setup with Turborepo managing a Next.js frontend and Hono API backend, integrated with PostgreSQL through multiple PgBouncer instances.

## Architecture

- **Monorepo Structure**: Uses Turborepo with pnpm workspaces
- **Frontend** (`apps/web/`): Next.js 15.3 with React 19, TailwindCSS, shadcn/ui
- **Backend** (`apps/server/`): Hono server with Prisma ORM and PostgreSQL
- **Database Setup**: PostgreSQL with 3 PgBouncer instances (primary, secondary, tertiary) for connection pooling
- **Containerization**: Docker Compose setup with health checks and volume persistence

## Essential Commands

### Development
```bash
pnpm dev                # Start all services (web + server)
pnpm dev:web            # Start only Next.js frontend (port 3001)
pnpm dev:server         # Start only Hono API server (port 3000)
```

### Database Operations
```bash
pnpm db:start           # Start PostgreSQL + PgBouncer containers
pnpm db:watch           # Start containers with logs visible
pnpm db:stop            # Stop containers
pnpm db:down            # Stop and remove containers
pnpm db:push            # Push Prisma schema to database
pnpm db:generate        # Generate Prisma client
pnpm db:studio          # Open Prisma Studio
pnpm db:migrate         # Run Prisma migrations
```

### Build & Type Checking
```bash
pnpm build              # Build all apps
pnpm check-types        # TypeScript type checking across all apps
```

## Database Architecture

The project uses a sophisticated PostgreSQL + PgBouncer setup:

- **PostgreSQL**: Main database on port 5432
- **PgBouncer Primary**: Port 6432 (transaction mode, 200 pool size, 400 max connections)
- **PgBouncer Secondary**: Port 6433 (same config as primary)
- **PgBouncer Tertiary**: Port 6434 (same config as primary)

All PgBouncer instances are configured with:
- Transaction-level pooling
- Health checks and auto-restart
- Persistent logging and PID file volumes
- 15-minute server lifetime, 10-minute idle timeout

## Key File Locations

- **Server entry**: `apps/server/src/index.ts`
- **Prisma schema**: `apps/server/prisma/schema/schema.prisma`
- **Docker config**: `apps/server/docker-compose.yml`
- **PgBouncer configs**: `apps/server/docker/pgbouncer-*/pgbouncer.ini`
- **Frontend pages**: `apps/web/src/app/`
- **UI components**: `apps/web/src/components/`

## Development Notes

- The server uses tsx for hot-reload development and tsdown for building
- Prisma client is generated to `apps/server/prisma/generated/`
- Frontend uses Next.js with Turbopack for development
- CORS is configured for cross-origin requests between frontend and API
- Environment variables should be set in `apps/server/.env`

## PgBouncer Management

PgBouncer logs are persisted to `apps/server/logs/pgbouncer-*/` and PID files to `apps/server/run/pgbouncer-*/`. Each instance has identical configuration but runs on different ports for load distribution testing.

Always use `pnpm db:start` before development to ensure the database infrastructure is running.