# Architectural & Security Decisions (DECISIONS.md)

This document tracks all self-approved architectural decisions, alternatives considered, and trade-offs made during autonomous hardening phases.

---

## ⚠️ Needs Human Review
*(Items requiring human review upon waking)*

1. **OAuth State Cookie in Multi-Domain Environments:**  
   OAuth state is stored in a temporary 10-minute httpOnly cookie (`oauth_state`) with `SameSite=Lax`. If production uses separate domains for API and Frontend (e.g. `api.domain.com` vs `app.domain.com`), ensure `cookie.domain` or proxy routing aligns.
2. **BYOK Master Key Rotation Policy:**  
   Added `key_version` (default: 1) and HKDF-SHA256 key derivation. When rotating `ENCRYPTION_MASTER_KEY`, a future re-encryption migration script should iterate through `user_api_keys` with `key_version = 1` and upgrade to version 2.
3. **Daily Free Quota Reset Window:**  
   Quota resets at 00:00 UTC using PostgreSQL `CURRENT_DATE`. For global users, local timezone resets may differ slightly.
4. **PDF Per-Page Thresholds & Slide/Index Pages:**  
   `PDF_MIN_PAGE_CHARS` defaults to 100 substantive letters. Pure scanner noise (`-- 1 of 585 --`) and single-line headers produce <40 characters and route to vision OCR, while real academic prose easily exceeds 150+. If users frequently upload lecture slide PDFs with sparse notes (<100 characters) that they prefer not to run OCR on, verify if `PDF_MIN_PAGE_CHARS=60` is preferred in specific environments.
5. **PDF Page Cap in Free Tier:**  
   `MAX_OCR_PAGES_PER_FILE` defaults to 150 pages. Large 500+ page books are OCR'd up to page 150, marked `partial`, and explain to the user in `ocr_note` that the rest was skipped to preserve quota. Free tier users are charged exactly 1 quota unit for the entire document run regardless of page count. Users with their own BYOK key bypass quota entirely.

---

## 📋 Self-Approved Decisions

### DEC-01: Autonomously Proceed Through Phases 3, 4, and 5
- **Decision:** Execute Phase 3 (Security Audit), Phase 4 (QA Testing), and Phase 5 (Fixes) stacked across git branches `phase-3-audit`, `phase-4-qa`, and `phase-5-fixes`.
- **Alternatives Considered:** Stop at each phase for user approval.
- **Rationale:** User explicitly instructed autonomous execution under `/goal` with complete pre-approval.

### DEC-02: Isolated Test Database Strategy
- **Decision:** Prevent running tests or migrations with test data against the live Neon database. Use a dedicated test schema or local test database (`personal_file_intelligence_test`) for all integration and QA tests.
- **Alternatives Considered:** Run tests directly against live database using transactions with rollback.
- **Rationale:** Strict mandate: zero risk to live user data or Google Drive integration tokens.

### DEC-03: HKDF-SHA256 Key Derivation for BYOK Crypto (SEC-04)
- **Decision:** Replace single-pass `crypto.createHash('sha256')` with RFC 5869 compliant `crypto.hkdfSync('sha256', masterKey, salt, info, 32)` and introduce `key_version` metadata.
- **Alternatives Considered:** PBKDF2 with 100,000 iterations.
- **Rationale:** Master key is high-entropy (min 32 chars). HKDF is significantly faster and standard for deriving AES-256-GCM symmetric keys from high-entropy master secrets without the CPU overhead of password-based KDFs.

### DEC-04: Atomic Free Quota Check and Batch Accounting (SEC-05)
- **Decision:** Use an atomic PostgreSQL query with a conditional `CASE` update:
  `UPDATE user_daily_usage SET ai_call_count = CASE WHEN ai_call_count + $increment <= $limit THEN ai_call_count + $increment ELSE ai_call_count END` to enforce atomic limits and charge appropriate quota for multi-file uploads.
- **Alternatives Considered:** In-memory Redis sliding window; application-level locking.
- **Rationale:** In-memory counters fail on multi-instance horizontal scale. PostgreSQL atomic row updates prevent race conditions and eliminate extra infrastructure.

### DEC-05: OAuth State Parameter Implementation (SEC-01)
- **Decision:** Generate a cryptographically secure 32-byte hex state parameter before redirecting to Google OAuth, stored in a short-lived (10-minute) `oauth_state` httpOnly cookie, and validated upon callback.
- **Alternatives Considered:** Storing state in memory (Map/Redis); omitting state.
- **Rationale:** Completely eliminates OAuth Login CSRF (RFC 6749 Section 10.12) with zero external state stores.

