# CLAUDE.md — OutletBooking (Booking & Appointment SaaS)

Read this file, `docs/PRD.md` (requirements), `docs/SCHEMA.md` + `docs/schema.sql` (database), `docs/PLAN.md` (build steps) and `docs/wireframes/README.md` (screens, IDs and flow maps) at the start of every session. Work on ONE task from the plan per session, then update the progress checkboxes in `docs/PLAN.md`.

## Project overview
Multi-tenant booking & appointment SaaS for Malaysian SMEs.
- **Owner** sets up services, staff/resources, working hours; sees calendar, payments, reports.
- **Staff** sees own schedule, checks customers in, marks bookings done.
- **Customer** books through a public web booking page (`/book/[slug]`) via link or QR — no app download needed.
- **FTech (platform admin)** manages businesses and trials in a desktop admin panel; the marketing website and plan payment page live next to it.

The design is niche-agnostic: anything bookable is a **resource** (`resource_type`: staff | bay | court | room | property | other).
Pilot niches: **real estate viewing, vehicle inspection, sports booking**. Niche differences are handled by templates, custom booking fields (JSONB), duration options and service location type — never by separate code paths per niche.
Screens that change by business type (sign-up step 3, Setup tab, customer booking steps) are **one screen driven by the template config** in `packages/shared/templates`, not one screen per niche.

## Architecture (portable Postgres — IMPORTANT)
```
Expo app (Android / iOS / web)  ─┐
apps/web (Next.js: website,       ├─HTTPS──>  API server (Hono, Node.js)  ──>  PostgreSQL
  plan payment, platform admin)  ─┘
```
- The app **never talks to the database directly**. All data goes through the API.
- The database is **plain PostgreSQL**. Local: Docker. Later staging/production: **Supabase used as a managed Postgres host** — only `DATABASE_URL` changes.
- Do **not** use Supabase-only features (`auth.uid()`, `auth.users`, Supabase JS client for data, Edge Functions, Supabase Auth). Everything must run on plain Postgres 16.
- Allowed extensions (available on both plain Postgres and Supabase): `btree_gist`, `citext`, `pgcrypto`.

## Tech stack
- **Monorepo:** pnpm workspaces.
- **App:** Expo (latest SDK) + Expo Router + TypeScript strict; NativeWind; TanStack Query; react-hook-form + zod.
- **API:** Node.js + **Hono** + TypeScript, zod validation on every route.
- **Database:** PostgreSQL 16; **Drizzle ORM** + **drizzle-kit** SQL migrations.
- **Auth:** **Better Auth** (email/password, sessions stored in our Postgres; `@better-auth/expo` for the app).
- **Background jobs:** **pg-boss** (Postgres-based queue) for reminders, pending-booking expiry, trial expiry.
- **File storage:** S3-compatible API. Local: MinIO (Docker). Later: Supabase Storage (S3 endpoint) or Cloudflare R2.
- **Dates:** date-fns + date-fns-tz. **Tests:** Vitest.
- **Payments:** ToyyibPay (FPX/DuitNow) handled in the API. Sandbox: dev.toyyibpay.com. Always re-check bill status with the ToyyibPay API in the callback before marking paid.
  - **Booking payments use the business's OWN ToyyibPay account** (`payment_accounts`): money goes straight to the business; OutletBooking never holds customer money.
  - **Plan payments** (website) use **FTech's** ToyyibPay account (`purpose = 'subscription'`).
- **Website & admin (Phase 7):** `apps/web` with Next.js — marketing site, plan payment page, platform admin. Same Hono API.
- **Notifications:** Expo push (sent from API via Expo Push API); WhatsApp click-to-chat links (Cloud API later).
- **Hosting later:** API on Railway/Render; web booking page and `apps/web` on Vercel; DB on Supabase (Singapore).
- **Build/release:** EAS Build, EAS Submit, EAS Update.

## Folder structure
```
apps/
  mobile/              Expo app
    app/(auth)/        login, signup (3 steps), forgot/reset password, accept invite
    app/(owner)/       tabs: today, calendar, bookings, setup, reports + stack screens (booking detail, new booking, payments, ...)
    app/(staff)/       tabs: today, schedule, profile
    app/book/[slug]/   public web booking flow (no login)
    features/<name>/   api.ts (calls API), hooks.ts, components/
  web/                 Next.js (Phase 7): marketing site, plan payment, /admin (platform admin)
  api/
    src/routes/        one file per resource (auth, businesses, services, bookings, public, payments...)
    src/middleware/    auth session, tenant scoping, rate limit, error handler
    src/services/      business logic (availability, pricing, payments, crypto for secrets)
    src/jobs/          pg-boss workers
packages/
  db/                  drizzle schema, migrations/, seed.ts, client
  shared/              zod schemas + TS types + templates/ (business-type config) shared by app, web and API
docker-compose.yml     postgres:16, pgadmin (optional), minio
docs/                  PRD.md, PLAN.md, SCHEMA.md, schema.sql, wireframes/ (74 screens + 5 flow maps)
```

