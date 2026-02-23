# AI Document Summarization Tool 🚀

Full-stack React + FastAPI application for AI-powered document summarization and entity extraction, with Supabase for authentication and data persistence.

🔗 **Additional Documentation:**

- [Backend README](backend/README.md) - Backend setup, configuration, and secrets
- [Supabase README](supabase-docker/README.md) - Database and authentication setup

---

## ✨ Features

- 📄 Upload and process PDFs (and other document formats)
- 🤖 Summarization using AI models (Azure OpenAI, Google Gemini, local Ollama)
- 🕵️‍♂️ Entity extraction with customizable prompts
- 🔐 User authentication via Supabase (GitHub OAuth)
- 💾 Session persistence and history tracking
- ⚙️ Settings management for API keys and model choices
- 🌙 Dark/light theme toggle for comfortable reading

---

## 🏗 Architecture Overview

| Service                 | Port | Description                                     |
| ----------------------- | ---- | ----------------------------------------------- |
| Frontend (Vite/React)   | 3000 | User interface                                  |
| Backend (FastAPI)       | 8001 | API server for document processing and LLM      |
| Supabase (Kong Gateway) | 8000 | Authentication, database, and REST API          |
| Supabase Studio         | 8000 | Database management UI (via `/project/default`) |

---

## 🛠 Prerequisites

- **Node.js & npm** (LTS recommended)
- **Python 3.10+** & pip
- **Docker & Docker Compose** (for Supabase)
- A valid `secrets.toml` in `backend/core/` (see Backend README)

---

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone <repo-url> SummarizationTool
cd SummarizationTool
```

### 2. Start Supabase (Database & Auth)

```bash
cd supabase-docker
cp .env.example .env  # If first time, configure secrets
docker compose up -d
cd ..
```

Supabase will be available at `http://localhost:8000`

### 3. Install & Start Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

### 4. Install & Start Frontend

```bash
# Copy environment template
cp .env.example .env.local

# Edit .env.local with your Supabase anon key (from supabase-docker/.env)
# VITE_SUPABASE_ANON_KEY=your-anon-key-here

npm install
npm run dev
```

App will be available at `http://localhost:3000`

---

## 📂 Project Structure

```
├── backend/               # FastAPI server (see Backend README)
│   └── core/secrets.toml  # Backend secrets (API keys, Supabase config)
├── components/            # React UI components
├── supabase-docker/       # Self-hosted Supabase (see Supabase README)
│   └── .env               # Supabase secrets (JWT, passwords)
├── styles/                # Global CSS
├── templates/             # Summarization templates
├── .env.example           # Frontend env template (copy to .env.local)
├── .env.local             # Frontend env variables (gitignored)
├── App.tsx                # Main application component
├── main.tsx               # Front-end entry point
└── README.md              # This file
```

### Environment Files

| File                        | Purpose                        | Git Status    |
| --------------------------- | ------------------------------ | ------------- |
| `.env.example`              | Template for frontend env vars | ✅ Committed  |
| `.env.local`                | Actual frontend env vars       | ❌ Gitignored |
| `supabase-docker/.env`      | Supabase secrets               | ❌ Gitignored |
| `backend/core/secrets.toml` | Backend API keys & secrets     | ❌ Gitignored |

---

## 🚀 Starting All Services

Run these in separate terminals (or use the systemd service for Supabase):

```bash
# Terminal 1: Supabase (if not using systemd auto-start)
cd supabase-docker && docker compose up -d

# Terminal 2: Backend (FastAPI)
cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8001

# Terminal 3: Frontend (React/Vite)
npm run dev -- --host
```

For remote access, set the API URL:

```bash
VITE_API_BASE_URL="http://<PUBLIC_IP>:8001" npm run dev -- --host
```

---

## 📖 Deployment

### Production Build

```bash
npm run build
```

Serve `dist/` on any static host (Netlify, Vercel, GitHub Pages, Nginx).

### Auto-Start Supabase on VM Boot

For VMs with scheduled shutdowns (e.g., Azure), set up auto-start:

```bash
cd supabase-docker
sudo ./setup-autostart.sh
```

See [Supabase README](supabase-docker/README.md) for details.

---

## 🙏 Thank You :)

Special thanks to:

- Health Canada Solutions Fund 💖
- Shared Services Canada Science Cloud ☁️
Hello