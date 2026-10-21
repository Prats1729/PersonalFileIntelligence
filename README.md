# Personal File Intelligence

An intelligent, AI-powered document workspace and knowledge engine with Google Drive integration, multi-engine OCR/chat (Gemini, OpenRouter), enterprise-grade security hardening, and PostgreSQL persistence.

---

<!-- Homepage Showcase Screenshot Placeholder -->
<p align="center">
  <img src="docs/assets/homepage-preview.png" alt="Personal File Intelligence Dashboard Preview" width="100%" style="border-radius: 10px; border: 1px solid #334155; box-shadow: 0 8px 30px rgba(0,0,0,0.35);" onerror="this.onerror=null; this.src='https://placehold.co/1280x720/0f172a/38bdf8?text=Place+Homepage+Screenshot+at+docs/assets/homepage-preview.png';" />
</p>
<p align="center">
  <em>💡 Drop your full-resolution application screenshot at <code>docs/assets/homepage-preview.png</code> to showcase the workspace above.</em>
</p>

---

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS v4, Lucide Icons, React Hot Toast
- **Backend**: Node.js, Express 5, Pino Logger, Helmet, Express Rate Limit
- **Database**: PostgreSQL (Neon serverless or local Docker) with `pg` connection pool
- **Storage & Auth**: Google Drive API v3 (OAuth2), JWT session in httpOnly sameSite cookies, state-parameter CSRF protection
- **Cryptography**: AES-256-GCM + RFC 5869 HKDF-SHA256 key derivation with key versioning
- **AI & Document Processing**: Local `pdf-parse`, OpenRouter (`gpt-4o-mini` + vision), Google Gemini failover cascade with exponential backoff & jitter
- **DevOps & QA**: Docker, Docker Compose, GitHub Actions CI, isolated sandbox database test runner

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- Node.js 20+
- PostgreSQL database (Neon or local PostgreSQL instance)
- Google Cloud OAuth 2.0 Credentials (with Drive scopes)
- Gemini API Key and/or OpenRouter API Key

### 2. Backend Setup
```bash
cd server
cp .env.example .env
# Edit .env with your credentials and random 32-character secrets
npm install
npm run migrate      # Runs idempotent migrations 001 through 008
npm test             # Runs automated test suite in an isolated test schema
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
- **Client**: `http://localhost:80` (runs unprivileged as `nginx` non-root user)
- **Server**: `http://localhost:5000` (runs as `appuser` non-root user)
- **Postgres**: `localhost:5432`

---

## ⚙️ Environment Variables

### Server Configuration (`server/.env`)

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment (`development` or `production`) | `development` |
| `PORT` | HTTP Server port | `5000` |
| `CLIENT_URL` | Allowed CORS origin (React app) | `http://localhost:5173` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `SESSION_SECRET` | Secret key for JWT session cookie signing (min 32 chars) | `32-byte-random-hex-string` |
| `GOOGLE_CLIENT_ID` | Google OAuth2 Client ID | `your-id.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET`| Google OAuth2 Client Secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | Google OAuth2 Redirect URI | `http://localhost:5000/api/auth/google/callback` |
| `ENCRYPTION_MASTER_KEY` | Master secret for BYOK key derivation via HKDF (min 32 chars) | `32-byte-random-hex-string` |
| `DAILY_FREE_AI_QUOTA` | Max free AI calls/day when using server key fallback | `30` |
| `GEMINI_API_KEY` | Google Gemini API key (optional server fallback) | `AIzaSy...` |
| `OPENROUTER_API_KEY` | OpenRouter API key (optional server fallback) | `sk-or-v1-...` |
| `LOG_LEVEL` | Pino logging level (`trace`, `debug`, `info`, `warn`, `error`) | `info` |
| `TRUST_PROXY` | Trust reverse proxy (set true behind Nginx / Docker / Cloudflare) | `true` |

---

