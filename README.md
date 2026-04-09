# AI Document Summarization Tool 🚀

Full-stack React + FastAPI application for AI-powered document summarization, entity extraction, and evaluation — with Better Auth for authentication and PostgreSQL for data persistence.

📖 **Additional Documentation:**

- [Local Dev Setup](docs/local-deploy.md) — Step-by-step guide for team members
- [Backend README](backend/README.md) — Backend configuration and secrets
- [GitHub Auth Setup](docs/setup-github-auth.md) — Setting up GitHub OAuth

---

## ✨ Features

- 📄 Upload and process PDFs (Azure Document Intelligence or open-source Docling)
- 🤖 Entity extraction with customizable prompts (Azure OpenAI, Google Gemini, Ollama)
- 📊 G-Eval evaluation framework (LLM-as-a-judge with correctness, completeness, relevance metrics)
- 🔐 User authentication via Better Auth (GitHub OAuth)
- 👥 Groups & session sharing between users
- 📝 Template system with versioning, scoping (user/group/global), and forking
- � Session persistence and history tracking
- 📦 Batch processing for multi-document workflows
- 🌙 Dark/light theme toggle

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Your Machine                                            │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Frontend    │  │  Backend     │  │  Auth        │   │
│  │  Vite/React  │  │  FastAPI     │  │  Sidecar     │   │
│  │  :3000       │  │  :8001       │  │  :3001       │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                 │            │
└─────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │
          │          ┌──────┴─────────────────┴───┐
          │          │  PostgreSQL Database        │
          └──────────┤  (Azure, Docker, or local)  │
                     └────────────────────────────┘
```

| Service              | Port | Description                                    |
| -------------------- | ---- | ---------------------------------------------- |
| Frontend (Vite/React)| 3000 | User interface                                 |
| Backend (FastAPI)    | 8001 | API server for document processing & LLM calls |
| Auth Sidecar (Node)  | 3001 | Better Auth — handles GitHub OAuth login       |
| PostgreSQL           | 5432 | Shared database for all services               |

---

## 🛠 Prerequisites

- **Node.js & npm** (LTS recommended)
- **Python 3.10+** & pip
- **PostgreSQL 14+** (see [Database Setup](#-database-setup) below)
- A GitHub OAuth App (for authentication — see [docs/setup-github-auth.md](docs/setup-github-auth.md))

---

## 🗄 Database Setup

The app uses PostgreSQL via SQLAlchemy. You have several options:

### Option A: Local PostgreSQL via Docker (Easiest)

No Azure account needed — one command gets you running:

```bash
docker run -d --name sciencegpt-db \
  -e POSTGRES_USER=sciencegpt \
  -e POSTGRES_PASSWORD=localdev123 \
  -e POSTGRES_DB=summarization_tool \
  -p 5432:5432 \
  postgres:16
```

Then set in both `backend/.env` and `auth-service/.env`:
```env
DATABASE_URL=postgresql://sciencegpt:localdev123@localhost:5432/summarization_tool
```

### Option B: Azure PostgreSQL Flexible Server (Team Default)

If you're on the team, use the shared Azure PG instance. Get the connection string from the team lead and set it in `backend/.env` and `auth-service/.env`:

```env
DATABASE_URL=postgresql://sciencegpt:<PASSWORD>@<YOUR_SERVER>.postgres.database.azure.com:5432/summarization_tool?sslmode=require
```

> ⚠️ You must add your IP to the Azure firewall rules — see [docs/local-deploy.md](docs/local-deploy.md#step-3-azure-pg-firewall--add-your-vms-ip).

### Option C: Any Other PostgreSQL

Works with AWS RDS, Supabase hosted, Neon, Railway, or any PostgreSQL 14+ instance. Just provide a `DATABASE_URL`.

### Run Migrations

After setting up your database, create the schema:

```bash
cd backend
source ../venv/bin/activate  # or your virtualenv
alembic upgrade head
```

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone git@github.com:ScienceGPTstream2/SummarizationTool.git
cd SummarizationTool

# Python virtualenv
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# Frontend
npm ci

# Auth service
cd auth-service && npm install && npx tsc && cd ..
```

