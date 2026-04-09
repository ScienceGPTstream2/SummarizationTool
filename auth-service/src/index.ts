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

const frontendURL = process.env.FRONTEND_URL || "http://localhost:3000";

const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001",

  // Trust the frontend origin (browser sends Origin: http://localhost:3000
  // but sidecar runs on :3001, so we must explicitly allow the frontend)
  trustedOrigins: [frontendURL],

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
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Mount Better Auth handler at /api/auth/*
// Wrap in try-catch to prevent state mismatch errors from crashing the service
app.all("/api/auth/*", (req, res) => {
  const handler = toNodeHandler(auth);
  try {
    const result = handler(req, res);
    // Handle promise rejection (async errors like state mismatch)
    if (result && typeof (result as any).catch === "function") {
      (result as any).catch((err: any) => {
        console.error("[BetterAuth] Handler error:", err?.message || err);
        if (!res.headersSent) {
          // Redirect to frontend login on OAuth errors instead of hanging
          res.redirect(`${frontendURL}/?auth_error=${encodeURIComponent(err?.message || "auth_failed")}`);
        }
      });
    }
  } catch (err: any) {
    console.error("[BetterAuth] Sync handler error:", err?.message || err);
    if (!res.headersSent) {
      res.redirect(`${frontendURL}/?auth_error=${encodeURIComponent(err?.message || "auth_failed")}`);
    }
  }
});

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
