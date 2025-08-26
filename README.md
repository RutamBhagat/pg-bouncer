# pgbouncer-csf


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

## Architecture Overview

### Monorepo Structure
This is a TypeScript monorepo managed by Turborepo with two main applications:
- **apps/web**: Next.js frontend with authentication UI
- **apps/server**: Hono API server with resilient database connections

### Database Resilience System
The server implements a sophisticated PgBouncer failover mechanism for high availability:

1. **ResilientPostgresDialect** (`apps/server/src/db/resilient-dialect.ts`): Custom Kysely dialect that creates the resilient driver
2. **ResilientPostgresDriver** (`apps/server/src/db/resilient-driver.ts`): Implements retry policies, circuit breakers, and timeouts using Cockatiel
3. **FailoverPoolManager** (`apps/server/src/db/failover-pool.ts`): Manages multiple PgBouncer connections with health checks and automatic failover
4. **ResilientConnection** (`apps/server/src/db/resilient-connection.ts`): Wraps database queries with resilience policies

The system monitors multiple PgBouncer endpoints (configured via `PGBOUNCER_HOSTS` environment variable), performs health checks every 5 seconds, and automatically fails over to healthy instances when issues occur.

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
- `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`: PostgreSQL credentials
- `PGBOUNCER_HOSTS`: Comma-separated list of PgBouncer endpoints (e.g., "host1:6432,host2:6432")
- `BETTER_AUTH_SECRET`: Authentication secret key
- `BETTER_AUTH_URL`: Authentication base URL

### Biome Settings
- Double quotes for strings
- 2-space indentation
- Automatic import organization
- Custom class sorting for Tailwind utilities (clsx, cva, cn functions)