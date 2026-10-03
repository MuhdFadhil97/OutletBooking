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
- [x] API routes (CRUD, tenant-scoped) for profile, services, resources, working hours, time off, booking fields *(`PATCH /businesses/current`; `/services` (peak rules + resource links nested in the body); `/resources` (+ `/:id/working-hours` PUT/GET, `/:id/working-hours/copy`; plan resource limit); `/time-off` (owner-only, `resourceId: null` = whole business); `/booking-fields` (+ `PUT /order`). Reads open to staff (resources scoped to their own unless `can_view_all`), writes owner-only. Shared zod in `packages/shared/src/setup.ts`; 25 tests in `apps/api/test/setup-api.test.ts`)*
- [x] Owner screens for each of the above; custom booking fields editor *(Setup tab is now a stack: `app/(owner)/setup/` — menu, profile & booking rules, services list + O5 editor (duration options, peak rules, payment rule, resources), O6 resources list + editor (weekly hours with breaks, `24:00` = midnight, copy hours, time off), time off & closures, booking-form questions (reorder, dropdown options). Typechecked + bundles; not yet click-tested on a phone)*
- [x] Invite staff by email → `business_members` + linked resource *(`/staff` (owner): list, invite → shareable link (no email provider yet — owner shares via WhatsApp/email share sheet), revoke, deactivate / view-all / link resources. Public `/invitations/:token` + `/accept` (rate-limited) creates login + membership + resource link in one transaction; existing accounts must log in as the invited email. App: `setup/staff.tsx`, public `app/invite/[token].tsx`. 12 tests in `apps/api/test/staff.test.ts`)*

**Done when:** owner can fully configure a business from the app.

**Prompt:**
> Read CLAUDE.md, docs/PRD.md and docs/PLAN.md. Do Phase 2. Start with the Drizzle schema and migration, then API routes with zod + tenant scoping and tests, then the owner screens one by one.

---

## Phase 3 — Booking engine + calendar (Week 3)
- [x] Migration: `customers`, `bookings` (incl. location_address, custom_fields jsonb) + exclusion constraint against double booking *(Schema in `packages/db/src/schema/bookings.ts`; migration 0005 tables + 0006 custom `bookings_no_overlap` EXCLUDE (blocked range, pending/confirmed/checked_in → SQLSTATE `23P01`) + `updated_at` triggers. 12 tests in `apps/api/test/booking-schema.test.ts` incl. buffers, cancel frees slot, concurrent attempts, cross-tenant FKs)*
- [x] `services/availability.ts`: slots for (service, duration option, resource or any, date) respecting working hours, time off, bookings, buffers, advance notice, max days ahead *(Pure `computeSlots()` + DB loader `getAvailability()`; `blockedRange()` (travel before, cleanup + travel after) must be reused by booking creation. Only resources linked to the service are offered; "any" lists free resources least-busy first. Options: `ignoreBookingWindow` (owner calendar), `excludeBookingId` (reschedule). Shared `availabilityQuerySchema` in `packages/shared/src/availability.ts`; no route yet — added with the calendar / public slots)*
- [x] `services/pricing.ts`: duration blocks, peak/off-peak, deposit or full prepayment *(Pure `quotePrice()` + DB loader `getPriceQuote()` → `PriceQuote` (shared `packages/shared/src/pricing.ts`) with per-block lines, `priceSen`, `amountDueSen`, `paymentMode`, `paymentStatus` — maps straight onto `bookings`. Each block priced by the peak rule in effect at its start (Malaysia weekday/time); overlapping rules → highest price; deposit capped at the total. 14 tests in `apps/api/test/pricing.test.ts`)*
- [x] Vitest: overlaps, breaks, holidays, travel buffer, end-of-day, Malaysia timezone, concurrent booking attempt *(21 tests in `apps/api/test/availability.test.ts`; concurrency in `booking-schema.test.ts`; pricing in `pricing.test.ts`)*
- [x] Owner calendar: day view by resource, week view; create, reschedule, cancel; status flow *(API `/bookings` (`apps/api/src/routes/bookings.ts`, `services/bookings.ts`): list by Malaysia dates (staff scoped to linked resources), detail, owner slot lookup, create ("any" = least busy, customer upsert by phone, priced, custom-field checks, owner override for outside hours), edit, reschedule (re-priced unless paid), status flow (`BOOKING_TRANSITIONS` in shared; staff: check-in / complete / no-show). Double booking → `409 slot_taken`. 26 tests in `bookings-api.test.ts`. App: Calendar tab is now a stack `app/(owner)/calendar/` — O3 day view by resource (working hours shaded, tap empty spot to book, now line) + week list, O4 booking detail (call / WhatsApp, maps links, payment, actions, cancel reason), booking form for create + reschedule. Typechecked + web bundle builds; not yet click-tested on a phone. Today dashboard now uses real data: KPIs (bookings, expected revenue, checked in, no-show) + Up next; its New booking / Walk-in quick actions open the shared form in a `today/` stack)*
- [x] Bookings tab (O9, wireframe README assigns it to Phase 3): search + filter list *(`GET /bookings/search?q&filter=all|upcoming|unpaid|past&limit` — customer name, phone (local format OK), searchable booking answers with spaces ignored (plate `WXY1234` = `WXY 1234`); upcoming soonest first then past most recent; staff scoped. 8 tests in `bookings-api.test.ts`. App: `app/(owner)/bookings/` stack — search box, filter chips, Upcoming / Past groups, highlighted match, status + amount due; detail and reschedule are shared with the Calendar tab (`features/bookings/components/`, `features/bookings/nav.ts`). Typechecked + web bundle builds; not yet click-tested on a phone)*

**Done when:** two bookings on the same resource and time are impossible, and the calendar is usable daily.

---

## Phase 4 — Public booking page + notifications (Week 4)
- [ ] Public API: `GET /public/:slug`, `GET /public/:slug/slots`, `POST /public/:slug/bookings` (rate-limited, validated)  *(`GET /public/:slug` done early with a preview `book/[slug]` page (business + services, contact buttons) so the shared link works; in dev the link points to Metro on the laptop: `http://<LAN-IP>:8081/book/<slug>`)*
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
- [x] Walk-in quick add *(done early in Phase 3: Today → Walk-in opens the booking form in walk-in mode — today only, start now (rounded down to 5 min) or a later free slot, "Any available" = least busy free resource, source `walk_in`. Customer name + phone still required)*

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