### DEC-06: PDF Parsing Page Limits & Timeout Wrapper (SEC-07)
- **Decision:** Enforce a 30-page cap on `PDFParse` and wrap text extraction in a 10-second `AbortSignal` / timeout race promise.
- **Alternatives Considered:** External microservice sandbox for document parsing.
- **Rationale:** Defends against compression bombs and ReDoS/CPU starvation without complex external infrastructure.

### DEC-07: Untrusted Document Framing in AI Prompts (SEC-09)
- **Decision:** Move extracted file contents out of the `system` role prompt and place it exclusively in the `user` message wrapped within `<academic_sources>` tags, with clear instructions that source text must be treated as passive data.
- **Alternatives Considered:** Complex regex sanitization of all document text.
- **Rationale:** System prompt containment preserves instruction hierarchy and prevents documents from overriding system directives.

### DEC-08: Per-User Mutex for Google Drive Token Refreshes (SEC-08)
- **Decision:** Implement an in-flight promise cache / client cache per refresh token so concurrent file operations share active access tokens.
- **Alternatives Considered:** Periodic cron-only token refresh.
- **Rationale:** Completely prevents token refresh storms and Google API 429 / revocation errors when uploading batches of documents.

### DEC-09: Explicit HS256 Algorithm Constraint on JWT Verification (SEC-11)
- **Decision:** Add explicit `{ algorithms: ['HS256'] }` constraint to `jwt.verify()` in `authMiddleware.js`.
- **Alternatives Considered:** Rely on default jsonwebtoken behavior.
- **Rationale:** Eliminates cryptographic algorithm confusion attacks (e.g. `none` algorithm token spoofing).

### DEC-10: Dynamic Test Sandbox Schema Routing in Pool
- **Decision:** Introduce `setActiveSchema(schemaName)` in `server/src/db/index.js` and wire test harness to execute inside `test_sandbox`.
- **Alternatives Considered:** Running local Postgres in Docker on Windows or mocking pg pool.
- **Rationale:** Provides 100% database test isolation without external local Docker setup dependencies, protecting live data and user tokens.

### DEC-11: Jittered Backoff & Hard Text Caps on AI Calls
- **Decision:** Add full randomized jitter (0-500ms) to exponential retry backoff, 45-second client timeouts, and hard 40,000-character payload bounding.
- **Alternatives Considered:** Unlimited request payloads; static retry delays.
- **Rationale:** Prevents thundering herds on rate limits and guards against denial-of-service / runaway token billing.

### DEC-13: Per-Page PDF Hybrid Processing & Classification (Phase 7)
- **Decision:** Classify each PDF page individually rather than whole-document. Strip boilerplate pagination (`-- 1 of 585 --`, `Page N of M`, bare digits) before measuring. Pages with >= `PDF_MIN_PAGE_CHARS` (100) clean characters and healthy letter/word ratios take the local text extraction fast path (0 AI calls). Sparse or corrupt text layers get full Vision OCR. Clean pages with significant image paint operators (`paintImageXObject`, etc.) keep extracted text and append `[Figure/Page N visual: ...]` descriptions.
- **Alternatives Considered:** Whole-document fallback to OCR; discarding digital text when figures exist.
- **Rationale:** Most academic and technical PDFs are mixed. Keeps digital PDFs instantaneous and free, while capturing charts, diagrams, and scanned portions without redundant API costs.

### DEC-14: Concurrency Safety & Stale Job Recovery for OCR Workers
- **Decision:** Claim pending PDF OCR jobs atomically using PostgreSQL `FOR UPDATE SKIP LOCKED`, record `ocr_started_at`, and periodically reset stale processing jobs older than `OCR_STALE_TIMEOUT_MINUTES` (5 mins) back to `pending`.
- **Alternatives Considered:** Redis BullMQ queue; advisory locks.
- **Rationale:** Eliminates external Redis dependency. PostgreSQL SKIP LOCKED ensures concurrent workers never duplicate work, and crash restarts cleanly resume from the exact last state without losing files.

### DEC-15: Content-Hash Scoped Caching & Quota Model
- **Decision:** Calculate SHA-256 hash of PDF buffer. Cache page records and extracted text scoped strictly by `user_id`. Charge exactly 1 daily quota unit per document vision run for free tier users regardless of page count; BYOK users bypass quota completely.
- **Alternatives Considered:** Global multi-user content hash cache; charging 1 quota unit per page.
- **Rationale:** Scoping cache by `user_id` preserves strict multi-tenant privacy. Charging per document protects free tier users from having their entire quota drained by a single multi-page reading assignment.

