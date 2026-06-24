# LocalSync Docs: Developer Guide

A local-first collaborative document editor built with Next.js, TailwindCSS, Drizzle ORM (PostgreSQL), and Dexie.js (IndexedDB).

## 1. Quick Start

### Setup Environment
Create a `.env.local` file:
```env
DATABASE_URL=postgresql://neondb_owner:password@ep-cool-snowflake-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
NEXTAUTH_SECRET=your_32_character_nextauth_secret_key
NEXTAUTH_URL=http://localhost:3000

# Pusher Channels for WebSockets
PUSHER_APP_ID=your_pusher_app_id
NEXT_PUBLIC_PUSHER_KEY=your_pusher_key
PUSHER_SECRET=your_pusher_secret
NEXT_PUBLIC_PUSHER_CLUSTER=your_pusher_cluster

# Optional (falls back to mock AI if empty)
GROQ_API_KEY=your_groq_api_key
```

### Sync Database Schema
```bash
npx drizzle-kit push
```

### Run Dev Server
```bash
npm run dev
```

---

## 2. Project Architecture

The app uses a **Split-Schema (Local-First)** architecture:
- **Client Cache:** [Dexie.js](file:///Users/mac/Desktop/HOUSE_OF_EDTECH/house-of-ed-tech-assigment-ARYAN-MANIK/lib/dexie/db.ts) (IndexedDB). All editor writes go here immediately.
- **Server DB:** [Drizzle ORM + PostgreSQL](file:///Users/mac/Desktop/HOUSE_OF_EDTECH/house-of-ed-tech-assigment-ARYAN-MANIK/lib/db/schema.ts). Holds the server consensus copy.
- **Sync Hook:** [useSync](file:///Users/mac/Desktop/HOUSE_OF_EDTECH/house-of-ed-tech-assigment-ARYAN-MANIK/hooks/use-sync.ts) triggers sync calls to `POST /api/sync` on reconnection, periodically, or on a 400ms typing debounce.

### Conflict Resolution (Last Write Wins)
Defined in [conflict-resolver.ts](file:///Users/mac/Desktop/HOUSE_OF_EDTECH/house-of-ed-tech-assigment-ARYAN-MANIK/lib/sync/conflict-resolver.ts):
1. **Version Code:** Higher version number always wins.
2. **Timestamp:** If versions are equal, the newer timestamp wins.
3. **Client ID:** If versions and timestamps are equal, alphabetical order of client IDs breaks the tie.

---

## 3. Directory Structure & Key Files

- `/app` - Pages, layout, and API handlers.
  - `(auth)` - Login & register routes.
  - `(dashboard)/dashboard/DashboardClient.tsx` - Document list & creation dashboard.
  - `documents/[id]/page.tsx` - Main workspace editor container.
  - `api/sync/route.ts` - Server-side sync endpoint.
- `/components/editor/EditorWorkspace.tsx` - Main editor layout, AI drawer, and members sidebar.
- `/hooks`
  - `use-sync.ts` - Sync engine managing IndexedDB <=> Server sync.
  - `use-online-status.ts` - Realtime network online/offline checker.
- `/lib`
  - `permissions/index.ts` - Document access control checks.
  - `ai/groq.ts` - LLM assistant logic.

---

## 4. Key Flows & Rules

### Document Actions
- **Online Creation:** Creates document on the server first, caches in Dexie, then routes to workspace.
- **Offline Creation:** Generates a random UUID, saves to Dexie immediately, logs a pending sync operation, and syncs automatically when online.
- **Deletion:** Server-side deleted via `DELETE /api/documents/[id]`. Requires online status and owner role. Upon success, clears Dexie caches.

### Permission Roles
- **Owner:** Full access. Can edit, invite collaborators, change roles, delete documents, and restore history snapshots.
- **Editor:** Can edit content and save history snapshots.
- **Viewer:** Read-only access. Editor inputs are disabled.

### AI Integration
- Powered by **Llama 3.1** on Groq (falls back to mock descriptions if `GROQ_API_KEY` is not provided).
- Provides summarization, writing improvements, title generation, and sync change analysis.
