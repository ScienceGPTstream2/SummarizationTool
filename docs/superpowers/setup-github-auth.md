# Setup Guide: GitHub Enterprise Cloud Auth with Better Auth

Follow these steps **in order** to get the full auth flow working.

---

## Step 1: Ensure Azure Postgres Firewall Allows Your VM

Check if your dev VM's IP is already allowed. If not, add it:

```bash
# Find your VM's public IP
curl -s ifconfig.me

# Add firewall rule (replace <your-rg> with your resource group)
az postgres flexible-server firewall-rule create \
  --resource-group <your-rg> \
  --name sciencegptsream2pg \
  --rule-name allow-dev-vm \
  --start-ip-address <YOUR_VM_IP> \
  --end-ip-address <YOUR_VM_IP>
```

Or via **Azure Portal**: Navigate to `sciencegptsream2pg` → **Networking** → **+ Add current client IP address**.

---

## Step 2: Create the Database

```bash
psql "host=sciencegptsream2pg.postgres.database.azure.com port=5432 \
  dbname=postgres user=sciencegpt sslmode=require" \
  -c "CREATE DATABASE summarization_tool;"
```

Enter your password when prompted. If the database already exists, this will just error harmlessly.

Verify it was created:
```bash
psql "host=sciencegptsream2pg.postgres.database.azure.com port=5432 \
  dbname=summarization_tool user=sciencegpt sslmode=require" \
  -c "SELECT current_database();"
```

---

## Step 3: Set the DATABASE_URL Environment Variable

Add this to your shell profile (`~/.bashrc` or `~/.zshrc`) AND to `auth-service/.env`:

```bash
export DATABASE_URL="postgresql://sciencegpt:<YOUR_PASSWORD>@sciencegptsream2pg.postgres.database.azure.com:5432/summarization_tool?sslmode=require"
```

Then reload: `source ~/.bashrc`

---

## Step 4: Install Python Dependencies & Run Alembic Migration

```bash
cd backend
pip install sqlalchemy alembic psycopg2-binary
```

Generate and run the initial migration to create all tables:

```bash
cd backend
alembic revision --autogenerate -m "initial_schema"
alembic upgrade head
```

Verify tables were created:
```bash
psql "host=sciencegptsream2pg.postgres.database.azure.com port=5432 \
  dbname=summarization_tool user=sciencegpt sslmode=require" \
  -c "\dt"
```

You should see tables including: `user`, `session`, `account`, `verification`, `app_sessions`, `documents`, `extraction_results`, `evaluation_results`, `groups`, etc.

---

## Step 5: Register a GitHub OAuth App (Enterprise Cloud)

Since you're on **GitHub Enterprise Cloud**, you create the OAuth App at the **organization** level:

1. Go to **https://github.com/organizations/ScienceGPTstream2/settings/applications** (or your org name)
   - Alternative path: GitHub → Your org → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**

2. Fill in:
   | Field | Value |
   |-------|-------|
   | **Application name** | `SummarizationTool` |
   | **Homepage URL** | `http://localhost:5173` (or your production URL) |
   | **Authorization callback URL** | `http://localhost:3001/api/auth/callback/github` |

3. Click **Register application**

4. On the app page:
   - Copy the **Client ID** (looks like `Iv1.abc123...`)
   - Click **Generate a new client secret** → Copy the secret immediately (you won't see it again)

5. **IMPORTANT**: If you want to restrict access to org members only:
   - Go to org **Settings** → **OAuth App policy** → Set to **"Access restricted"**
   - Then approve your new OAuth App from the list

---

## Step 6: Configure the Auth Sidecar

```bash
cd auth-service
cp .env.example .env
```

Edit `auth-service/.env` with your actual values:

```env
# Database
DATABASE_URL=postgresql://sciencegpt:<YOUR_PASSWORD>@sciencegptsream2pg.postgres.database.azure.com:5432/summarization_tool?sslmode=require

# Generate a random secret (run: openssl rand -hex 32)
BETTER_AUTH_SECRET=<paste-your-generated-secret>
BETTER_AUTH_URL=http://localhost:3001

# GitHub OAuth (from Step 5)
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>

# Frontend URL
FRONTEND_URL=http://localhost:5173
```

Generate the secret:
```bash
openssl rand -hex 32
```

---

## Step 7: Install & Start the Auth Sidecar

```bash
cd auth-service
npm install
npm run dev
```

Test it:
```bash
curl http://localhost:3001/health
# Should return: {"status":"ok","service":"better-auth-sidecar"}
```

You should also see in the terminal:
```
✅ Better Auth sidecar running on http://localhost:3001
   Auth endpoints: http://localhost:3001/api/auth/*
   GitHub OAuth: ENABLED
```

---

## Step 8: Configure the Frontend

```bash
# In the project root
cp .env.example .env.local
```

Edit `.env.local`:
```env
VITE_AUTH_URL=http://localhost:3001
VITE_API_BASE_URL=http://localhost:8001
```

Install the better-auth client package:
```bash
npm install better-auth
```

---

## Step 9: Start Everything & Test

Start all three services:

```bash
# Terminal 1: Auth sidecar
cd auth-service && npm run dev

# Terminal 2: FastAPI backend
cd backend && uvicorn main:app --port 8001 --reload

# Terminal 3: Vite frontend
npm run dev
```

Then:
1. Open http://localhost:5173
2. Click **"Continue with GitHub"**
3. You'll be redirected to GitHub to authorize
4. After authorizing, you'll be redirected back to `/auth/callback`
5. The callback page verifies your session and redirects to the main app

---

## Step 10: For Production Deployment

When deploying to production, update these values:

1. **GitHub OAuth App** callback URL → `https://your-domain.com/api/auth/callback/github`
2. **`auth-service/.env`**:
   ```
   BETTER_AUTH_URL=https://your-domain.com
   FRONTEND_URL=https://your-domain.com
   ```
3. **Frontend `.env.production`**:
   ```
   VITE_AUTH_URL=https://your-domain.com
   ```

---

## Troubleshooting

### "GitHub OAuth: DISABLED" in auth service logs
- Your `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` env vars are empty or not set
- Check: `echo $GITHUB_CLIENT_ID`

### 401 Unauthorized on API calls
- The Better Auth sidecar must be running (check http://localhost:3001/health)
- The `session` table must exist in Postgres (run Alembic migration)
- Check browser cookies — you should see `better-auth.session_token`

### "Cannot find module 'better-auth'" errors
- Run `npm install` in both the root project AND `auth-service/`

### CORS errors
- Make sure `FRONTEND_URL` in `auth-service/.env` matches your frontend URL exactly
- For development: `http://localhost:5173` (no trailing slash)

### Database connection refused
- Check firewall rules on the Azure Postgres server
- Verify `DATABASE_URL` is correct: `psql "$DATABASE_URL" -c "SELECT 1;"`
