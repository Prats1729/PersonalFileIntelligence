# Personal File Intelligence

An intelligent, AI-powered document management system that synchronizes with Google Drive.

## Architectural Decisions (ADR)

During the development of this project, several key architectural decisions were made to balance performance, cost, and developer experience.

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
