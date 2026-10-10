# Personal File Intelligence

An intelligent, AI-powered document workspace and management system with Google Drive integration, multi-engine OCR/chat (Gemini, OpenRouter), and PostgreSQL persistence.

---

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, Lucide Icons, React Hot Toast
- **Backend**: Node.js, Express 5, Pino Logger, Helmet, Express Rate Limit
- **Database**: PostgreSQL (Neon serverless or local Docker) with `pg` connection pool
- **Storage & Auth**: Google Drive API v3 (OAuth2), JWT session in httpOnly sameSite cookies
- **AI & Document Processing**: Local `pdf-parse`, OpenRouter (`gpt-4o-mini` + vision), Google Gemini failover cascade
- **DevOps**: Docker, Docker Compose, GitHub Actions CI

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Node.js 20+
- PostgreSQL instance (or Neon DB account)
- Google Cloud OAuth 2.0 Credentials (with Drive scopes)
- Gemini API Key and/or OpenRouter API Key

### 2. Backend Setup
```bash
cd server
cp .env.example .env
# Edit .env with your credentials
npm install
npm run migrate      # Runs idempotent migrations 001 through 005
npm test             # Runs validation test suite
npm run dev          # Starts Express server on http://localhost:5000
```

### 3. Frontend Setup
```bash
cd client
npm install
npm run dev          # Starts Vite dev server on http://localhost:5173
```

---

## 🐳 Docker Deployment

Run the complete multi-tier application (Postgres + Server + Client) locally:

```bash
# Provide Google and AI keys in environment or .env
docker compose up --build
```
- **Client**: `http://localhost:80`
- **Server**: `http://localhost:5000`
- **Postgres**: `localhost:5432`

---

## ⚙️ Environment Variables

### Server (`server/.env`)

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment (`development` or `production`) | `development` |
| `PORT` | HTTP Server port | `5000` |
| `CLIENT_URL` | Allowed CORS origin (React app) | `http://localhost:5173` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `JWT_SECRET` | Secret key for JWT cookies (min 32 chars) | `your-secure-secret-key-at-least-32-chars` |
| `GOOGLE_CLIENT_ID` | Google OAuth2 Client ID | `your-id.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET`| Google OAuth2 Client Secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | Google OAuth2 Redirect URI | `http://localhost:5000/api/auth/google/callback` |
| `GEMINI_API_KEY` | Google Gemini API key (optional fallback) | `AIzaSy...` |
| `OPENROUTER_API_KEY` | OpenRouter API key (optional) | `sk-or-v1-...` |
| `LOG_LEVEL` | Pino logging level (`trace`, `debug`, `info`, `warn`, `error`) | `info` |

---

## 🔒 Security Hardening

- **HTTP Security**: Helmet HTTP headers (CSP, HSTS, frameguard, noSniff) configured with CORS origin isolation and preflight handling.
- **Rate Limiting**: Multi-tiered rate limiters for General API (100 req/15m), AI Chat (20 req/m), Uploads (10 req/m), Auth (10 req/15m), and Settings (20 req/m).
- **Upload Guards**: Multer `fileFilter` validating MIME types, filename traversal sanitization (`path.basename`), 25-file batch caps, 25MB individual file caps, and deep magic-number byte signature checks (PDF, PNG, JPEG, WEBP, DOCX).
- **Logging & Redaction**: Structured JSON logging using Pino with automatic redaction of `token`, `apiKey`, `password`, `google_refresh_token`, and memory `buffer` payloads.
- **Fail-Fast Configuration**: Strict validation on startup (`env.js`) preventing booted servers with missing database or auth secrets.

---

## 🩺 Health & Readiness Probes

- `GET /healthz`: Basic liveness check returning `200 OK` `{ "status": "ok" }`.
- `GET /readyz`: Readiness check verifying active database pool connectivity (`SELECT 1`). Returns `503 Service Unavailable` if database connection drops.

---

## 📊 Database Migrations

Migrations are stored under `server/src/db/migrations/` and managed via `server/src/db/migrate.js`.
Applied migrations are recorded in the `schema_migrations` table for idempotency.

```bash
cd server
npm run migrate
```

Migrations included:
- `001_initial_schema.sql`: Users, files, chats, messages tables.
- `002_add_google_tokens.sql`: OAuth token columns and tokens table.
- `003_add_folders.sql`: AI folder classification columns.
- `004_add_favorites.sql`: Favorite status toggle column.
- `005_indexes_and_optimizations.sql`: Composite performance indexes for file queries, folder grouping, chat history, and favorites.

---

## 🧠 Architectural Decisions (ADR)

### 1. State Management: Derived State vs. Duplicate State
* **Context**: When implementing the multi-select feature, we initially had two state variables: `selectedFile` (for a single click) and `selectedIds` (for `Ctrl+Click` bulk selection).
* **Problem**: This created a "Conflicting State" bug where the UI would highlight multiple files, but the Batch Action Bar would only register one. 
* **Decision**: We completely removed `selectedFile` from the React state. Instead, we used a **Derived Variable** that calculates the `selectedFile` on the fly if `selectedIds.length === 1`. 
* **Result**: A single source of truth for all selections, eliminating synchronization bugs between normal clicks and batch selections.

### 2. Google Drive Synchronization: Push Webhooks vs. Background Polling (Cron)
* **Context**: We needed a way to update the application's PostgreSQL database if a user deleted a file directly in Google Drive.
* **Option A (Push Webhooks)**: Use Google Drive Push Notifications to ping an Express endpoint when a file is deleted. 
  * *Drawback*: Google requires the webhook endpoint domain to be verified in Google Search Console. Because the project is intended to be deployed on a free cloud tier (which uses unverified shared domains like `.onrender.com`) and zero budget was allocated for a custom domain, verification is impossible in production.
* **Option B (Background Polling)**: Implement a Node.js Cron Job that runs on a schedule (e.g., every 5 minutes), fetches all database records, and queries the Drive API to ensure they still exist, deleting any missing records.
* **Decision**: We chose **Option B (Background Polling)**.
* **Result**: The system remains 100% free to host, requires no complex domain verification or local tunneling (like `ngrok`), and is highly resilient to missed network events.