## 🔑 Bring Your Own Key (BYOK) & Quota Policy

Personal File Intelligence supports self-hosted and user-provided AI models:
- **AES-256-GCM + HKDF-SHA256 Encryption at Rest**: User keys (OpenRouter, Gemini) are encrypted with a random 96-bit IV and 128-bit authentication tag before storage in the `user_api_keys` table. Keys are derived using RFC 5869 HKDF-SHA256. Plaintext keys are never stored, logged, or sent back to the browser (only masked previews like `sk-or-••••••••7890` are exposed).
- **Atomic Quota Enforcement**: If a user hasn't configured a personal key, the server falls back to server environment keys. Fallback usage is atomically checked and incremented in PostgreSQL (`DAILY_FREE_AI_QUOTA`, default 30 calls/day). Multi-file bulk operations are properly accounted for, and concurrent requests cannot bypass the quota limit.
- **Unlimited Usage with BYOK**: Users who save verified personal API keys bypass server quota limits entirely for unlimited chat and OCR calls.
- **Pre-Flight Key Connection Testing**: Users can validate their keys live against upstream AI endpoints (`POST /api/settings/keys/test`) before committing them to encrypted storage. Error messages from upstream providers are sanitized to prevent secret reflection.

---

## 🔒 Security Architecture & Hardening

- **OAuth CSRF State Defense (SEC-01)**: Cryptographic 32-byte hex state parameter verified on Google OAuth callback via a short-lived, httpOnly `SameSite=Lax` cookie.
- **HTTP Method & CSRF Protection (SEC-02)**: Mutating actions (e.g. logout) require POST requests rather than GET to eliminate browser prefetching and cross-site execution attacks.
- **IDOR Protection & Ownership Enforcement (SEC-03)**: All chat updates and file OCR operations enforce strict `WHERE user_id = $1` database constraints.
- **Prompt Injection Quarantine (SEC-09)**: Extracted document contents are completely segregated from the `system` role prompt and framed within `<academic_sources>` in the user role with strict instruction boundaries.
- **Document Ingestion DOS Protection (SEC-07)**: Local `pdf-parse` execution is bounded by a 10-second timeout race promise and a 50,000-character payload cap to neutralize compression and CPU starvation bombs.
- **Drive Token Concurrency Mutex (SEC-08)**: Google OAuth2 client instances are cached per refresh token, preventing concurrent access token refresh storms under parallel uploads.
- **JWT Algorithm Confusion Prevention (SEC-11)**: Token verification explicitly restricts acceptable algorithms to `HS256`.
- **Upload Guards**: Multer file filter enforcing MIME types, filename path-traversal sanitization (`path.basename`), 25-file batch caps, 25MB individual file caps, and deep magic-number byte signature validation (PDF, PNG, JPEG, WEBP, DOCX).
- **Rate Limiting**: Multi-tiered rate limiters for General API (100 req/15m), AI Chat (20 req/m), Uploads (10 req/m), Auth (10 req/15m), and Settings (20 req/m).
- **Fail-Fast Configuration**: Strict startup validation (`env.js`) aborting boot if critical secrets are missing or weak in production.

---

## 📊 Database Migrations

Migrations are stored under `server/src/db/migrations/` and tracked in the `schema_migrations` ledger:

```bash
cd server
npm run migrate
```

| Migration | Description |
|---|---|
| `001_init.sql` | Core schema (users, files, context notes). |
| `002_chats.sql` | Chat sessions and message history tables. |
| `003_add_folders.sql` | Folders and categorization metadata. |
| `004_add_is_favorite.sql` | Starred and favorited document status. |
| `005_indexes_and_optimizations.sql` | Multi-column performance indexes on `user_id`, `folder_id`, and timestamps. |
| `006_user_api_keys_and_quotas.sql` | BYOK encrypted credentials and daily usage counters. |
| `007_add_extracted_text_and_status.sql` | Document extracted text persistence and OCR status tracking. |
| `008_byok_key_version.sql` | Key version metadata column supporting cryptographic rotation. |