## Local development
- `docker compose up -d` starts Postgres on `localhost:5432` (user `outlet`, password `outlet`, db `outletbooking`) and MinIO.
- pgAdmin connects to `localhost:5432` with the same credentials.
- API runs on `http://localhost:3000`. When testing on a real phone, the app uses the laptop LAN IP (e.g. `http://192.168.x.x:3000`).
- Env vars in `.env` files (never committed); provide `.env.example`:
  - API: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ENCRYPTION_KEY` (32-byte key for business ToyyibPay secrets), `TOYYIBPAY_BASE_URL`, `PLATFORM_TOYYIBPAY_SECRET_KEY` + `PLATFORM_TOYYIBPAY_CATEGORY_CODE` (FTech account, plan payments only), `S3_*`, `APP_PUBLIC_URL`
  - Business ToyyibPay keys are **not** env vars — owners enter them in the app (screen H1) and they are stored encrypted in `payment_accounts`.
  - App: `EXPO_PUBLIC_API_URL` only. No secrets in the app.

## Database rules (MUST follow)
1. **All schema changes go through Drizzle migrations** (`pnpm db:generate` → review SQL → `pnpm db:migrate`). Never edit schema by hand in pgAdmin. Hand-written SQL (constraints, functions) goes in a custom migration file.
2. **Never run migrations or SQL against staging/production** unless the user explicitly asks in that message.
3. **Schema source of truth:** `docs/schema.sql` + `docs/SCHEMA.md`. Every tenant table has `business_id integer not null` referencing `businesses(id)` with an index. Child tables use composite FKs `(business_id, x_id)` as in `schema.sql`.
4. **Tenant isolation in the API:** every authenticated route resolves the user's `business_id` + role from `business_members` in middleware, and every query filters by that `business_id`. Never trust a `business_id` sent by the client. Write a test proving user A cannot read business B.
5. Role checks (owner vs staff) in middleware; staff only see their linked resources unless allowed.
6. Public booking routes (`/public/*`) expose only what the booking page needs, are rate-limited, and never return other customers' data.
7. **Prevent double booking in the database**: `btree_gist` exclusion constraint on `bookings` — same `resource_id` with overlapping `tstzrange(start_at, end_at)` where status not in (cancelled, no_show). Create bookings inside a transaction and map the constraint error to a friendly "slot taken" response.
8. Store times as `timestamptz` (UTC). Business logic and display in **Asia/Kuala_Lumpur**. Working hours as local `time` + `weekday`.
9. Money as **integer sen** (`*_sen`), currency MYR. Never float.
10. **Primary keys: `integer GENERATED ALWAYS AS IDENTITY`. Foreign keys: `integer`.** Configure Better Auth for numeric IDs (check current Better Auth docs for the option). Integer IDs are never exposed in public URLs — use `businesses.slug`, `bookings.public_token` and ToyyibPay `bill_code`. Authenticated routes return 404 for IDs outside the user's business. Every table has `created_at`, `updated_at`.
11. Soft-delete (`deleted_at`) for services, resources, customers.
12. Keep SQL portable: no Supabase-specific schemas, roles or functions.
13. **Secrets:** encrypt `payment_accounts.secret_key_encrypted` with AES-256-GCM (`APP_ENCRYPTION_KEY`) before saving; never return it in any response or log; show only `secret_key_last4`.
14. **Permissions** from `business_members`: `can_view_all`, `can_take_payments` (record manual payments), `can_edit_setup` (services, prices, hours). Check them in middleware, not only in the UI.
15. **Every booking status change writes `booking_events`** (created, paid, checked_in, completed, cancelled, refunded…) in the same transaction.
16. **PDPA erase** = anonymise the customer (name → "Deleted customer", phone/email/notes → NULL, `anonymized_at`), keep bookings and payments for reports.
17. **Platform admin** routes require a row in `platform_admins`; every change writes `admin_audit_log` (with a reason) in the same transaction. Admins never see ToyyibPay keys or customer payment details.
18. Migrate only the tables a phase needs. `docs/schema.sql` section 7 (listings, inspection checklist) needs the user's go-ahead first.

## Coding rules
- TypeScript strict; no `any`. Shared zod schemas live in `packages/shared` and are used by both API validation and app forms.
- Data access only in API `services/` + Drizzle; app calls the API only through `features/*/api.ts`.
- Every screen handles loading, empty and error states.
- Phone numbers in E.164 (`+60...`), validated with zod.
- UI strings centralised for Bahasa Malaysia later.
- Vitest tests for: availability/slot logic, pricing (peak/off-peak, duration options, deposits), tenant isolation, permissions, payment callback (per-business key), secret encryption round-trip.

## UI rules
- Rebuild screens from `docs/wireframes/*.dc.html` (HTML references, not code to copy); routes follow the five flow maps (`Flow-1…5`).
- Use the screen IDs (O2, H1, D4…) in commit messages and PLAN checkboxes.
- Design tokens: primary `#0F7B55`, background `#F6F7F5`, text `#16211C`, muted `#56625B`, Manrope font, touch targets ≥ 44 px (full table in `START-PROMPT.md`).

## How to work
- Before coding: briefly explain the plan and files you will touch.
- One feature at a time; stop when it works and is tested.
- After a feature works: run tests, update `docs/PLAN.md` checkboxes, suggest a git commit message.
- If a requirement is unclear, ask instead of guessing.

## Useful commands
```
docker compose up -d            # start Postgres + MinIO
pnpm db:generate                # create migration from drizzle schema
pnpm db:migrate                 # apply migrations to DATABASE_URL
pnpm db:seed                    # seed demo data
pnpm --filter api dev           # API on :3000
pnpm --filter mobile start      # Expo
pnpm test
eas build --profile preview --platform android
```

## Moving to Supabase later (only when the user asks)
1. Create Supabase project (Singapore). Use it as Postgres only.
2. Migrations: `DATABASE_URL` = Session pooler (port 5432) → `pnpm db:migrate`.
3. API runtime: Transaction pooler (port 6543) with `prepare: false` in the postgres driver, or Session pooler.
4. Enable `btree_gist`, `citext` in Supabase dashboard → Extensions if not already.
5. pgAdmin: Session pooler host, user `postgres.<project-ref>`, SSL `require`.
