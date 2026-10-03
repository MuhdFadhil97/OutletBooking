# Build Plan — OutletBooking (Mobile, Local-first Postgres)

**Goal:** MVP in ~8 weeks (part-time), launched on Google Play with pilot businesses.
**Approach:** Expo app + Hono API + plain PostgreSQL in Docker locally. Supabase is added later as the managed Postgres host for staging/production — only the connection string changes.
**Niche:** generic engine; pilot templates for real estate viewing, vehicle inspection and sports booking.

---

## Phase 0 — Setup (Days 1–3)
- [ ] Install: Node.js LTS, pnpm, Git, Docker Desktop, pgAdmin, VS Code/Cursor, Claude Code, Expo Go on your Android phone
- [ ] Create accounts: GitHub, Expo (EAS), Google Play Console (USD 25 one-time). Supabase, Railway and Apple Developer can wait.
- [ ] Create GitHub repo, add `CLAUDE.md`, `docs/PRD.md`, `docs/PLAN.md`
- [ ] Register domain (outletbooking.my / .com) and ToyyibPay sandbox account (dev.toyyibpay.com)
- [ ] Contact pilot businesses: 1–2 real estate agencies, 1–2 vehicle inspection centres, 1–2 sports centres
- [x] PRD written in `docs/PRD.md` (review the open questions in section 15)

**Done when:** tools installed, repo created, Docker running.

---

## Phase 1 — Foundation (Week 1)
- [x] pnpm monorepo: `apps/mobile`, `apps/api`, `packages/db`, `packages/shared`
- [x] `docker-compose.yml`: postgres:16 (`localhost:5432`), MinIO; connect pgAdmin to local Postgres *(Postgres running in Docker; `minio/minio` image can no longer be pulled from Docker Hub — swap image before file uploads are needed. Start DB with `docker compose up -d postgres`)*
- [x] Drizzle setup mirroring `docs/schema.sql` (integer identity PKs/FKs). Migrations 0000 extensions + `set_updated_at` (custom), 0001 Better Auth tables (numeric IDs) + `businesses`, `business_members`, `subscriptions`, `push_tokens`, 0002 `updated_at` triggers (custom)
- [x] Hono API: health route, error handler, CORS, Better Auth mounted, tenant-scoping + role middleware, `GET /me`
- [x] Sign-up endpoint creates user + business + owner membership + 7-day trial in one transaction (`POST /signup`, `GET /signup/slug-available`)
- [x] Expo app: Expo Router, NativeWind, login/sign-up screens, secure session storage, role-based routing to `(owner)` / `(staff)`; O0 Login, O1 Sign-up, O2 Today (live trial countdown), placeholder tabs
- [x] Seed script with one demo business; Vitest tenant-isolation + sign-up transaction tests (14 passing)
- [x] Verified on a real phone via Expo Go (needs Docker running) *(Expo CLI login on Windows: use `EXPO_TOKEN` access token — browser SSO login crashes)*

**Done when:** you sign up on your phone (Expo Go → API via LAN IP), land in the owner tabs, and see the rows in pgAdmin.

**Prompt:**
> Read CLAUDE.md, docs/PRD.md and docs/PLAN.md. Do Phase 1 only. Set up the pnpm monorepo, docker-compose Postgres, Drizzle with the first migration, the Hono API with Better Auth and tenant middleware, and the Expo app with login/sign-up and role-based routing. Explain the plan and folder structure before coding.

---

## Phase 2 — Business setup (Week 2)
- [x] Migration: `branches`, `resources` (resource_type incl. property), `services` (duration_min, duration_options, price_sen, deposit_sen, prepay_full, buffer_min, travel_buffer_min, location_type), `service_price_rules`, `resource_services`, `working_hours`, `time_off`, `booking_fields` *(Migrations 0003 tables + 0004 `updated_at` triggers (custom); also `staff_invitations` for the invite task. Schema in `packages/db/src/schema/setup.ts`; DB constraint tests in `apps/api/test/setup-schema.test.ts`)*
- [x] Business templates seeded for Real estate, Vehicle inspection, Sports (labels, sample services, custom fields) + generic templates *(Data in `packages/shared/src/templates.ts`; `applyTemplate()` in `packages/db/src/templates.ts` runs inside the sign-up transaction and on first seed. Sample prices are placeholders the owner edits. Viewing/inspection address uses `bookings.location_address` via `location_type`, not a booking field)*
- [ ] API routes (CRUD, tenant-scoped) for profile, services, resources, working hours, time off, booking fields
- [ ] Owner screens for each of the above; custom booking fields editor
- [ ] Invite staff by email → `business_members` + linked resource

**Done when:** owner can fully configure a business from the app.

**Prompt:**
> Read CLAUDE.md, docs/PRD.md and docs/PLAN.md. Do Phase 2. Start with the Drizzle schema and migration, then API routes with zod + tenant scoping and tests, then the owner screens one by one.

---

