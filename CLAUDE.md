# CLAUDE.md — OutletBooking (Booking & Appointment SaaS)

Read this file, `docs/PRD.md` (requirements), `docs/SCHEMA.md` + `docs/schema.sql` (database) and `docs/PLAN.md` (build steps) at the start of every session. Work on ONE task from the plan per session, then update the progress checkboxes in `docs/PLAN.md`.

## Project overview
Multi-tenant booking & appointment SaaS for Malaysian SMEs.
- **Owner** sets up services, staff/resources, working hours; sees calendar, payments, reports.
- **Staff** sees own schedule, checks customers in, marks bookings done.
- **Customer** books through a public web booking page (`/book/[slug]`) via link or QR — no app download needed.

The design is niche-agnostic: anything bookable is a **resource** (`resource_type`: staff | bay | court | room | property | other).
Pilot niches: **real estate viewing, vehicle inspection, sports booking**. Niche differences are handled by templates, custom booking fields (JSONB), duration options and service location type — never by separate code paths per niche.

## Architecture (portable Postgres — IMPORTANT)
```
Expo app (Android / iOS / web)  ──HTTPS──>  API server (Hono, Node.js)  ──>  PostgreSQL
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
- **Notifications:** Expo push (sent from API via Expo Push API); WhatsApp click-to-chat links (Cloud API later).
- **Hosting later:** API on Railway/Render; web booking page on Vercel; DB on Supabase (Singapore).
- **Build/release:** EAS Build, EAS Submit, EAS Update.

## Folder structure
```
apps/
  mobile/              Expo app
    app/(auth)/        login, signup, forgot-password
    app/(owner)/       calendar, bookings, services, resources, reports, settings
    app/(staff)/       today, schedule, profile
    app/book/[slug]/   public web booking flow (no login)
    features/<name>/   api.ts (calls API), hooks.ts, components/
  api/
    src/routes/        one file per resource (auth, businesses, services, bookings, public, payments...)
    src/middleware/    auth session, tenant scoping, rate limit, error handler
    src/services/      business logic (availability, pricing, payments)
    src/jobs/          pg-boss workers
packages/
  db/                  drizzle schema, migrations/, seed.ts, client
  shared/              zod schemas + TS types shared by app and API
docker-compose.yml     postgres:16, pgadmin (optional), minio
docs/                  PRD.md, PLAN.md, decisions
```

## Local development
- `docker compose up -d` starts Postgres on `localhost:5432` (user `outlet`, password `outlet`, db `outletbooking`) and MinIO.
- pgAdmin connects to `localhost:5432` with the same credentials.
- API runs on `http://localhost:3000`. When testing on a real phone, the app uses the laptop LAN IP (e.g. `http://192.168.x.x:3000`).
- Env vars in `.env` files (never committed); provide `.env.example`:
  - API: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TOYYIBPAY_BASE_URL`, `TOYYIBPAY_SECRET_KEY`, `TOYYIBPAY_CATEGORY_CODE`, `S3_*`, `APP_PUBLIC_URL`
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

## Coding rules
- TypeScript strict; no `any`. Shared zod schemas live in `packages/shared` and are used by both API validation and app forms.
- Data access only in API `services/` + Drizzle; app calls the API only through `features/*/api.ts`.
- Every screen handles loading, empty and error states.
- Phone numbers in E.164 (`+60...`), validated with zod.
- UI strings centralised for Bahasa Malaysia later.
- Vitest tests for: availability/slot logic, pricing (peak/off-peak, duration options, deposits), tenant isolation, payment callback.

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
