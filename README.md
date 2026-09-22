# 💬 Join Us

A modern, blue, buttery-smooth real-time chat MVP — with user accounts, admin
control, live presence and a **Supabase**-backed database (plus a zero-setup
demo mode).

![stack](https://img.shields.io/badge/stack-Node%20%C2%B7%20Express%20%C2%B7%20Socket.IO%20%C2%B7%20Supabase-2563eb)

---

## ✨ Features

- **User accounts** — register & sign in with username + password
  (bcrypt-hashed, JWT sessions). The first account on a fresh server becomes
  the **admin**.
- **Real-time chat** — instant messaging over Socket.IO with message
  grouping, typing indicators, join/leave presence and auto-reconnect.
- **Admin control** — a built-in admin panel to:
  - 👥 view all members (online/offline, roles)
  - 🔨 ban / unban users (banned users are kicked live & blocked at login)
  - 🗑️ delete any message (members can delete their own)
  - 🧹 clear the whole lobby
  - 📣 broadcast announcements to everyone
- **Blue modern design** — glassmorphism, ambient orbs, spring-smooth
  micro-animations, fully responsive (desktop → mobile drawer).
- **Supabase integration** — flip one config switch and users + messages
  persist in your own Supabase Postgres.

## 🚀 Quick start (demo mode — no setup)

```bash
npm install
npm start
# → http://localhost:3000
```

Demo accounts are seeded automatically on first run:

| Username | Password   | Role          |
| -------- | ---------- | ------------- |
| `admin`  | `admin123` | administrator |
| `alice`  | `alice123` | member        |
| `bob`    | `bob123`   | member        |

Data lives in `data/db.json` (git-ignored). Delete it to reset.
Set `SEED_DEMO=false` to disable seeding.

## 🔵 Connecting Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run the contents of [`supabase/schema.sql`](supabase/schema.sql)
   (creates `profiles` + `messages` tables with RLS locked down).
3. In **Settings → API**, copy the **Project URL** and the **`service_role`**
   key (keep it secret — server side only).
4. Configure the environment:

   ```bash
   cp .env.example .env
   # then fill in:
   # SUPABASE_URL=https://<project>.supabase.co
   # SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
   # JWT_SECRET=<long random string>
   ```

5. `npm start` — the server logs `🔵 Connected to Supabase` when it worked.
   If the keys/schema are wrong it falls back to demo mode and tells you why.

> Auth is handled by the Join Us server itself (username/password + bcrypt +
> JWT), so no Supabase Auth configuration is needed. The server uses the
> `service_role` key, which bypasses RLS; never expose it in the browser.

## 🧪 Tests

With the server running:

```bash
node test/smoke.mjs   # 20 end-to-end checks: auth, messaging, permissions, bans
```

## 🗂️ Project structure

```
├── server/
│   ├── index.js          Express + Socket.IO server, REST API, real-time events
│   ├── auth.js           JWT, password/username validation, avatar palette
│   └── db/
│       ├── index.js      Picks Supabase or demo store automatically
│       ├── supabase.js   Supabase adapter (profiles + messages tables)
│       └── demo.js       Local JSON store + demo seeding
├── public/               The whole frontend (no build step)
│   ├── index.html
│   ├── css/style.css     The blue design system
│   ├── js/app.js         Client app: auth, chat, presence, admin panel
│   └── assets/hero.png   Generated hero art
├── supabase/schema.sql   Tables + indexes + RLS
├── test/smoke.mjs        End-to-end smoke test
└── .env.example          All configuration knobs
```

## ⚙️ Environment variables

| Variable                  | Default                | Purpose                                   |
| ------------------------- | ---------------------- | ----------------------------------------- |
| `PORT`                    | `3000`                 | HTTP port                                 |
| `JWT_SECRET`              | dev value              | **Change in production!** Signs sessions  |
| `SUPABASE_URL`            | —                      | Your Supabase project URL                 |
| `SUPABASE_SERVICE_ROLE_KEY` | —                    | Service key (server only)                 |
| `SEED_DEMO`               | `true`                 | Seed demo accounts in demo mode           |

## 🛡️ MVP notes & next steps

This is intentionally a lean MVP. Natural next steps: multiple rooms/DMs,
Supabase Auth (or OAuth) instead of server-side passwords, message pagination
& reactions, file/image sharing, and rate limiting per IP in addition to the
per-socket limit already in place.
