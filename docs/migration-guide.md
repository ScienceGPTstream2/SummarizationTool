# Migration Guide: Supabase → Azure Postgres + Better Auth + SQLAlchemy

## Overview

This migration replaces **Supabase** (auth + DB) with:
- **Azure Postgres Flexible Server** — `sciencegptsream2pg.postgres.database.azure.com`
- **SQLAlchemy + Alembic** — ORM and migrations for the Python backend
- **Better Auth** — authentication via a Node.js sidecar service with **GitHub Enterprise Cloud** OAuth

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

### Phase 2: Authentication (Better Auth + GitHub Enterprise Cloud)

| File | Purpose |
|------|---------|
| `auth-service/package.json` | Better Auth sidecar dependencies |
| `auth-service/tsconfig.json` | TypeScript config |
| `auth-service/src/index.ts` | Express server with Better Auth (email/password + GitHub OAuth) |
| `auth-service/.env.example` | Environment template |
| `backend/core/auth.py` | FastAPI auth middleware — validates Better Auth sessions via DB |
| `lib/auth.ts` | Frontend auth client (replaces `lib/supabase.ts`) |
| `utils/authUtils.ts` | Full auth utilities with `signInWithGitHub()`, `authenticatedFetch()`, etc. |

### Phase 3: Router Updates

| File | Change |
|------|--------|
| `backend/api/auth/router.py` | Uses `core.auth.get_current_user` |
| `backend/api/sessions/router.py` | **All endpoints** now require auth via `Depends(get_current_user)` |
| `backend/api/groups/router.py` | Uses `core.auth.get_current_user` |
| `backend/api/documents/router.py` | Uses `core.auth.get_current_user` |
| `backend/api/files/router.py` | Uses `core.auth.get_current_user` |
| `backend/api/server/router.py` | Uses `core.auth.get_current_user` |
| `backend/api/templates/router.py` | Uses `core.auth.get_current_user` |
| `backend/api/extractions/router.py` | Uses `core.auth.get_current_user` |
| `backend/api/evaluations/router.py` | Uses `core.auth.get_current_user` |
| `backend/core/dependencies.py` | Re-exports from `core.auth` (replaces Supabase auth) |

### Frontend Updates

| File | Change |
|------|--------|
| `components/LoginPage.tsx` | GitHub "Continue with GitHub" button |
| `components/AuthCallback.tsx` | Handles Better Auth OAuth callback |
| `App.tsx` | Uses Better Auth session management |
| `lib/supabase.ts` | Deprecated stub that re-exports from `lib/auth.ts` |

### Testing

| File | Purpose |
|------|---------|
| `backend/tests/test_auth_migration.py` | 6-step smoke test |

## Key Differences from Supabase

| Aspect | Supabase (old) | New Stack |
|--------|---------------|-----------|
| Auth provider | Supabase GoTrue JWT | Better Auth session tokens |
| OAuth provider | GitHub (via Supabase) | GitHub Enterprise Cloud (direct) |
| DB access | Supabase REST API (`postgrest`) | SQLAlchemy ORM |
| Migrations | Raw SQL files | Alembic autogenerate |
| Session validation | JWT decode | DB lookup (`session` table) |
| User table | `auth.users` (Supabase managed) | `user` (Better Auth managed) |
| Session table | Supabase `auth.sessions` | `session` (Better Auth) |
| App sessions | `sessions` table | `app_sessions` table |

## Migration Status: Complete

All Supabase artifacts have been removed. The codebase runs entirely on Azure Postgres + SQLAlchemy + Better Auth. There is no rollback path.
