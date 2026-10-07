# OutletBooking — Start prompt for Claude Code

Paste the "Prompt" section below into Claude Code, run from the project root:
`C:\Users\fadhil.zainal\Desktop\Tutorial Programming\OutletBooking`

Before you start, extract this zip into that folder so it contains:
```
CLAUDE.md
START-PROMPT.md
docs/PRD.md
docs/PLAN.md
docs/SCHEMA.md
docs/schema.sql
docs/wireframes/*.dc.html   (74 screens + 5 flow maps Flow-1…5 from the design canvas)
docs/wireframes/README.md   (screen IDs, descriptions, build phase)
```

---

## Prompt

You are building **OutletBooking**, a multi-tenant booking & appointment SaaS for Malaysian SMEs. I am the founder (FTech IT Consulting). I develop on **Windows**.

### 1. Read first
Read these files before doing anything, and follow them strictly:
- `CLAUDE.md` — architecture, stack, database rules, coding rules (these override defaults)
- `docs/PRD.md` — requirements (FR IDs, business rules, decisions in section 15)
- `docs/SCHEMA.md` + `docs/schema.sql` — database design (32 tables, validated on PostgreSQL 16; migrate only what each phase needs)
- `docs/PLAN.md` — phased build plan with checkboxes
- `docs/wireframes/README.md` + the flow maps — the approved UI and navigation (see section 4)

### 2. Decisions already made (do not change without asking)
| Topic | Decision |
|---|---|
| Product | OutletBooking — generic engine for any niche; anything bookable is a **resource** |
| Pilot niches | Real estate viewing, vehicle inspection, sports court booking — handled by templates, custom booking fields (JSONB), duration options, location type; **never** separate code per niche |
| Platforms | Mobile-first **Expo** app (Android first, iOS later) for owner & staff; customer books on a **web page** `/book/[slug]` (same Expo codebase, web export) — no app download |
| Architecture | Expo app → **Hono API (Node.js)** → **PostgreSQL**. The app never talks to the DB directly |
| Database | **Local-first plain PostgreSQL 16 in Docker** (pgAdmin connects to `localhost:5432`). Later, **Supabase is used only as managed Postgres** for staging/production — only `DATABASE_URL` changes. No Supabase-only features |
| ORM / migrations | Drizzle ORM + drizzle-kit, migrations in Git |
| Keys | **Integer** PKs (`GENERATED ALWAYS AS IDENTITY`) and integer FKs; composite FKs `(business_id, x_id)` for tenant safety. Integer IDs never appear in public URLs — use `businesses.slug`, `bookings.public_token`, ToyyibPay `bill_code` |
| Auth | **Better Auth** (email/password), configured for numeric IDs and snake_case tables (`users`, `sessions`, `accounts`, `verifications`). Check current Better Auth docs for the numeric-ID option. Same login for owner and staff; route by role |
| Tenant isolation | In the API: middleware resolves `business_id` + role from `business_members`; every query filters by it; test that business A cannot read business B |
| Double booking | Postgres `btree_gist` exclusion constraint on `bookings` (see schema.sql) |
| Money / time | Integer sen, MYR; `timestamptz` UTC, business logic in Asia/Kuala_Lumpur |
| Payments | **ToyyibPay** (FPX / DuitNow), sandbox `dev.toyyibpay.com`; callback must re-check bill status via ToyyibPay API |
| Who gets paid | Each business connects its **own ToyyibPay account** (screen H1); key stored encrypted (AES-256-GCM, `APP_ENCRYPTION_KEY`). Plan payments go to FTech's account on the website |
| Manual payments | Owner/staff can record cash, DuitNow QR, card, bank transfer (`can_take_payments`); refunds are recorded, paid outside the app |
| Template-driven screens | Sign-up step 3, Setup tab and customer booking steps are **one screen each driven by the business-type config**, not one screen per niche |
| Website & admin | `apps/web` (Next.js, Phase 7): marketing site, plan payment page, platform admin with audit log |
| PDPA | Consent at sign-up; customer erase = anonymise, keep booking history |
| Trial | **7-day free trial**, no permanent free plan; business subscription paid on website, not in-app |
| Jobs | pg-boss (reminders, pending-payment expiry, trial expiry) |
| Files | S3-compatible: MinIO locally (Docker) |
| Staff permissions | Staff **see prices, payment status, deposit and balance due**, and can record balance payment (cash / DuitNow QR / card) |
| Bookings list | Searchable by **customer name** (partial match), filters All / Upcoming / Unpaid / Past |
| Domain | `outletbooking.my` proposed, not registered yet — keep it configurable (`APP_PUBLIC_URL`) |

### 3. Tech stack
pnpm monorepo: `apps/mobile` (Expo + Expo Router + TypeScript strict + NativeWind + TanStack Query + react-hook-form + zod), `apps/api` (Hono + zod + Better Auth + Drizzle + pg-boss), `packages/db` (Drizzle schema, migrations, seed), `packages/shared` (zod schemas + types). Vitest for tests. date-fns + date-fns-tz.

