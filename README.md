# IPTV Playlist Manager (Local Edition)

A local-only IPTV playlist manager for desktop use (Mac/Windows/Linux). Runs entirely on your machine with a local SQLite database—no Vercel, no Aiven, no external authentication. A single built-in admin user is injected automatically.

## What Changed vs Previous Cloud Setup

- 🔌 **No Vercel / serverless**: Standard Express server runs locally.
- 🗄️ **Local DB**: SQLite file (`dev.db`) instead of Aiven/PostgreSQL.
- 🔐 **No auth/2FA**: App always runs as a single local admin user.
- 🧭 **No session store dependency**: In-memory session with default admin injected per request.

## Tech Stack

- Backend: Node.js, Express, TypeScript, Prisma (SQLite)
- Frontend: React, TypeScript, Vite
- Database: SQLite file on disk (`dev.db`)

## Prerequisites

- Node.js 18+ and npm: https://nodejs.org/en/download
- Git: https://git-scm.com/install

## Quick Start (Mac/Windows/Linux)

1. **Clone & enter the project**

   ```bash
   git clone <repository-url>
   cd playlists
   ```

2. **Install dependencies (backend & frontend)**

   ```bash
   npm run setup
   ```

3. **Create your local env file**

   ```bash
   cat > .env <<'ENV'
   DATABASE_URL="file:./dev.db"
   PORT=3000
   SESSION_SECRET="local-dev-secret"
   NODE_ENV=development
   ENV
   ```

4. **Generate Prisma client & sync schema to SQLite**

   ```bash
   npx prisma generate
   npx prisma db push   # creates dev.db with the schema
   ```

5. **Run the app (backend + frontend)**

   ```bash
   npm run dev
   ```

   - Backend: http://localhost:3000
   - Frontend: http://localhost:5173

6. **Build for production (optional)**
   ```bash
   npm run build    # builds server + client
   npm start        # serves built assets via Express
   ```

## Default User (local-only)

- Automatically injected on every request: `admin@localhost` (role: ADMIN)
- No login, logout, or 2FA flows are required or available.

## Notes on Database & Migrations

- The schema now targets **SQLite** (`provider = "sqlite"`).
- Use `npx prisma db push` to sync the schema to your local `dev.db` file.
- Existing PostgreSQL migrations remain in the repo for reference but are not used in local mode.

## Scripts

- `npm run dev` — run backend (port 3000) and frontend (port 5173)
- `npm run build` — build server + client
- `npm start` — run built server (serves API and client)
- `npm run prisma:generate` — generate Prisma client
- `npx prisma db push` — sync schema to SQLite (creates/updates `dev.db`)

## Current Scope

- Playlist sync/import, channel filtering, EPG import, and JSON mapping all run locally.
- Authentication, multi-user, and 2FA are disabled.

## Troubleshooting

- **SQLite file missing**: run `npx prisma db push`.
- **Port in use**: set `PORT` in `.env` to another value.
- **Type errors after install**: run `npm run prisma:generate`.

Enjoy! 🎉
