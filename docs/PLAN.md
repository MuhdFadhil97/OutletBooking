# Build Plan — OutletBooking (Mobile, Local-first Postgres)

**Goal:** MVP in ~8 weeks (part-time), launched on Google Play with pilot businesses.
**Approach:** Expo app + Hono API + plain PostgreSQL in Docker locally. Supabase is added later as the managed Postgres host for staging/production — only the connection string changes.
**Niche:** generic engine; pilot templates for real estate viewing, vehicle inspection and sports booking.
**UI:** 74 screens + 5 flow maps in `docs/wireframes/` (IDs like O2, H1, D4 are listed in `docs/wireframes/README.md`). Each phase below names the screens and tables it builds.

> **Docs updated mid-build (Phase 4).** Phases 1–3 and the Phase 4 public API were built against the earlier docs (21 tables, 18 wireframes). Ticks below carry that progress over; items the updated docs added to already-finished phases are left unchecked and marked *(new in updated docs)* so they can be caught up. Migrated: 0000–0006 (Phase 1–3 tables) and 0007–0008 (catch-up: new columns, `booking_events`, `refunds`). Not yet migrated (later phases): `notifications`, `payment_accounts`, `payments` (+ `refunds.payment_id` FK), `platform_admins`, `admin_audit_log`, section 7 (`listings`, `checklist_*`, `inspection_*`, `booking_attachments`).

---

## Phase 0 — Setup (Days 1–3)
- [ ] Install: Node.js LTS, pnpm, Git, Docker Desktop, pgAdmin, VS Code/Cursor, Claude Code, Expo Go on your Android phone
- [ ] Create accounts: GitHub, Expo (EAS), Google Play Console (USD 25 one-time). Supabase, Railway and Apple Developer can wait.
- [x] Create GitHub repo, add `CLAUDE.md`, `START-PROMPT.md` and `docs/`
- [ ] Register domain (outletbooking.my / .com) and ToyyibPay sandbox account (dev.toyyibpay.com)
- [ ] Contact pilot businesses: 1–2 real estate agencies, 1–2 vehicle inspection centres, 1–2 sports centres
- [x] PRD, schema, wireframes and flow maps written (`docs/`) — review open questions in PRD section 15

**Done when:** tools installed, repo created, Docker running.

---