---

## 🧪 Testing & QA Test Isolation

The test suite runs with complete database isolation against a dedicated sandbox schema (`test_sandbox`), ensuring zero impact on live user data:

```bash
# Run server integration and unit test suite
cd server
npm test

# Run frontend build and linter checks
cd client
npm run lint
npm run build

# Run dependency security audits
npm audit --audit-level=high
```

---

## 🧠 Architectural Decisions (ADR)

### ADR-01: Derived State vs. Duplicate State in Frontend Selection
* **Problem**: Storing both `selectedFile` (single click) and `selectedIds` (batch click) created state synchronization conflicts.
* **Decision**: Eliminated `selectedFile` state. `selectedFile` is now derived on-the-fly (`selectedFiles[0]`).
* **Result**: Single source of truth across all selection modes.

### ADR-02: Google Drive Synchronization: Background Polling vs. Webhooks
* **Problem**: Drive push webhooks require domain ownership verification in Google Search Console, making them unusable on free shared cloud tiers (Render, Railway).
* **Decision**: Implemented a Node.js cron job that verifies remote Drive IDs against the PostgreSQL database.
* **Result**: Free hosting compatibility with zero external tunneling dependencies.

### ADR-03: BYOK Cryptographic Key Derivation (RFC 5869 HKDF-SHA256)
* **Problem**: Single-pass SHA-256 derivation lacks cryptographic salt and domain separation.
* **Decision**: Upgraded master key derivation to RFC 5869 HKDF-SHA256 with static salt, context info tag (`pfi-byok-aes-256-gcm`), and added `key_version` metadata.
* **Result**: Cryptographically standard key derivation with seamless migration and key rotation support.

### ADR-04: Atomic Quota Reservation & Batch Accounting
* **Problem**: Read-then-update quota checks were vulnerable to parallel race conditions and multi-file batch upload bypasses.
* **Decision**: Implemented atomic PostgreSQL conditional upserts (`INSERT ... SELECT ... ON CONFLICT DO UPDATE WHERE ...`).
* **Result**: Atomic limit enforcement under high concurrency with multi-file batch accounting.

### ADR-05: Zero-Pollution Database Test Isolation via Dynamic Schema Routing
* **Problem**: Running integration tests against live development databases risked corrupting real user files and credentials.
* **Decision**: Built a sandbox test harness (`test_sandbox`) with connection pool dynamic schema routing (`setActiveSchema('test_sandbox')`).
* **Result**: Real PostgreSQL queries execute against isolated sandbox tables without mocking, protecting production data.

### ADR-06: Prompt Injection Defense via Structural Boundary Isolation
* **Problem**: Injecting untrusted document text directly into the LLM `system` prompt allowed documents to override system directives.
* **Decision**: Segregated `system` instructions from untrusted document data, placing documents exclusively within the `user` role enclosed in `<academic_sources>` security tags.
* **Result**: Prevents untrusted document content from hijacking system role instructions.

### ADR-07: Google Drive In-Flight Client Caching & Token Concurrency Mutex
* **Problem**: Parallel file downloads recreated OAuth2 clients on every call, causing simultaneous token refresh requests to Google.
* **Decision**: Cached authenticated clients by refresh token, allowing `google-auth-library` to share active access tokens.
* **Result**: Eliminates token refresh storms and avoids Google OAuth rate limits.

### ADR-08: Defense-in-Depth Document Extraction Sandboxing
* **Problem**: Malicious or pathological PDFs could trigger unbounded CPU loops or memory denial-of-service in `pdf-parse`.
* **Decision**: Wrapped digital text extraction in a 10-second timeout race promise, combined with a 50,000-character payload cap.
* **Result**: The event loop remains responsive even when handling malformed or pathological files.