### 4. UI — follow the wireframes
`docs/wireframes/*.dc.html` are the approved mid-fidelity screens (390×844 phone frames; some are taller because they scroll). Open them to read layout, copy and hierarchy; rebuild them as React Native components (they are HTML references, not code to copy). `docs/wireframes/README.md` lists every screen with its ID and build phase. **Start with the flow maps** (`Flow-1-Account` … `Flow-5-Staff`) to plan Expo Router routes.

Design tokens (use one theme file; NativeWind config):
| Token | Value |
|---|---|
| Primary | `#0F7B55` (pressed `#0A5C40`) |
| Primary tint | `#DDF3E8`, soft surface `#F0F7F3` |
| Background | `#F6F7F5`; card `#FFFFFF`; border `#E1E6E2`; input border `#CBD3CE` |
| Text | `#16211C`; muted `#56625B`; label `#33403A` |
| Status | confirmed `#DDF3E8`/`#0B5E40`, pending `#FDEBD3`/`#8A4A06`, neutral `#E9ECEA`/`#46524B`, info `#E0ECFB`/`#1D4F91` |
| Font | Manrope (400–800) via expo-google-fonts |
| Radius | cards 14, buttons/inputs 10–12, chips full |
| Sizes | primary button height 52, inputs 46–50, touch targets ≥ 44 |

Owner tab bar: Today · Calendar · Bookings · Setup · Reports. Staff tab bar: Today · Schedule · Profile.

### 5. What to build in THIS session: Phase 1 only (see docs/PLAN.md)
1. Check my machine first: `node -v`, `pnpm -v`, `docker --version`, `git --version`. Tell me what is missing and how to install it on Windows before continuing.
2. `git init`, `.gitignore`, pnpm workspace, root scripts (`db:generate`, `db:migrate`, `db:seed`, `test`, `dev`).
3. `docker-compose.yml`: postgres:16 (user/password `outlet`, db `outletbooking`, port 5432, named volume) + MinIO.
4. `packages/db`: Drizzle schema matching `docs/schema.sql` for Phase 1 tables — extensions, `set_updated_at` trigger, Better Auth tables, `businesses`, `business_members`, `subscriptions` (and `push_tokens`). Generate migration; hand-written SQL in a custom migration. Seed one demo business ("Smash Arena PJ", template `sports`, label "Court").
5. `apps/api` (Hono, port 3000): health route, error handler, CORS, Better Auth mounted (numeric IDs), tenant + role middleware, `POST` sign-up flow that creates user + business + owner membership + 7-day trial subscription **in one transaction**, `GET /me` returning user, business, role, trial status. `.env.example`.
6. Vitest: tenant isolation test (user A cannot read business B), sign-up transaction test.
7. `apps/mobile`: Expo Router with `(auth)`, `(owner)`, `(staff)` groups, theme tokens, Manrope font, secure session storage, role-based redirect. Screens from wireframes:
   - **O0 Login** (`Owner-Login.dc.html`)
   - **Sign-up in 3 steps:**
     - **1/3 Account** (`Owner-Signup-Account.dc.html`) — full name, email, +60 mobile, password (min 8), Terms + PDPA consent
     - **2/3 Business** (`Owner-Signup.dc.html`) — business name, slug with availability check, template grid (Real estate viewing, Vehicle inspection, Sports courts, Workshop, Barber/Salon, Other), 7-day trial note. Account + business + owner membership + trial are created in one API transaction when step 2 is submitted
     - **3/3 Courts & hours** (`Owner-Signup-Setup.dc.html`) — build the screen now with template defaults; "Skip for now" goes to Today. Saving resources/services/hours needs Phase 2 tables, so wire "Finish" in Phase 2
   - **D8 First-time Today** (`Owner-TodayEmpty.dc.html`) — setup checklist; **O2 Today** (`Owner-Today.dc.html`) — real trial countdown from API; KPI tiles and "Up next" can show empty states until Phase 3
   - **E1 Forgot password / E2 Set new password** (`Owner-Forgot.dc.html`, `Owner-Reset.dc.html`)
   - **H6 My account** (`Owner-Account.dc.html`, opened from the avatar on Setup) — at least log out and change password
   - Owner tab bar with placeholder screens for the other tabs; staff tab group with a placeholder Today
   - Every screen handles loading, empty and error states
8. Update `docs/PLAN.md` checkboxes and suggest a git commit message.

**Done when:** I run `docker compose up -d`, `pnpm db:migrate`, `pnpm --filter api dev`, `pnpm --filter mobile start`, sign up on my Android phone via Expo Go (API reached through my laptop LAN IP), land on the Today screen with "Free trial · 7 days left", and see the rows in pgAdmin.

### 6. How to work with me
- Before coding: explain the plan and the files you will touch, then wait for my OK.
- Build step by step; run tests; stop and show me when a step works.
- Never run anything against a remote/production database.
- Ask me when something is unclear instead of guessing.
- At the end: list what to run, what to test on my phone, and the commit message.

---

## Next sessions
Use: *"Read CLAUDE.md, docs/PRD.md, docs/SCHEMA.md, docs/PLAN.md and docs/wireframes/README.md. Continue with the next unchecked phase. Build the screens listed for that phase from docs/wireframes and follow the flow maps."*
