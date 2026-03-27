# Stock Intelligence Platform

This is the Next.js app for the Stock Intelligence system. It integrates:

- Next.js frontend and API routes
- Supabase local stack (database + edge functions)
- Inngest background workflow runner

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop (required by Supabase local)
- Supabase CLI
- Inngest CLI

## Install Dependencies

```bash
npm install
```

## Environment

1. Copy `.env.example` to `.env.local`.
2. Fill required keys (Supabase, model providers, market/news APIs).

At minimum for local orchestration/chat you will need:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MISTRAL_API_KEY`

For local Inngest event publishing from Next.js route:

- `INNGEST_DEV_URL=http://127.0.0.1:8288`
- `INNGEST_DEV_EVENT_KEY=local` (optional; defaults to `local`)

## Run Locally (Current Order)

Start the system in this order using 3 terminals.

### 1) Start Next.js first

```bash
npm run dev
```

App runs at `http://localhost:3000`.

### 2) Start Supabase local stack

```bash
npx supabase start
```

This starts local Postgres, Studio, and Edge Functions runtime.

### 3) Start Inngest last

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

This connects Inngest dev server to your local Next.js route.

## Quick Smoke Test

1. Open `http://localhost:3000`.
2. Search for a ticker (example: `AAPL`).
3. Confirm analysis starts (loading state), then tabs populate when cache row updates.
4. Open Chat tab and send a prompt to verify SSE streaming.

## Useful Commands

```bash
# Stop Supabase local stack
npx supabase stop

# Check lints
npm run lint
```
