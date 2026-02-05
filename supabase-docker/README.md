# Self-Hosted Supabase for Summarization Tool

This directory contains the Docker Compose setup for self-hosted Supabase, providing authentication, database, and REST API services for the Summarization Tool.

## Quick Start

### 1. First-Time Setup

```bash
# Navigate to this directory
cd supabase-docker

# Copy the example environment file (if not already done)
cp .env.example .env

# Start all Supabase services
docker compose up -d
```

### 2. Verify Services Are Running

```bash
docker compose ps
```

All services should show as "running" or "healthy".

### 3. Access Supabase

| Service | URL | Description |
|---------|-----|-------------|
| Kong API Gateway | http://localhost:8000 | Main API endpoint (REST, Auth) |
| Supabase Studio | http://localhost:8000/project/default | Database management UI |

---

## Service Architecture

```
Port 8000 (Kong Gateway)
├── /rest/v1/*     → PostgREST (Database REST API)
├── /auth/v1/*     → GoTrue (Authentication)
├── /storage/v1/*  → Storage API
├── /realtime/v1/* → Realtime subscriptions
└── /project/*     → Supabase Studio UI
```

**Key Services:**

| Service | Purpose |
|---------|---------|
| **Kong** | API gateway, routes all requests on port 8000 |
| **Auth (GoTrue)** | JWT authentication, OAuth providers (GitHub) |
| **PostgREST** | Automatic REST API from PostgreSQL schema |
| **PostgreSQL** | Main database for users, sessions, documents |
| **Studio** | Web UI for database management |

---

## Common Commands

```bash
# Start services (detached mode)
docker compose up -d

# Stop services
docker compose down

# View logs (all services)
docker compose logs -f

# View logs (specific service)
docker compose logs -f db        # PostgreSQL
docker compose logs -f auth      # Authentication
docker compose logs -f rest      # PostgREST

# Restart a specific service
docker compose restart auth

# Pull latest images
docker compose pull

# Reset everything (WARNING: deletes all data)
./reset.sh
```

---

## Auto-Start on VM Boot

For VMs with scheduled shutdowns (e.g., Azure auto-shutdown), set up a systemd service:

```bash
# Run the setup script
sudo ./setup-autostart.sh

# Check status
sudo systemctl status supabase.service

# Useful commands
sudo systemctl start supabase.service    # Start
sudo systemctl stop supabase.service     # Stop
sudo systemctl restart supabase.service  # Restart
sudo journalctl -u supabase.service      # View logs
```

---

## Database Schema

The application uses the following tables (defined in `volumes/db/init/data.sql`):

```sql
-- Users (managed by Supabase Auth)
auth.users

-- Application tables (public schema)
public.sessions        -- User sessions with extraction configs
public.documents       -- Uploaded documents linked to sessions
public.extraction_results  -- LLM extraction results per document
```

---

## Configuration

### Environment Variables

Key variables in `.env`:

```bash
# API Configuration
KONG_HTTP_PORT=8000              # Main API port
API_EXTERNAL_URL=http://localhost:8000

# Database
POSTGRES_PASSWORD=your-super-secret-and-long-postgres-password

# JWT Secrets (generate with: openssl rand -base64 32)
JWT_SECRET=your-super-secret-jwt-token-with-at-least-32-characters
ANON_KEY=eyJ...                  # Public anon key
SERVICE_ROLE_KEY=eyJ...          # Service role key (keep secret!)

# OAuth (GitHub)
GOTRUE_EXTERNAL_GITHUB_ENABLED=true
GOTRUE_EXTERNAL_GITHUB_CLIENT_ID=your-github-client-id
GOTRUE_EXTERNAL_GITHUB_SECRET=your-github-client-secret
```

### Backend Integration

The FastAPI backend connects to Supabase via environment variables in `backend/core/secrets.toml`:

```toml
[supabase]
url = "http://localhost:8000"
jwt_secret = "your-super-secret-jwt-token..."
service_role_key = "eyJ..."
```

---

## Updating Supabase

1. Review [CHANGELOG.md](./CHANGELOG.md) for breaking changes
2. Check [versions.md](./versions.md) for new image versions
3. Backup your database:
   ```bash
   docker compose exec db pg_dump -U postgres > backup.sql
   ```
4. Pull and restart:
   ```bash
   docker compose pull
   docker compose down
   docker compose up -d
   ```

---

## Troubleshooting

### Services won't start

```bash
# Check Docker is running
docker info

# Check for port conflicts
sudo lsof -i :8000

# View detailed logs
docker compose logs -f
```

### Database connection issues

```bash
# Check PostgreSQL is healthy
docker compose exec db pg_isready

# Connect to database directly
docker compose exec db psql -U postgres
```

### Auth not working

1. Verify JWT secrets match between `.env` and `backend/core/secrets.toml`
2. Check GoTrue logs: `docker compose logs -f auth`
3. Ensure `API_EXTERNAL_URL` matches your actual URL

### Reset everything

```bash
# WARNING: This deletes all data!
./reset.sh
```

---

## Security Notes

⚠️ **Before deploying to production:**

- Generate new secrets: `./utils/generate-keys.sh`
- Change default passwords in `.env`
- Use HTTPS in production (configure reverse proxy)
- Restrict network access (firewall rules)
- Set up regular database backups

---

## More Resources

- [Supabase Self-Hosting Docs](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase GitHub Discussions](https://github.com/orgs/supabase/discussions)
- [Kong Gateway Docs](https://docs.konghq.com/)

## License

Apache 2.0 License. See the main [Supabase repository](https://github.com/supabase/supabase) for details.
