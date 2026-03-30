/**
 * Better Auth Sidecar Service
 * 
 * Runs as a standalone Express server on port 3001.
 * Handles authentication (email/password + Microsoft Entra).
 * The FastAPI backend validates sessions by querying the same DB.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { betterAuth } from "better-auth";
import { Pool } from "pg";

// ---------- Better Auth Configuration ----------

const auth = betterAuth({
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

  // Social providers — Microsoft Entra
  // Uncomment when you have app registration credentials
  socialProviders: {
    ...(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET
      ? {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            tenantId: process.env.MICROSOFT_TENANT_ID || "common",
          },
        }
      : {}),
  },
});

// ---------- Express Server ----------

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
  })
);

// Mount Better Auth handler at /api/auth/*
app.all("/api/auth/*", (req, res) => {
  // Better Auth expects a standard Web Request
  return auth.handler(req, res);
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
    `   Microsoft Entra: ${process.env.MICROSOFT_CLIENT_ID ? "ENABLED" : "DISABLED (no credentials)"}`
  );
});
