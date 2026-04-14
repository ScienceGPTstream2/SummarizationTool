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

// ---------- Better Auth Configuration ----------

// Support comma-separated FRONTEND_URL for multiple trusted origins
// e.g. "https://my-app.azurecontainerapps.io,http://localhost:3000"
const frontendURLs = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const primaryFrontendURL = frontendURLs[0];

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",

  // Trust all configured frontend origins (production FQDN + dev port-forward)
  trustedOrigins: frontendURLs,

  database: new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }),

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
});

// ---------- Express Server ----------

const app = express();

app.use(
  cors({
    origin: frontendURLs,
    credentials: true,
  })
);

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
app.listen(PORT, () => {
  console.log(`✅ Better Auth sidecar running on http://localhost:${PORT}`);
  console.log(`   Auth endpoints: http://localhost:${PORT}/api/auth/*`);
  console.log(
    `   GitHub OAuth: ${process.env.GITHUB_CLIENT_ID ? "ENABLED" : "DISABLED (no credentials)"}`
  );
});
