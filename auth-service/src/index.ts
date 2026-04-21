/**
 * Better Auth Sidecar Service
 *
 * Runs as a standalone Express server on port 3001.
 * Handles authentication (email/password + GitHub Enterprise Cloud).
 * The FastAPI backend validates sessions by querying the same DB.
 */

// Node 18 polyfill: globalThis.crypto is only available from Node 20+
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import "dotenv/config";
import express from "express";
import cors from "cors";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { Pool } from "pg";

// ---------- Shared DB Pool ----------

const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function getAllowedEmails(): Set<string> {
  const raw = process.env.ALLOWED_EMAILS || "";
  if (!raw.trim()) return new Set();
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

// ---------- Better Auth Configuration ----------

// Support comma-separated FRONTEND_URL for multiple trusted origins
// e.g. "https://my-app.azurecontainerapps.io,http://localhost:3000"
const frontendURLs = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",

  // Trust all configured frontend origins (production FQDN + dev port-forward)
  trustedOrigins: frontendURLs,

  database: dbPool,

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,      // refresh every day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 min cache
    },
  },

  // Email & password authentication (always enabled)
  emailAndPassword: {
    enabled: true,
  },

  // Social providers — GitHub (Enterprise Cloud uses standard github.com OAuth)
  socialProviders: {
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },

  // Block session creation for non-allowlisted emails.
  // Empty ALLOWED_EMAILS = allow all (dev mode).
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const allowed = getAllowedEmails();
          if (allowed.size === 0) return;
          const result = await dbPool.query(
            'SELECT email FROM "user" WHERE id = $1',
            [session.userId]
          );
          const email = (result.rows[0]?.email as string | undefined)?.toLowerCase();
          if (!email || !allowed.has(email)) {
            console.log(`[Allowlist] Blocked session for userId=${session.userId} email=${email}`);
            return false;
          }
        },
      },
    },
  },
});

// ---------- Express Server ----------

const app = express();

app.use(
  cors({
    origin: frontendURLs,
    credentials: true,
  })
);

// Allowlist enforcement: intercept get-session before Better Auth handles it.
// This is the call the frontend makes on every page load to check auth state.
// Returning 403 causes authUtils._fetchSession() to return null → user treated as logged out.
app.get("/api/auth/get-session", async (req, res, next) => {
  const allowed = getAllowedEmails();
  if (allowed.size === 0) return next();
  try {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user?.email) return next();
    if (!allowed.has(session.user.email.toLowerCase())) {
      console.log(`[Allowlist] Blocked get-session for ${session.user.email}`);
      return res.status(403).json({ error: "Access denied: email not authorized" });
    }
  } catch (err) {
    console.error("[Allowlist] Error in get-session check:", err);
  }
  return next();
});

// Mount Better Auth handler at /api/auth/*
app.all("/api/auth/*", toNodeHandler(auth));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "better-auth-sidecar" });
});

// Internal endpoint: validate session token (called by FastAPI)
app.get("/api/auth/validate", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers as any,
    });
    if (session) {
      res.json({ valid: true, user: session.user, session: session.session });
    } else {
      res.status(401).json({ valid: false });
    }
  } catch (err) {
    res.status(401).json({ valid: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3001;
console.log(`[Allowlist] ALLOWED_EMAILS at startup: "${process.env.ALLOWED_EMAILS || "(empty — allow all)"}"`);
app.listen(PORT, () => {
  console.log(`✅ Better Auth sidecar running on http://localhost:${PORT}`);
  console.log(`   Auth endpoints: http://localhost:${PORT}/api/auth/*`);
  console.log(
    `   GitHub OAuth: ${process.env.GITHUB_CLIENT_ID ? "ENABLED" : "DISABLED (no credentials)"}`
  );
});