## Phase 3 — Booking engine + calendar (Week 3)
- [ ] Migration: `customers`, `bookings` (incl. location_address, custom_fields jsonb) + exclusion constraint against double booking
- [ ] `services/availability.ts`: slots for (service, duration option, resource or any, date) respecting working hours, time off, bookings, buffers, advance notice, max days ahead
- [ ] `services/pricing.ts`: duration blocks, peak/off-peak, deposit or full prepayment
- [ ] Vitest: overlaps, breaks, holidays, travel buffer, end-of-day, Malaysia timezone, concurrent booking attempt
- [ ] Owner calendar: day view by resource, week view; create, reschedule, cancel; status flow

**Done when:** two bookings on the same resource and time are impossible, and the calendar is usable daily.

---

## Phase 4 — Public booking page + notifications (Week 4)
- [ ] Public API: `GET /public/:slug`, `GET /public/:slug/slots`, `POST /public/:slug/bookings` (rate-limited, validated)
- [ ] Route `book/[slug]` (Expo web): service → duration → resource/any → date → slot → custom fields → name + phone → confirm
- [ ] Confirmation page: add to calendar, WhatsApp the business, cancel link
- [ ] QR code screen in owner app
- [ ] Expo push to owner/staff on new booking (push tokens stored per user)

**Done when:** a customer books from a phone browser and the owner gets a push notification.

---

## Phase 5 — Payments & jobs (Week 5)
- [ ] `payments` table; `POST /payments/create` → ToyyibPay `createBill` (sandbox) → payment URL (deposit or full prepayment)
- [ ] `POST /payments/toyyibpay/callback` → re-check with `getBillTransactions` → mark paid → booking confirmed (idempotent)
- [ ] For local testing of callbacks, expose the API with a tunnel (e.g. Cloudflare Tunnel / ngrok)
- [ ] pg-boss jobs: expire unpaid pending bookings, staff reminders, "remind tomorrow's customers" list
- [ ] Walk-in quick add

**Done when:** a sandbox payment automatically confirms the booking.

---

## Phase 6 — Niche features, reports, trial (Week 6)
- [ ] Real estate: viewing address with Waze / Google Maps link; travel buffer
- [ ] Vehicle inspection: result notes + photos (MinIO locally, S3 API)
- [ ] Sports: court × hour availability grid on public page
- [ ] Customer list + visit history; reports (bookings, revenue, no-show rate, top services, utilisation)
- [ ] Staff app: today, check-in, complete, own schedule
- [ ] 7-day free trial: `subscriptions` table, countdown, day 5/7 reminders, pause booking page after expiry
- [ ] Empty/error states, app icon, splash; privacy policy + terms (PDPA)

---

## Phase 7 — Move to Supabase + staging (Week 7)
- [ ] Create Supabase **staging** project (Singapore); enable `btree_gist`, `citext`
- [ ] Run `pnpm db:migrate` with `DATABASE_URL` = Session pooler (5432)
- [ ] Deploy API to Railway/Render with Transaction pooler URL (6543, `prepare: false`) and secrets
- [ ] File storage: Supabase Storage S3 endpoint (or Cloudflare R2)
- [ ] Deploy web booking page (Expo web export) to Vercel
- [ ] EAS preview build pointing to staging API; full test with pilot-style data
- [ ] pgAdmin connected to staging via Session pooler, SSL `require`

---

## Phase 8 — Production launch (Week 8)
- [ ] Supabase **production** project (Singapore) → migrate → deploy production API
- [ ] Switch ToyyibPay sandbox → live; set callback/return URLs to production API
- [ ] `eas build --profile production --platform android` → Google Play internal → closed testing
- [ ] Onboard pilot businesses (real estate, vehicle inspection, sports); weekly feedback
- [ ] Sentry for app + API; check daily backups

---

## After MVP
- [ ] Subscription billing on website (ToyyibPay)
- [ ] iOS App Store release
- [ ] Packages / memberships, loyalty (OutletIQ), checkout to MYPOS, LHDN e-Invoice
- [ ] Multi-branch, WhatsApp Cloud API automated reminders, Bahasa Malaysia
- [ ] Apply as MDEC/BSN digital grant solution provider

---

## Database schema
See `docs/SCHEMA.md` (overview, ERD, niche mapping) and `docs/schema.sql` (full DDL, validated on PostgreSQL 16). Integer primary and foreign keys throughout.

## Environments
| Env | Database | API | App |
|---|---|---|---|
| Local | Postgres 16 in Docker (`localhost:5432`) | `localhost:3000` | Expo Go / dev build |
| Staging | Supabase project #1 (Singapore) | Railway/Render | EAS preview, Vercel preview |
| Production | Supabase project #2 (Singapore) | Railway/Render | Play Store, Vercel production |

## Session routine (every vibe-coding session)
1. `docker compose up -d`, `pnpm --filter api dev`, `pnpm --filter mobile start`
2. Tell the AI: "Read CLAUDE.md, docs/PRD.md, docs/SCHEMA.md and docs/PLAN.md, continue with the next unchecked task."
3. Test on your phone; check data in pgAdmin.
4. Commit when it works.