## Phase 1 — Foundation (Week 1)
- [x] pnpm monorepo: `apps/mobile`, `apps/api`, `packages/db`, `packages/shared`
- [x] `docker-compose.yml`: postgres:16 (`localhost:5432`), MinIO; connect pgAdmin to local Postgres *(`minio/minio` image can no longer be pulled from Docker Hub — swap image before file uploads are needed. Start DB with `docker compose up -d postgres`)*
- [x] Drizzle mirroring `docs/schema.sql`. Migration 1: extensions, `set_updated_at`, Better Auth tables (numeric IDs), `push_tokens`, `businesses`, `business_members`, `subscriptions` *(0000 extensions + `set_updated_at` (custom), 0001 tables, 0002 `updated_at` triggers (custom))*
- [x] Hono API: health, error handler, CORS, Better Auth, tenant + role middleware, `GET /me`
- [x] Sign-up creates user + business + owner membership + 7-day trial in one transaction (on sign-up step 2) *(`POST /signup`, `GET /signup/slug-available`)*
- [x] Forgot / reset password by email link (Better Auth) *(`POST /password/forgot` (rate-limited, same answer for unknown emails), `GET /password/reset/:token`, `POST /password/reset` with "log out other devices"; link `APP_PUBLIC_URL/reset-password?token=…` valid 30 min, single use. Email goes through `services/mailer.ts`: **Resend** (`MAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `MAIL_FROM` on a domain verified in Resend) for staging / production; `console` (link printed in the API log, refused in production) for local dev. 4 tests in `mailer.test.ts`. 12 tests in `password.test.ts` (incl. H6 change password))*
- [x] Expo app: Expo Router `(auth)` / `(owner)` / `(staff)`, theme tokens, Manrope, secure session, role-based redirect
- [x] Screens: **O0** log in · **O1a** sign-up account · **O1b** business & type · **O1c** step 3 (`app/welcome.tsx` "Review your services", Finish / Skip) · **O2** Today (trial countdown, real data since Phase 3) · owner and staff tab bars · log out (`components/AccountCard.tsx`)
- [x] Screens *(new in updated docs)*: **D8** first-time Today setup checklist · **E1/E2** forgot / set new password · **H6** my account (change password; opened from the Setup avatar) *(D8: `GET/POST /businesses/current/checklist` (owner only) works the 5 steps out from real data — resource with hours, any booking; "link shared" / "hide" stored in `businesses.settings`; ToyyibPay shows "Coming soon" until Phase 5 H1; 6 tests in `checklist.test.ts`. E2 is `app/reset-password.tsx` (outside `(auth)` so the link works while logged in). H6 = `setup/account` + `setup/password` (Better Auth change-password, optional log out other devices). H6 also has **Help on WhatsApp** (FTech support `+60 14-599 0042`, `SUPPORT_WHATSAPP` in shared) and, for owners, **Delete my account and business data** (`DELETE /me` + `setup/delete-account`): password + business name re-typed, then the business and everything in it (bookings, events, refunds, customers, services, resources, staff access) plus the owner login are permanently deleted, and staff logins used only for that business too — decided by the product owner: hard delete, no retention. Phase 5 `payments` must be added to that delete. 5 tests in `account-deletion.test.ts`. Notification settings come with Phase 4 `notifications`. Checked end-to-end on Expo web)*
- [x] Seed one demo business; Vitest: tenant isolation, sign-up transaction
- [x] Verified on a real phone via Expo Go *(Expo CLI login on Windows: use `EXPO_TOKEN` access token — browser SSO login crashes)*

**Done when:** you sign up on your phone (Expo Go → API via LAN IP), see "Free trial · 7 days left", log out and back in, and see the rows in pgAdmin.

**Prompt:**
> Read CLAUDE.md, docs/PRD.md, docs/SCHEMA.md, docs/PLAN.md and docs/wireframes/README.md. Do Phase 1 only. Explain the plan and folder structure before coding.

---

## Phase 2 — Business setup (Week 2)
- [x] Migration: `staff_invitations`, `branches`, `resources`, `services`, `service_price_rules`, `resource_services`, `working_hours`, `time_off`, `booking_fields` *(0003 tables + 0004 `updated_at` triggers (custom); schema in `packages/db/src/schema/setup.ts`; DB constraint tests in `apps/api/test/setup-schema.test.ts`)*
- [x] Migration *(new in updated docs)*: new columns `businesses.auto_confirm_paid / customers_can_cancel / late_cancel_keeps_deposit / settings`, `business_members.can_take_payments / can_edit_setup`, `staff_invitations.role / can_view_all / can_take_payments / can_edit_setup`, `booking_fields.show_to_staff / hint` *(0007 generated + 0008 custom)*
- [x] **Template config** (one file in `packages/shared`): per business type — resource label, defaults, starter services, booking questions, which Setup rows show, default payment rule. Sign-up step 3 and the Setup tab both read it *(`packages/shared/src/templates.ts`: resource label/type, step-3 resource setup (count vs list of people), default count, default opening hours, the two "Only for this type" Setup rows, payment choices + default rule + default deposit; starter services and questions aligned with the updated wireframes. Shared payment-rule helpers in `onboarding.ts`. `applyTemplate()` still runs inside the sign-up transaction)*
- [x] API routes (zod + tenant-scoped) for profile, rules, services, resources, hours, time off, booking fields, staff invites *(`PATCH /businesses/current`; `/services`; `/resources` (+ working hours, copy hours, plan resource limit); `/time-off`; `/booking-fields` (+ `PUT /order`); `/staff` + public `/invitations/:token` (+ `/accept`, rate-limited). 25 tests in `setup-api.test.ts`, 12 in `staff.test.ts`. `PATCH /businesses/current` now also takes the E6 rules (`pendingExpiryMin`, `autoConfirmPaid`, `customersCanCancel`, `lateCancelKeepsDeposit`) and template `settings` (shallow-merged); booking questions take `hint` (also on the public page) and `showToStaff` — hidden answers are stripped from booking detail / lists / search and the question list for staff who cannot change setup. 12 tests in `business-rules.test.ts`)*
- [x] Screens (earlier docs): Setup stack `app/(owner)/setup/` — menu, **E5/E6** profile & booking rules (one screen), **H2 → O5** services, **O6** resources & hours with **H5** time off, **H3 → H4** booking-form questions, **D12** staff, **G1** accept invite (`app/invite/[token].tsx`), **O1c** step 3 "Review your services" (Finish saves prices/durations)
- [x] Screens *(new in updated docs)*: **O1c** step 3 per type · **ST** template-driven Setup tab · **E5** profile / **E6** rules split · **D12** roles with permission toggles *(O1c `app/welcome.tsx`: one screen for every type — count stepper or people list (first = owner, linked), "Other" label choice + first service, travel time (real estate), mobile inspection fee/area (inspection), customers pick a stylist (salon), questions summary (inspection/workshop), prices/lengths, editable opening hours, payment rule; Finish = `POST /businesses/current/onboarding` (owner, once, one transaction). ST `setup/index.tsx` from `GET /businesses/current/setup`; rows for features not built yet show "Soon" (listings, checklist, walk-in queue, quotes, pick-up, group bookings, reminders, plan). New screens: `setup/rules` (E6), `setup/payment-rule`, `setup/extra/[key]` (travel, mobile). E5 can change the booking link (409 `slug_taken`); logo upload waits for file storage. D12 switches in `setup/staff`. Checked end-to-end on Expo web for sports, real estate and Other. Booking page must show the mobile fee and honour `customersPickResource` in Phase 4)*
- [x] Permissions enforced in API: `can_view_all`, `can_take_payments`, `can_edit_setup` *(tenant middleware loads them (owners have all) + `requirePermission()`. Can change setup = services, booking questions, working hours, time off; resources, business profile/rules and staff stay owner-only. `can_take_payments` is ready for the Phase 5 manual-payment routes. Invitations carry the flags onto the membership. 11 tests in `permissions.test.ts`)*

**Done when:** an owner of each pilot type can configure their business from the app and invite a staff member who can log in.

---

## Phase 3 — Booking engine + calendar (Week 3)
- [x] Migration: `customers`, `bookings` (+ exclusion constraint) *(0005 tables + 0006 custom `bookings_no_overlap` EXCLUDE (blocked range, pending/confirmed/checked_in → SQLSTATE `23P01`) + `updated_at` triggers. 12 tests in `booking-schema.test.ts`)*
- [x] Migration *(new in updated docs)*: `booking_events`, `refunds`; `customers.phone` nullable + `anonymized_at`; `bookings.reminder_sent_at` *(0007; `refunds.payment_id` gets its FK when `payments` is created in Phase 5. 0008 backfills a `created` event for existing bookings)*
- [x] `services/availability.ts` and `services/pricing.ts` (duration blocks, peak/off-peak, deposit / full prepayment, travel buffers) *(`computeSlots()` / `getAvailability()`, `blockedRange()` reused by booking creation; `quotePrice()` / `getPriceQuote()` → shared `PriceQuote`; each block priced by the peak rule at its start, overlapping rules → highest, deposit capped at total)*
- [x] Vitest: overlaps, breaks, holidays, travel buffer, end-of-day, Malaysia timezone, concurrent booking attempt *(21 in `availability.test.ts`, 14 in `pricing.test.ts`, concurrency in `booking-schema.test.ts`)*
- [x] Every status change writes `booking_events` *(`services/booking-events.ts`: owner / walk-in / public create, reschedule (from → to) and every status change, in the same transaction, with the acting user (null = customer / system). Added a `confirmed` event type for owner-confirmed pending bookings (also in `docs/schema.sql`). `GET /bookings/:id/events` = O4 timeline, tenant + staff scoped. 12 tests in `booking-events.test.ts`)*
- [x] Screens: **O3** calendar day · **D7** week view · **O9** bookings list (search by customer name, phone, searchable answers; All / Upcoming / Unpaid / Past) · **O4** booking detail · **D1** new booking · **D3** reschedule · cancel with reason · **O2** Today with real data *(API `/bookings` + `/bookings/search`, 26 + 8 tests in `bookings-api.test.ts`; double booking → `409 slot_taken`. Calendar, Bookings and Today stacks share `features/bookings/components/`. Verified on a phone by the owner)*
- [x] Screens *(new in updated docs)*: **D4** cancel & refund (record refund) · **H8** checked in → completed (`Owner-BookingCheckedIn.dc.html`) · **D9** offline / error / toast patterns (`Owner-States.dc.html`) — check existing screens against the updated O3/O4/O9 wireframes *(D4 cancel sheet: reason chips, keep deposit / full / partial refund, refund method, WhatsApp the customer — refunds recorded only (max = paid − refunded; `payments` table created early in migration 0009). H8: timeline in booking detail (`GET /bookings/:id/events`) + Extend one block (`POST /bookings/:id/extend`, must be an offered duration, re-priced unless paid). D9: offline banner (expo-network → TanStack `onlineManager`; read-only, changes fail fast), toast with optional Undo (`components/ui/Toast.tsx`), "That slot was just taken" + Pick another time. Not yet click-tested on a phone)*

**Done when:** two bookings on the same resource and time are impossible, and the calendar is usable daily.

---

## Phase 4 — Public booking page + notifications (Week 4)
- [x] Public API: `GET /public/:slug`, `GET /public/:slug/slots`, `POST /public/:slug/bookings` (rate-limited, validated) *(`apps/api/src/services/public.ts`. `GET /public/:slug` also returns resource label, booking window, bookable resources and booking questions; `booking_enabled = false` → 403. Paid services → `pending` + `expires_at`, others → `confirmed`; response has the random token only. Abuse: 60 req/min per IP, 10 bookings / 10 min per IP, 5 active web bookings per phone per day. 11 tests in `public.test.ts`)*
- [x] Route `book/[slug]` (Expo web): service → duration → resource/any → date → slot → custom fields → name + phone → confirm *(`app/book/[slug]/index.tsx`: C1 service cards → C2 date strip (booking window), duration chips, resource chips ("Any available" when >1), slot chips → C3 summary with live price (`GET /public/:slug/quote`, peak lines), name + `+60` mobile, address for at-customer services, booking questions (`FieldInput` now shared with the owner form), notes, payment / cancel-policy note. `slot_taken` sends the customer back to step 2 with a message. Paid services end `pending` until Phase 5 payment. Bundles for web + Android; not yet click-tested in a phone browser)*
- [x] Confirmation page: add to calendar, WhatsApp the business, cancel link *(`app/my-booking/[token].tsx` — the saved link. API: `GET /public/bookings/:token` (no customer name when opened from the link), `GET /public/bookings/:token/calendar.ics`, `POST /public/bookings/:token/cancel` (pending/confirmed only, until start − `cancel_cutoff_min`, rate-limited). Page: status badge, ref (first 6 of token), summary, .ics + Google Calendar, WhatsApp with prefilled ref, directions, cancel with deadline. Tests in `public-manage.test.ts`)*
- [x] QR code screen in owner app *(O7 `app/(owner)/today/share.tsx` from Today → Share link: QR (`components/ui/QrCode.tsx`, `qrcode` + react-native-svg), copy link (expo-clipboard), share on WhatsApp, more apps, QR poster → public printable `app/book/[slug]/poster.tsx` (Print / save as PDF in the browser))*
- [ ] Expo push to owner/staff on new booking (push tokens stored per user) *(Code done, device test pending. API: `PUT/DELETE /me/push-token`, `services/push.ts` sends via Expo Push API to active owners + the staff linked to the booked resource on new web bookings and customer cancellations (after the response, `background.ts`); `DeviceNotRegistered` tokens are deleted; optional `EXPO_ACCESS_TOKEN`. 7 push tests with a fake sender. App: `features/push/` registers after login (owner + staff layouts), unregisters on logout, tapping opens the booking. **To verify:** Expo Go on Android has no remote push since SDK 53 → run `eas init` (adds the projectId) and use a development build (`eas build --profile development --platform android`))*
- [x] Route `book/[slug]` (Expo web), template-driven: **C1** service · **C2** court grid (sports) or **F1** date & time (others) · **C3 / C5 / C6 → C6b** details & custom questions · **C4 / C5c / C6c** confirmations · **F2** fully booked · **F5** view / cancel *(C1, F1, C3 and confirmation/F5 done earlier. Added C2 court × time grid (service booked by court, 2+ courts) and F2 fully booked: shorter-duration suggestion, next 3 free times (`GET /public/:slug/next-available`), ask about cancellations on WhatsApp. Still to click-test in a phone browser)*
- [x] Migration: `notifications`; Expo push + **D6** notifications screen *(`notifications` table (migration 0009). `services/notifications.ts`: every push is also stored per recipient (owners + linked staff) — new booking, customer cancel, staff joined. `GET /notifications`, `POST /notifications/read` (own rows only). D6 `today/notifications.tsx` + bell with unread badge on Today. Tests in `activity.test.ts`)*

**Done when:** a customer books from a phone browser for each pilot type, and the owner gets a push notification.

---

## Phase 5 — Payments & jobs (Week 5)
- [x] Migration: `payment_accounts`, `payments` *(`payments` in 0009; `payment_accounts` in 0011 (+ `test_bill_code` for the RM 1 test, added to docs/schema.sql) and 0012 trigger)*
- [x] **H1** connect own ToyyibPay: encrypt secret key (`APP_ENCRYPTION_KEY`), create category, RM 1.00 test; D8 checklist item ticks when connected *(`setup/payments.tsx`. Key checked by creating the category, stored AES-256-GCM (`services/secrets.ts`), only last 4 shown; RM 1.00 test bill + "Check test payment"; disconnect. Setup row + D8 step tick when connected. Owner-only API `/payments/account`)*
- [x] Create bill with the **business's** key → payment URL (deposit or full); callback re-checks `getBillTransactions` → paid → confirmed (idempotent) *(`services/payments.ts` + `services/toyyibpay.ts`: FPX only, business pays the fee, bill expires with the hold, ref = first 6 of the booking token. `POST /toyyibpay/callback` checks the hash (log only) and always re-checks `getBillTransactions`; idempotent; underpaid bills ignored; `auto_confirm_paid` respected; paid-after-expiry → slot taken back if free, else kept cancelled + "please refund" notification. Return page re-checks too (`/public/bookings/:token/payment-check`), so local testing works without a tunnel. 26 tests in `payments.test.ts` / `toyyibpay.test.ts` with a fake ToyyibPay; not yet run against the real sandbox)*
- [ ] Local callback testing through a tunnel (Cloudflare Tunnel / ngrok) *(steps in `docs/TOYYIBPAY-SANDBOX.md` (`cloudflared tunnel --url http://localhost:3000` → `API_PUBLIC_URL`); to do on your laptop)*
- [x] **D2** walk-in *(done early in Phase 3: Today → Walk-in opens the booking form in walk-in mode — today only, start now (rounded down to 5 min) or a later free slot, "Any available" = least busy, source `walk_in`)*
- [x] Screens: **F4** payment not completed (held-slot countdown) · **H7** unpaid booking (resend pay link, record manual payment) · **D5** remind tomorrow's customers (`reminder_sent_at`) *(F4 on `my-booking/[token]` (auto-opens ToyyibPay after booking with `pay=1`, countdown, Try again, failed help with ref); H7 in booking detail (`features/payments/components/PaymentActions.tsx`: hold countdown, resend pay link on WhatsApp, record payment sheet — needs `can_take_payments`); D5 `today/reminders.tsx` (editable message, one-tap WhatsApp, marks `reminder_sent_at`, Send next). Not yet click-tested on a phone)*
- [x] pg-boss jobs: expire unpaid pending bookings, staff day summary, trial reminders (day 5, day 7) *(`src/jobs/index.ts` started by `server.ts` (`JOBS_ENABLED`): expire unpaid holds every minute (re-checks bills first), staff day summary 7:30 AM, trial reminders 9 AM (once each) — Malaysia time; logic in `services/payments.ts` / `services/daily.ts`, tested directly)*

**Done when:** a sandbox payment goes to the business's own ToyyibPay sandbox account and confirms the booking automatically.

---

## Phase 6 — Staff app, customers, reports, trial (Week 6)
- [x] Staff app: **S1** today · **S2** job in progress (result, notes, photos to MinIO, collect balance) · **G2** schedule · **G3** profile *(Migration 0013/0014: `booking_attachments` + `business_members.notification_prefs` (G3 switches, added to docs/schema.sql). API: `GET /me/schedule` (my linked resources' bookings, hours, time off — always "mine", even with view all), `PUT /bookings/:id/result`, `GET/POST/DELETE /bookings/:id/attachments` (multipart, JPEG/PNG/WebP/HEIC ≤ 10 MB, 20 per booking, private files under `businesses/{id}/`, 15-min signed links; staff delete only their own photos), `GET/PUT /me/notification-prefs` (off = no push for those types; D6 list unchanged; day summary respects it). `services/storage.ts` speaks S3; docker compose now runs **RustFS** (MinIO images are no longer published) on :9000 with the same keys; `S3_PUBLIC_URL` for phone testing. H6 delete business also removes its files. Screens: `staff/today` (travel buffers, next card with Waze / Maps / WhatsApp, check in → S2), `staff/job/[id]` (result notes, photos via expo-image-picker, payment card + H7 record payment, check in / complete / no-show), `staff/schedule` (7-day strip, week arrows, day off / closed), `staff/profile` (contact, read-only hours, time off, switches, log out). Overall Pass / Needs attention / Fail waits for section 7 `inspection_results` (PRD fallback: notes + photos). Customer view of photos on my-booking: later. 20 tests in `staff-app.test.ts` with a fake storage, plus a real RustFS round trip. Checked end-to-end on Expo web; photo upload not yet tried on a phone)*
- [x] **D10** customers list · **D11** customer profile (stats, notes, history, PDPA erase = anonymise) *(Owner-only API `/customers`: list with search (name / mobile typed any way) + Regulars / New / No-shows, `count(*) over()` total, "Show more" paging; profile with visits, spent (paid − refunded), no-shows, upcoming + last 50 past; add (same mobile → 409 `customer_exists` with a link to that customer; archived ones come back) and edit (mobile clash → 409 `phone_taken`); `POST /customers/:id/erase` = PDPA: name → "Deleted customer", phone/email/notes → NULL, `anonymized_at`, and the address, booking answers and customer notes on their bookings cleared; bookings, payments, refunds kept; refused (409 `has_upcoming_bookings`) while they have upcoming bookings; the same mobile booking again starts a fresh customer. Definitions in `packages/shared/src/customers.ts`: visit = checked in / completed / confirmed and over; Regular ≥ 5 visits; New = added ≤ 30 days ago with ≤ 1 visit; tag "N no-shows" from 2. Screens: `bookings/customers` (Customers button in the Bookings header; + adds) and `bookings/customers/[id]` (Call / WhatsApp / Book, stats, notes edit sheet, upcoming / history → booking detail, erase). Booking detail: the customer name opens D11 (owners). "Book" passes only `customerId` (route params become the web URL — no names or phones in URLs). 11 tests in `customers.test.ts`. Checked end-to-end on Expo web)*
- [x] **O8** reports *(Owner-only `GET /reports?period=today|week|month&offset=n` (`services/reports.ts`, definitions in `packages/shared/src/reports.ts`). Local periods (Mon–Sun weeks, calendar months), ‹ › to step back / forward. Bookings = not cancelled (pending and no-shows count); revenue = booked value minus no-shows (same as Today's expected revenue), vs the period before; collected = payments received − refunds recorded in the period; no-show rate = no-shows ÷ bookings; utilisation = booked time inside open hours ÷ (working hours − time off) of active resources, overall + per resource (FR-13.3); bookings per day (later days lighter); top 5 services; today's status summary (FR-13.1); new vs returning customers (FR-13.4). Screen `app/(owner)/reports.tsx`. 8 tests in `reports.test.ts`. Not yet click-tested on Expo web or a phone)*
- [x] Trial & plans: **E3** choose a plan (opens website) · **E4** trial ended paywall · **F3** booking page paused *(Plans, prices and `hasPlanAccess()` in `packages/shared/src/plans.ts`: trial until `trial_ends_at`; active / past_due / cancelled until `current_period_end` (active with no end = open-ended, e.g. set by FTech); expired / none = no access. Tenant middleware loads it; `requireActivePlan` on business data routes refuses every change with 403 `plan_inactive` (reading still works; /me, push token, notifications, log out and delete account stay open) — owner and staff. Public page: `bookingEnabled` = owner switch AND plan access, so slots and new bookings get 403 `booking_disabled`; existing booking links keep working. `/me` returns `subscription.hasAccess`. E3 `setup/plan.tsx` from the Today trial banner, the Setup "Plan & billing" row and E4: `GET /businesses/current/plan` (owner) with resource / staff counts, "Best for you" (Business above 3 resources or with staff), extra-resource price, MSME grant on WhatsApp, Continue opens `WEBSITE_URL/billing?business=<slug>&plan=<plan>` (page built in Phase 7 I4). E4 replaces Today when there is no access (Choose a plan, WhatsApp FTech, Log out); other tabs stay viewable. F3 on `book/[slug]`. 6 tests in `plan.test.ts`. Not yet click-tested)*
- [ ] Pilot extras — only if confirmed (PRD section 15): migration for `listings`, `checklist_*`, `inspection_*`; screens **ST-RE-L** listings, **ST-VI-C** checklist & report; Waze / Google Maps links; court grid on public page
- [ ] App icon, splash; privacy notice + terms (PDPA)

---

## Phase 7 — Admin, website, staging on Supabase (Week 7)
- [ ] `apps/web` (Next.js): **I3** marketing site · **I4** plan payment page (FTech's own ToyyibPay account, `purpose = 'subscription'`) · **I1/I2** platform admin (businesses list, extend trial with reason, pause booking page)
- [ ] Migration: `platform_admins`, `admin_audit_log`; admin routes check `platform_admins` and write the audit log in the same transaction
- [ ] Create Supabase **staging** project (Singapore); enable `btree_gist`, `citext`; `pnpm db:migrate` via Session pooler (5432)
- [ ] Deploy API to Railway/Render (Transaction pooler 6543, `prepare: false`); `apps/web` and Expo web booking page to Vercel
- [ ] File storage: Supabase Storage S3 endpoint (or Cloudflare R2)
- [ ] EAS preview build pointing to staging; full test with pilot-style data; pgAdmin to staging (Session pooler, SSL `require`)

---

## Phase 8 — Production launch (Week 8)
- [ ] Supabase **production** project (Singapore) → migrate → deploy production API and web
- [ ] Switch ToyyibPay sandbox → live (platform account for plans; each business connects its live key)
- [ ] `eas build --profile production --platform android` → Google Play internal → closed testing
- [ ] Onboard pilot businesses (real estate, vehicle inspection, sports); extend trials from the admin panel; weekly feedback
- [ ] Sentry for app, API and web; check daily backups

---

## After MVP
- [ ] iOS App Store release
- [ ] Workshop / salon extras: quotes before work, pick-up & drop-off, stylist schedules, walk-in queue, group bookings
- [ ] Packages / memberships, loyalty (OutletIQ), checkout to MYPOS, LHDN e-Invoice
- [ ] Multi-branch, WhatsApp Cloud API automated reminders, Bahasa Malaysia
- [ ] Apply as MDEC/BSN digital grant solution provider

---

## Database schema
See `docs/SCHEMA.md` (overview, ERD, rules) and `docs/schema.sql` (full DDL, 32 tables, validated on PostgreSQL 16). Integer primary and foreign keys throughout. Each phase migrates only the tables it needs.

## Environments
| Env | Database | API | App / web |
|---|---|---|---|
| Local | Postgres 16 in Docker (`localhost:5432`) | `localhost:3000` | Expo Go / dev build; `apps/web` on `localhost:3001` |
| Staging | Supabase project #1 (Singapore) | Railway/Render | EAS preview, Vercel preview |
| Production | Supabase project #2 (Singapore) | Railway/Render | Play Store, Vercel production |

## Session routine (every vibe-coding session)
1. `docker compose up -d`, `pnpm --filter api dev`, `pnpm --filter mobile start`
2. Tell the AI: "Read CLAUDE.md, docs/PRD.md, docs/SCHEMA.md, docs/PLAN.md and docs/wireframes/README.md, continue with the next unchecked task."
3. Test on your phone; check data in pgAdmin.
4. Commit when it works.
