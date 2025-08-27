# pgbouncer-csf

## Architecture Overview

### Monorepo Structure
This is a TypeScript monorepo managed by Turborepo with two main applications:
- **apps/web**: Next.js frontend with authentication UI
- **apps/server**: Hono API server with resilient database connections

### Database Resilience System
The server implements a sophisticated PgBouncer failover mechanism for high availability:

1. **FailoverPostgresDialect** (`apps/server/src/db/drivers/failover-dialect.ts`): Custom Kysely dialect that creates the failover driver
2. **FailoverPostgresDriver** (`apps/server/src/db/drivers/failover-driver.ts`): Implements connection management with automatic failover
3. **FailoverConnectionManager** (`apps/server/src/db/drivers/failover-connection-manager.ts`): Manages multiple PgBouncer connections with health checks, circuit breakers, and automatic failover using Cockatiel library

The system monitors multiple PgBouncer endpoints (configured via `DATABASE_URL` environment variable), performs health checks every 5 seconds, and automatically fails over to healthy instances when issues occur.

### Authentication
Uses Better Auth library with:
- Email/password authentication
- Session management via Prisma
- Auth client configured in `apps/web/src/lib/auth-client.ts`
- Server auth setup in `apps/server/src/lib/auth.ts`

### Type Safety
- Prisma generates TypeScript types from schema
- Prisma-Kysely bridges Prisma types to Kysely query builder
- Full end-to-end type safety from database to frontend

## Key Configuration

### Environment Variables
Server requires these in `apps/server/.env`:
- `DATABASE_URL`: Comma-separated list of PgBouncer connection strings (format: "postgres://user:pass@host1:port/db,postgres://user:pass@host2:port/db")
- `CORS_ORIGIN`: Frontend URL for CORS configuration
- `BETTER_AUTH_SECRET`: Authentication secret key
- `BETTER_AUTH_URL`: Authentication base URL

### Biome Settings
- Double quotes for strings
- 2-space indentation
- Automatic import organization
- Custom class sorting for Tailwind utilities (clsx, cva, cn functions)

## Development Commands

### Core Development
```bash
# Start all applications (web on port 3001, server on port 3000)
pnpm dev

# Start specific apps
pnpm dev:web      # Frontend only
pnpm dev:server   # Backend only

# Build all applications
pnpm build

# Type checking across all apps
pnpm check-types

# Format and lint with Biome
pnpm check
```

### Database Management
```bash
# Push Prisma schema to database
pnpm db:push

# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Open Prisma Studio UI
pnpm db:studio

# Docker database management
pnpm db:start   # Start database containers
pnpm db:stop    # Stop database containers
pnpm db:watch   # Start and watch logs
pnpm db:down    # Stop and remove containers
```
