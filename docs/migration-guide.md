# Migration Guide: Supabase → Azure Postgres + Better Auth + SQLAlchemy

## Overview

This migration replaces **Supabase** (auth + DB) with:
- **Azure Postgres Flexible Server** — `sciencegptsream2pg.postgres.database.azure.com`
- **SQLAlchemy + Alembic** — ORM and migrations for the Python backend
- **Better Auth** — authentication via a Node.js sidecar service

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   React Frontend│────▶│ Better Auth      │────▶│  Azure Postgres     │
│   (Vite)        │     │ Sidecar (:3001)  │     │  Flexible Server    │
│   lib/auth.ts   │     │ auth-service/    │     │                     │
└────────┬────────┘     └──────────────────┘     │  Tables:            │
         │                                        │  - user (Better Auth)│
         │  Bearer token / cookie                 │  - session          │
         ▼                                        │  - account          │
┌─────────────────┐                               │  - app_sessions     │
│  FastAPI Backend │──────────────────────────────▶│  - documents        │
│  (:8000)         │  SQLAlchemy session lookup    │  - extraction_results│
│  core/auth.py    │                               │  - evaluation_results│
└─────────────────┘                               │  - groups, templates │
                                                   └─────────────────────┘
```

## What Was Created

### Phase 1: Database Layer (SQLAlchemy + Alembic)

| File | Purpose |
|------|---------|
| `backend/models/base.py` | SQLAlchemy engine, session factory, `DATABASE_URL` |
| `backend/models/user.py` | Better Auth tables: `user`, `account`, `session`, `verification` |
| `backend/models/app_session.py` | App extraction sessions (renamed from `sessions`) |
| `backend/models/document.py` | Document metadata |
| `backend/models/extraction.py` | Extraction results |
| `backend/models/evaluation.py` | Evaluation scores |
| `backend/models/group.py` | Groups + membership |
| `backend/models/template.py` | Prompt templates + versions + permissions |
| `backend/models/preferences.py` | User preferences, login history |
| `backend/models/__init__.py` | Package that imports all models |
| `backend/alembic.ini` | Alembic configuration |
| `backend/alembic/env.py` | Alembic environment (reads models + DATABASE_URL) |
| `backend/alembic/script.py.mako` | Migration template |

### Phase 2: Authentication

| File | Purpose |
|------|---------|
| `auth-service/package.json` | Better Auth sidecar dependencies |
| `auth-service/tsconfig.json` | TypeScript config |
| `auth-service/src/index.ts` | Express server with Better Auth (email/password + Microsoft Entra) |
| `auth-service/.env.example` | Environment template |
| `backend/core/auth.py` | FastAPI auth middleware — validates Better Auth sessions via DB |
| `lib/auth.ts` | Frontend auth client (replaces `lib/supabase.ts`) |

### Testing

| File | Purpose |
|------|---------|
| `backend/tests/test_auth_migration.py` | 6-step smoke test |

## Setup Steps

### Step 1: Azure Postgres Firewall

Add the VM's IP to the Postgres Flexible Server firewall:

```bash
az postgres flexible-server firewall-rule create \
  --resource-group <your-rg> \
  --name sciencegptsream2pg \
  --rule-name allow-dev-vm \
  --start-ip-address 20.83.164.199 \
  --end-ip-address 20.83.164.199
```

Or via Azure Portal: Postgres server → Networking → Add firewall rule.

### Step 2: Create the Database

```bash
psql "host=sciencegptsream2pg.postgres.database.azure.com port=5432 \
  dbname=postgres user=sciencegpt sslmode=require" \
  -c "CREATE DATABASE summarization_tool;"
```

### Step 3: Set Environment Variable

Add to your `.env` or shell:
```bash
export DATABASE_URL="postgresql://<user>:<password>@<host>:5432/summarization_tool?sslmode=require"
```

### Step 4: Install Python Dependencies

```bash
cd backend
pip install sqlalchemy[asyncio] alembic psycopg2-binary
```

### Step 5: Run Smoke Test (Models Only)

```bash
cd backend
python tests/test_auth_migration.py
```

This tests model imports without needing DB connectivity.

### Step 6: Run Initial Migration

Once DB connectivity is working:

```bash
cd backend
alembic revision --autogenerate -m "initial_schema"
alembic upgrade head
```

Or use the test to create tables directly:
```bash
cd backend
DATABASE_URL=postgresql://... python tests/test_auth_migration.py
```

### Step 7: Set Up Better Auth Sidecar

```bash
cd auth-service
cp .env.example .env
# Edit .env with your DATABASE_URL and a random BETTER_AUTH_SECRET
npm install
npm run dev
```

Test it:
```bash
curl http://localhost:3001/health
```

### Step 8: Register Microsoft Entra App (when ready)

1. Go to Azure Portal → Microsoft Entra ID → App registrations → New
2. Set redirect URI: `http://localhost:3001/api/auth/callback/microsoft`
3. Create a client secret
4. Add to `auth-service/.env`:
   ```
   MICROSOFT_CLIENT_ID=<app-id>
   MICROSOFT_CLIENT_SECRET=<secret>
   MICROSOFT_TENANT_ID=<tenant-id>
   ```
5. Restart the auth service

### Step 9: Update Frontend

1. Install better-auth client: `npm install better-auth`
2. Add to `.env`: `VITE_AUTH_URL=http://localhost:3001`
3. Replace imports:
   - Old: `import { supabase } from '../lib/supabase'`
   - New: `import { authClient, signIn, signOut, useSession } from '../lib/auth'`

### Step 10: Update FastAPI Endpoints

Replace the old auth dependency:
```python
# Old (Supabase)
from core.dependencies import get_current_user

# New (Better Auth)
from core.auth import get_current_user
```

Usage in routers stays the same:
```python
@router.get("/sessions")
async def list_sessions(user: dict = Depends(get_current_user)):
    user_id = user["id"]  # Same interface
```

## Key Differences from Supabase

| Aspect | Supabase (old) | New Stack |
|--------|---------------|-----------|
| Auth | Supabase GoTrue JWT | Better Auth session tokens |
| DB access | Supabase REST API (`postgrest`) | SQLAlchemy ORM |
| Migrations | Raw SQL files | Alembic autogenerate |
| Session validation | JWT decode | DB lookup (`session` table) |
| User table | `auth.users` (Supabase managed) | `user` (Better Auth managed) |
| Session table | Supabase `auth.sessions` | `session` (Better Auth) |
| App sessions | `sessions` table | `app_sessions` table |

## Rollback Plan

The old Supabase Docker setup remains in `supabase-docker/`. To rollback:
1. Revert the code changes (git)
2. Restart Supabase Docker containers
3. No data loss — Azure Postgres is independent

## Files to Eventually Remove (Phase 3)

- `lib/supabase.ts` → replaced by `lib/auth.ts`
- `backend/services/database/supabase_db_service.py` → replaced by SQLAlchemy models
- `backend/api/auth/` (old Supabase auth routes)
- `utils/authUtils.ts` (old Supabase auth utilities)
- `supabase-docker/` (entire directory, once fully migrated)