### 2. Configure Environment Files

You need **4 files** (all gitignored):

| File | Purpose |
| --- | --- |
| `backend/.env` | `DATABASE_URL` for the backend |
| `backend/core/secrets.toml` | Azure OpenAI keys, Doc Intelligence, Vertex AI |
| `auth-service/.env` | `DATABASE_URL`, Better Auth secret, GitHub OAuth credentials |
| `.env.local` | Frontend env vars (`VITE_API_BASE_URL`, `VITE_AUTH_URL`) |

**Minimal `.env.local`:**
```env
VITE_API_BASE_URL=http://localhost:8001
VITE_AUTH_URL=http://localhost:3001
```

**Minimal `backend/.env`:**
```env
DATABASE_URL=postgresql://sciencegpt:localdev123@localhost:5432/summarization_tool
```

**Minimal `auth-service/.env`:**
```env
DATABASE_URL=postgresql://sciencegpt:localdev123@localhost:5432/summarization_tool
BETTER_AUTH_SECRET=generate-a-random-secret-here
BETTER_AUTH_URL=http://localhost:3001
GITHUB_CLIENT_ID=your-github-oauth-client-id
GITHUB_CLIENT_SECRET=your-github-oauth-client-secret
FRONTEND_URL=http://localhost:3000
PORT=3001
```

See [auth-service/.env.example](auth-service/.env.example) for all options.

### 3. Run Migrations

```bash
cd backend && alembic upgrade head && cd ..
```

### 4. Start All 3 Services

Open **3 terminals**:

```bash
# Terminal 1 — Auth Sidecar
cd auth-service && node dist/index.js

# Terminal 2 — Backend
cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8001

# Terminal 3 — Frontend
npm run dev
```

App will be available at **http://localhost:3000**

---

## 📂 Project Structure

```
├── backend/                # FastAPI server
│   ├── api/                # Route handlers (sessions, groups, templates, etc.)
│   ├── models/             # SQLAlchemy models
│   ├── services/           # Business logic (LLM, sessions, groups, templates)
│   ├── core/               # Config, auth, secrets.toml
│   ├── alembic/            # Database migrations
│   └── tests/              # Integration test suite
├── auth-service/           # Better Auth sidecar (Node.js/TypeScript)
├── components/             # React UI components
├── docs/                   # Setup guides and documentation
├── templates/              # Extraction prompt templates
├── .env.example            # Frontend env template
└── README.md               # This file
```

### Environment Files

| File | Purpose | Git Status |
| --- | --- | --- |
| `.env.example` | Template for frontend env vars | ✅ Committed |
| `.env.local` | Actual frontend env vars | ❌ Gitignored |
| `backend/.env` | Backend `DATABASE_URL` | ❌ Gitignored |
| `backend/core/secrets.toml` | Backend API keys & secrets | ❌ Gitignored |
| `auth-service/.env` | Auth sidecar config | ❌ Gitignored |
| `auth-service/.env.example` | Template for auth sidecar | ✅ Committed |

---

## 🧪 Running Tests

The project includes a comprehensive integration test suite:

```bash
export AUTH_TOKEN_A="<token-for-user-a>"
export AUTH_TOKEN_B="<token-for-user-b>"
./backend/tests/run_all_tests.sh
```

Test modules:
- **Auth edge cases** — invalid tokens, missing headers, SQL injection
- **Session edge cases** — empty sessions, incomplete extractions, PATCH edge cases
- **Cross-user isolation** — ensures users can't access each other's data
- **Groups integration** — CRUD, membership, permissions
- **Session sharing** — share→clone→evaluate flow

---

## 📖 Deployment

### Production Build

```bash
npm run build
```

Serve `dist/` on any static host (Netlify, Vercel, Nginx, etc.).

For remote access, set the API URL:

```bash
VITE_API_BASE_URL="http://<PUBLIC_IP>:8001" npm run build
```

---

## 🙏 Thank You

Special thanks to:

- Health Canada Solutions Fund 💖
- Shared Services Canada Science Cloud ☁️
