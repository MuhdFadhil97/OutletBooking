# PRD — OutletBooking (Booking & Appointment SaaS)

| Item | Detail |
|---|---|
| Product | **OutletBooking** — multi-tenant booking & appointment SaaS (mobile-first) |
| Pilot niches | Real estate viewing, vehicle inspection, sports court booking |
| Payment gateway | ToyyibPay (FPX / DuitNow) — each business connects its own account |
| Trial | 7-day free trial |
| Market | Malaysian SMEs — any service business that takes appointments |
| Platforms | Android & iOS app (owner/staff), web booking page (customer) |
| Stack | Expo app + Hono API + PostgreSQL (local Docker first; Supabase as managed Postgres for staging/production) — see `CLAUDE.md` |
| Version | 1.0 (MVP) |
| Owner | Muhammad Fadhil — FTech IT Consulting Sdn Bhd |
| Status | Draft v1.1 — updated after wireframe review (74 screens, 5 flow maps) |

---

## 1. Problem statement
Most Malaysian SME service businesses (workshops, barbers, salons, sports courts, clinics, tuition centres) still take bookings through phone calls, WhatsApp chats and paper books. This causes:
- **Double bookings** and missed bookings when messages get buried.
- **No-shows** with no deposit protection, causing lost revenue.
- **Owner time wasted** replying "is 3pm available?" all day.
- **No data** on busy hours, staff utilisation, repeat customers or revenue.

Existing solutions are either built for one niche (salons, aesthetic clinics), expensive, or foreign tools not tailored to Malaysian payments (FPX, DuitNow) and WhatsApp habits.

## 2. Product vision
A simple, affordable booking app that **any service business in Malaysia can set up in 10 minutes**. Customers book 24/7 from a link or QR code without downloading an app; owners and staff manage everything from their phone.

## 3. Goals & success metrics (MVP)
| Goal | Metric | Target (3 months after launch) |
|---|---|---|
| Fast onboarding | Time from sign-up to first booking page live | < 15 minutes |
| Adoption | Active businesses (≥ 10 bookings/month) | 20 |
| Customer self-service | Bookings made via web booking page | ≥ 50% of all bookings |
| Reduce no-shows | No-show rate for businesses using deposits | < 5% |
| Retention | Pilot businesses still active after 60 days | ≥ 70% |
| Revenue | Paying businesses after free pilot | ≥ 10 |

## 4. Target users & personas
| Persona | Description | Main needs |
|---|---|---|
| **Owner** (primary buyer) | SME owner, 1–3 outlets, 1–20 staff, uses Android phone, busy, not technical | Fewer WhatsApp replies, no double booking, deposits, see today's bookings and revenue |
| **Staff** | Barber, technician, coach, therapist, front desk | See own schedule, check in customers, mark jobs done |
| **Customer** (end user) | General public booking a service | Book quickly from phone, see available time, get confirmation and reminder |

## 5. Niche flexibility (any niche)
Everything bookable is a **resource** with a type: `staff`, `bay`, `court`, `room`, `property`, `other`.

| Business template | Resource label | Example services | Default slot interval |
|---|---|---|---|
| **Real estate viewing** (pilot) | Agent / Property | Property viewing 30 min | 30 min |
| **Vehicle inspection** (pilot) | Bay / Inspector | Pre-purchase inspection 60 min | 30 min |
| **Sports court** (pilot) | Court | Badminton 1 hour, Futsal 2 hours | 60 min |
| Car workshop / car wash | Bay | Oil change 60 min, Full service 120 min, Wash 30 min | 30 min |
| Barber / Salon | Barber / Stylist | Haircut 30 min, Colour 90 min | 15 min |
| Clinic / Physio | Practitioner / Room | Consultation 15 min, Physio 45 min | 15 min |
| Tuition / Classes | Teacher / Room | Class 60 min | 30 min |
| Other | Resource | Custom | 30 min |

Owners choose a template at sign-up (pre-fills labels, sample services and interval) and can rename anything later.

### 5.1 Pilot niches (MVP focus)
The first three templates are built and tested in depth with pilot businesses:

| Pilot niche | Who books | Resource | Example services | Extra booking fields | Special needs |
|---|---|---|---|---|---|
| **Real estate viewing** | Buyers / tenants booking a viewing with an agent | Agent (`staff`) or property unit (`property`) | Property viewing 30 min, Virtual viewing 20 min | Property / listing ref, viewing address, buyer or tenant, budget (optional) | Viewing happens at a property address; agent needs travel buffer between viewings; owner/agency manages several agents |
| **Vehicle inspection** | Car owners, used-car buyers, dealers | Inspection bay or inspector (`bay` / `staff`) | Pre-purchase inspection 60 min, Full inspection 90 min, Mobile inspection 90 min | Plate number, make & model, year, inspection location (for mobile) | On-site vs mobile inspection; result notes/photos after completion |
| **Sports booking** | Players / teams | Court (`court`) | Badminton 1 hr, Futsal 1–2 hr, Pickleball 1 hr | Number of players (optional) | Customer chooses duration (1, 2, 3 hours); peak / off-peak pricing; full prepayment common |

## 6. Scope

### 6.1 In scope (MVP)
1. Owner sign-up with business template
2. Business profile & public booking link (slug + QR)
3. Services setup (duration, buffer, price, deposit)
4. Resources setup with working hours, breaks and time off
5. Staff invitation & staff role
6. Availability engine (no double booking)
7. Owner calendar (day/week by resource) with create, reschedule, cancel
8. Public web booking page
9. Deposit / prepayment via ToyyibPay (FPX/DuitNow)
10. Push notifications (new booking, cancellation, reminders to staff)
11. Customer reminders via WhatsApp click-to-chat link
12. Walk-in quick add
13. Customer list & visit history
14. Basic reports
15. Custom booking fields per template (plate number, property ref, etc.)
16. Duration options and location-based services
17. 7-day free trial
18. Each business connects its own ToyyibPay account (payments go straight to them)
19. Booking form editor (custom questions per business / service)
20. Manual payments (cash, DuitNow QR, card, bank transfer) and refund records
21. In-app notifications and a first-time setup checklist
22. Customer list & profile, including PDPA erase on request
23. Platform admin panel for FTech (extend trials, pause booking pages, audit log)
24. Marketing website and plan payment page (ToyyibPay)

### 6.2 Out of scope (MVP) — planned later
- In-app subscription billing (billed on website after pilot)
- Automated WhatsApp Cloud API messages
- Customer mobile app / customer accounts
- Packages, memberships, loyalty points (OutletIQ integration)
- POS checkout (MYPOS integration), LHDN e-Invoice submission (the plan payment page only collects an optional TIN for later)
- Multi-branch reporting, franchise view
- Bahasa Malaysia / Chinese language
- Recurring bookings, group classes with capacity
- Google Calendar sync

## 7. Functional requirements

### FR-01 Authentication & onboarding
| ID | Requirement | Priority |
|---|---|---|
| FR-01.1 | Owner signs up with email + password | Must |
| FR-01.2 | Sign-up wizard: business name, phone, business template, slug (auto-suggested, unique) | Must |
| FR-01.3 | Template pre-fills resource label, sample services and slot interval | Must |
| FR-01.4 | Login, logout, forgot password, persistent session | Must |
| FR-01.5 | Users are routed to owner or staff view based on role | Must |

### FR-02 Business profile
| ID | Requirement | Priority |
|---|---|---|
| FR-02.1 | Edit name, logo, phone, WhatsApp number, address, description | Must |
| FR-02.2 | Booking settings: slot interval, min advance notice (e.g. 1 hour), max days ahead (e.g. 30), cancellation cut-off | Must |
| FR-02.3 | Show and share booking link; generate downloadable QR code | Must |
| FR-02.4 | Rename resource label (e.g. "Bay", "Court") | Should |

### FR-03 Services
| ID | Requirement | Priority |
|---|---|---|
| FR-03.1 | Create/edit/archive service: name, description, duration (min), buffer after (min), price (RM), deposit (RM, optional) | Must |
| FR-03.2 | Assign which resources can perform each service | Must |
| FR-03.3 | Show/hide service on public booking page | Should |
| FR-03.4 | Sort order of services | Could |
| FR-03.5 | Duration options per service (e.g. 1, 2, 3 hours) so customers choose length; price = price per block × blocks (sports) | Must |
| FR-03.6 | Peak / off-peak pricing by weekday and time range (e.g. weekday after 6pm, weekends) | Should |
| FR-03.7 | Service location type: `at_business` or `at_customer_location` (mobile inspection, property viewing at address) | Must |
| FR-03.8 | Travel buffer before/after for location-based services | Should |

### FR-04 Resources & working hours
| ID | Requirement | Priority |
|---|---|---|
| FR-04.1 | Create/edit/archive resource: name, type, optional linked staff user | Must |
| FR-04.2 | Weekly working hours per resource (multiple ranges per day, to support breaks) | Must |
| FR-04.3 | Time off per resource or whole business (public holidays, leave, closures) | Must |
| FR-04.4 | Copy working hours from one resource to others | Should |

### FR-05 Staff
| ID | Requirement | Priority |
|---|---|---|
| FR-05.1 | Owner invites staff by email; staff joins the business with role `staff` | Must |
| FR-05.2 | Staff sees only bookings for resources linked to them (or all, if owner allows) | Must |
| FR-05.3 | Owner can deactivate staff access | Must |
| FR-05.4 | Staff see price, payment status, deposit paid and balance due for their bookings, and can record balance payment (cash, DuitNow QR, card) | Must |
| FR-05.5 | Owner and staff log in through the same login screen; the app routes by role | Must |

### FR-06 Availability engine
| ID | Requirement | Priority |
|---|---|---|
| FR-06.1 | Calculate available slots for a service, date and resource (or "any available") | Must |
| FR-06.2 | Respect working hours, breaks, time off, existing bookings, service duration + buffer, advance notice and max days ahead | Must |
| FR-06.3 | Database must reject overlapping bookings on the same resource (exclusion constraint) | Must |
| FR-06.4 | All times shown in Asia/Kuala_Lumpur | Must |
| FR-06.5 | "Any available" assigns the least-busy eligible resource | Should |

### FR-07 Owner calendar & booking management
| ID | Requirement | Priority |
|---|---|---|
| FR-07.1 | Day view by resource (columns) and week view | Must |
| FR-07.2 | Create booking manually (existing or new customer) | Must |
| FR-07.3 | Reschedule (choose new available slot), cancel with reason | Must |
| FR-07.4 | Update status: pending → confirmed → checked_in → completed; or cancelled / no_show | Must |
| FR-07.5 | Booking detail: customer, service, resource, time, price, deposit status, notes, source | Must |
| FR-07.6 | One-tap WhatsApp / call customer from booking detail | Must |
| FR-07.7 | Filter by resource and status | Should |
| FR-07.8 | Bookings list with search by customer name (partial match), filters All / Upcoming / Unpaid / Past, showing status, amount and balance due | Must |

### FR-08 Public booking page (web, no login)
| ID | Requirement | Priority |
|---|---|---|
| FR-08.1 | URL `/book/{slug}` shows business info and visible services | Must |
| FR-08.2 | Flow: service → resource or "any" → date → time slot → name + phone (+ optional notes) → confirm | Must |
| FR-08.3 | If deposit required, redirect to payment; booking stays `pending` until paid | Must |
| FR-08.4 | Confirmation page: summary, add-to-calendar, WhatsApp the business | Must |
| FR-08.5 | Customer can cancel via a secure link (before cut-off) | Should |
| FR-08.6 | Mobile-friendly, loads fast on 4G, no app download | Must |
| FR-08.7 | Basic abuse protection (rate limit per phone/IP, phone format validation) | Must |

### FR-09 Payments (deposit)
| ID | Requirement | Priority |
|---|---|---|
| FR-09.1 | Create payment bill via ToyyibPay (FPX / DuitNow) | Must |
| FR-09.2 | ToyyibPay callback → server re-checks bill status with ToyyibPay API before marking payment paid and booking confirmed | Must |
| FR-09.3 | Unpaid pending bookings expire after configurable time (default 15 min) and free the slot | Must |
| FR-09.4 | Owner sees payment status and reference per booking | Must |
| FR-09.5 | Refunds handled manually by owner (record only) | Should |

### FR-10 Notifications & reminders
| ID | Requirement | Priority |
|---|---|---|
| FR-10.1 | Push to owner/assigned staff on new, rescheduled or cancelled booking | Must |
| FR-10.2 | Push reminder to staff before the day starts (today's list) | Should |
| FR-10.3 | Reminder list in app: "Remind tomorrow's customers" with one-tap pre-filled WhatsApp messages | Must |
| FR-10.4 | Automated WhatsApp/SMS reminders 24h and 2h before | Later |

### FR-11 Walk-ins
| ID | Requirement | Priority |
|---|---|---|
| FR-11.1 | Quick add walk-in: select service, system suggests next free resource and slot | Must |
| FR-11.2 | Walk-in recorded with source `walk_in` | Must |

### FR-12 Customers
| ID | Requirement | Priority |
|---|---|---|
| FR-12.1 | Customer auto-created/matched by phone number per business | Must |
| FR-12.2 | Customer list with search; detail shows visit history, no-show count, notes | Must |
| FR-12.3 | Export customers to CSV | Could |

### FR-14 Custom booking fields (per template / business)
| ID | Requirement | Priority |
|---|---|---|
| FR-14.1 | Owner defines extra booking form fields: text, number, select, date, address; required or optional | Must |
| FR-14.2 | Templates pre-fill fields — Real estate: property/listing ref, viewing address, buyer/tenant; Vehicle inspection: plate number, make & model, year, location; Sports: number of players | Must |
| FR-14.3 | Field answers stored per booking (JSONB) and shown in booking detail and staff view | Must |
| FR-14.4 | Search bookings by key field (e.g. plate number, property ref) | Should |

### FR-15 Niche-specific (pilot)
| ID | Requirement | Priority |
|---|---|---|
| FR-15.1 | Real estate: agency owner manages multiple agents; each listing/property can be a resource or a booking field | Must |
| FR-15.2 | Real estate: booking shows viewing address with "Open in Waze / Google Maps" | Must |
| FR-15.3 | Vehicle inspection: after completion, inspector adds result notes and photos to the booking | Should |
| FR-15.4 | Sports: show court availability grid (courts × hours) on public page | Should |
| FR-15.5 | Sports: full prepayment option (100% of price) instead of deposit | Must |

### FR-16 Subscription & trial
| ID | Requirement | Priority |
|---|---|---|
| FR-16.1 | New business gets a 7-day free trial with full features | Must |
| FR-16.2 | Trial countdown shown in owner app; reminders on day 5 and day 7 | Must |
| FR-16.3 | After trial ends without payment: public booking page paused, owner app read-only | Must |
| FR-16.4 | Subscription paid on website via ToyyibPay (not in-app); pilot businesses can be extended manually by admin | Must |

### FR-17 Setup tab per business type
| ID | Requirement | Priority |
|---|---|---|
| FR-17.1 | Setup tab shows three groups: "What customers book" (per template), "Rules" (opening hours, booking rules, payment to confirm, booking form) and "Business" (profile, staff & roles, reminders, plan & billing) | Must |
| FR-17.2 | Template decides which "What customers book" items appear; built from one template config, not separate screens | Must |
| FR-17.3 | Sports: courts, sports & prices, peak hours, booking length / changeover | Must |
| FR-17.4 | Real estate: agents, listings, viewing types, travel time & viewing areas | Must |
| FR-17.5 | Real estate listings: ref, title, area, assigned agent, status (available / under offer / closed), open-for-viewings switch; customers pick a listing when booking | Should |
| FR-17.6 | Vehicle inspection: bays & inspectors, services, mobile inspection (fee, area), checklist & report | Must |
| FR-17.7 | Inspection checklist: sections with checks, result labels (pass / needs attention / fail), report options (WhatsApp PDF, photos, inspector name, review request) | Should |
| FR-17.8 | Workshop: quotes before work, pick-up & drop-off; Salon: stylist schedules, walk-in queue; Other: rename resource label, group bookings | Later |

> Tables: `listings`, `checklist_sections`, `checklist_items`, `inspection_results`, `inspection_item_results` are in `docs/schema.sql` section 7, marked *confirm before migrating* (see open questions).

### FR-18 Added from wireframe review
| ID | Requirement | Priority |
|---|---|---|
| FR-18.1 | In-app notifications list: new/paid booking, payment not completed, cancellation, walk-in by staff, staff joined, trial reminders | Must |
| FR-18.2 | Calendar week view showing how busy each hour is per day; tap opens that day | Should |
| FR-18.3 | First-time Today shows a setup checklist (account, resources & hours, payments, share link, test booking) | Must |
| FR-18.4 | Offline: show last loaded schedule read-only; block changes with a clear banner | Should |
| FR-18.5 | Customer profile: stats (visits, spent, no-shows), notes, history; owner can delete a customer's data on request (PDPA) | Must |
| FR-18.6 | Forgot / reset password by email link (30 min expiry), option to log out other devices | Must |
| FR-18.7 | Customer page states: fully booked with next available times; booking page paused; payment not completed with held-slot countdown | Must |
| FR-18.8 | Staff accept-invite screen; staff schedule and profile (own hours read-only) | Must |
| FR-18.9 | Cancel flow records reason and refund decision (keep / full / partial) and method; refunds paid outside the app | Must |

### FR-19 Payments setup, admin & website
| ID | Requirement | Priority |
|---|---|---|
| FR-19.1 | Owner connects own ToyyibPay: paste User Secret Key, category created automatically, RM 1 test payment; key stored encrypted, never shown to staff or platform admins | Must |
| FR-19.2 | Services list: reorder, show/hide on booking page, archive/restore | Must |
| FR-19.3 | Booking form editor: add/edit/reorder questions (text, number, choice, date, address, phone), required, searchable, show to staff, per service | Must |
| FR-19.4 | Add time off for one resource or all, with clash warning listing affected bookings | Must |
| FR-19.5 | Owner account: profile, change password, notification settings, log out, delete account | Must |
| FR-19.6 | Unpaid booking: resend pay link, record manual payment (cash, DuitNow QR, card, bank transfer); checked-in → completed, extend if next slot is free | Must |
| FR-19.7 | Real estate and inspection flows end with details + confirmation screens | Must |
| FR-19.8 | Platform admin (desktop web, FTech only): list businesses, filter by trial/paying/ended, extend trial with reason, toggle booking page, audit log of every admin action | Must |
| FR-19.9 | Marketing website (responsive) and plan payment page (ToyyibPay, receipt details, optional TIN for LHDN e-Invoice) | Must |

> Tables: `payment_accounts`, `refunds`, `booking_events`, `notifications`, `platform_admins`, `admin_audit_log` are in `docs/schema.sql` (validated on PostgreSQL 16).

### FR-13 Reports
| ID | Requirement | Priority |
|---|---|---|
| FR-13.1 | Today summary: bookings, completed, no-shows, expected revenue | Must |
| FR-13.2 | Date range: bookings per day, revenue, no-show rate, top services | Must |
| FR-13.3 | Resource/staff utilisation (% of available hours booked) | Should |
| FR-13.4 | New vs returning customers | Could |

## 8. Key user flows
The complete navigation is drawn in five flow maps on the design canvas (`docs/wireframes/Flow-1…5`). Screen IDs below match `docs/wireframes/README.md`.

**Owner onboarding** (Flow 1)
1. Website or app → Sign-up 1/3 account (O1a) → 2/3 business name, link, business type (O1b) → 3/3 resources, hours, services, payment rule pre-filled from the template (O1c, six versions)
2. First-time Today (D8) shows the setup checklist: connect ToyyibPay (H1), share booking link (O7), make a test booking
3. Trial banner → Choose a plan (E3) → pay on the website (I4); when the trial ends without payment → paywall (E4) and booking page paused (F3)

**Customer booking (with deposit)**
1. Scan QR or tap link → choose service → choose resource or "any"
2. Pick date and time → enter name + phone
3. Pay deposit (FPX/DuitNow) → booking confirmed → confirmation page
4. Owner/staff receive push notification

**Day of service (staff)** (Flow 5)
1. Accept invite (G1) or log in (O0) → Today (S1)
2. Customer arrives → Check in → Complete (or mark No-show); collect balance and record payment (S2)

**Owner daily work** (Flow 2): Today → new booking / walk-in / reminders / notifications; Calendar → unpaid booking (H7, resend link or record payment) → checked in (H8) → completed; Bookings → booking detail → reschedule (D3) / cancel & refund (D4) / customer profile (D11).

**Setup** (Flow 3): one Setup screen per business type; rows open services (H2 → O5), resources & time off (O6 → H5), booking form (H3 → H4), payments (H1), staff (D12 → G1), profile (E5), rules (E6), plan (E3), account (H6).

## 9. Business rules
| ID | Rule |
|---|---|
| BR-01 | A resource cannot have overlapping active bookings (pending, confirmed, checked_in). |
| BR-02 | Booking end time = start + service duration; the buffer blocks the resource but is not shown to the customer. |
| BR-03 | Customers cannot book inside the advance-notice window or beyond max days ahead. |
| BR-04 | Pending (unpaid) bookings expire after the configured time and are set to `cancelled` with reason `payment_timeout`. |
| BR-05 | Customers cannot cancel online after the cancellation cut-off; owner can always cancel. |
| BR-06 | Customer identity per business = phone number (E.164). |
| BR-07 | All amounts stored in sen (integer), currency MYR. |
| BR-08 | Archived services/resources are hidden from booking but kept for history. |

## 10. Non-functional requirements
| Area | Requirement |
|---|---|
| Security | All data access through the API; every query scoped by the user's business_id (tested); no secrets or DB credentials in the app; passwords and sessions handled by Better Auth; ToyyibPay secret keys encrypted at rest (AES-256-GCM) and never returned to any client; platform admin actions require a reason and are written to an audit log |
| Privacy | PDPA-compliant privacy notice and consent at sign-up; collect minimum customer data (name, phone); owners can erase a customer's personal data on request (history kept, anonymised) |
| Performance | Booking page first load < 3 s on 4G; slot lookup < 1 s |
| Availability | Local Docker Postgres in development; Supabase-managed Postgres (Singapore) for staging/production with daily backups; schema kept portable (plain Postgres 16) |
| Usability | Owner can set up in < 15 min without training; large tap targets; works on mid-range Android |
| Localisation | English first; strings centralised for Bahasa Malaysia later; MYR; Asia/Kuala_Lumpur |
| Offline | App shows last loaded schedule when offline (read-only) |
| Observability | Error tracking (Sentry); webhook and payment logs |

## 11. Data model (summary)
See `docs/SCHEMA.md` (ERD and table guide) and `docs/schema.sql` (full DDL). Integer primary/foreign keys; public links use slug and random booking tokens. 32 tables. Main entities: businesses, business_members, staff_invitations, subscriptions, branches, resources, services, service_price_rules, resource_services, working_hours, time_off, booking_fields, customers, bookings, booking_attachments, payments, refunds, payment_accounts, booking_events, notifications, platform_admins, admin_audit_log; pilot extras (confirm first): listings, checklist_sections, checklist_items, inspection_results, inspection_item_results.

## 12. Pricing (draft, post-pilot)
| Plan | Price | Limits |
|---|---|---|
| Free trial | RM0 for 7 days | All features; no card required |
| Starter | RM49/month | Up to 3 resources, unlimited bookings, deposits |
| Business | RM99/month | Up to 10 resources, reports, staff app |
| Extra resource | RM10/month each | — |

Eligible for the MSME Digital Grant once registered as an approved solution provider.

## 13. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Owners keep using WhatsApp out of habit | One-tap WhatsApp from every booking; make booking link easy to share in WhatsApp Business profile |
| Generic product feels "not for my business" | Business templates + custom labels; niche-specific landing pages |
| Payment gateway onboarding delays | Start with ToyyibPay sandbox (dev.toyyibpay.com); deposits optional in MVP |
| Three very different pilot niches stretch the MVP | Shared core engine; niche differences handled by templates, custom fields and duration options, not separate code |
| Competition from niche-specific players | Lower price, any-niche flexibility, local support, bundle with MYPOS/OutletIQ |
| Double bookings from race conditions | Database exclusion constraint, not only app logic |

## 14. Release plan
| Milestone | Target |
|---|---|
| Phase 1–3 (foundation, setup, booking engine) — local Postgres | Weeks 1–3 |
| Phase 4–5 (public booking page, ToyyibPay per business, manual payments, jobs) | Weeks 4–5 |
| Phase 6 (staff app, customers, reports, trial & plans, pilot niche extras) | Week 6 |
| Phase 7 (platform admin, website, move to Supabase + staging) | Week 7 |
| Phase 8 Play Store internal/closed testing + pilots | Week 8 |
| Paid launch | After 1–2 month pilot |

## 15. Decisions & open questions

**Decided**
| Topic | Decision |
|---|---|
| Product name | OutletBooking |
| Payment gateway | ToyyibPay first |
| Free offering | 7-day free trial (no permanent free plan at launch) |
| Pilot niches | Real estate viewing, vehicle inspection, sports booking |
| Customer payments | Each business connects its **own ToyyibPay account**; money goes straight to them. OutletBooking never holds customer money |

**Still open**
- Listings (real estate) and inspection checklist & report: in the MVP? Tables are designed (`schema.sql` section 7); if not, real estate uses a "property ref" booking question and inspection uses result notes + photos only.
- Plan renewal: automatic recurring charge or manual renewal with reminder? (Web billing page shows a placeholder.)
- Domain: check and register (e.g. outletbooking.my / outletbooking.com) and secure the app name on Play Store
- Pilot businesses: identify 1–2 per niche (agency, inspection centre, sports centre)
- Real estate: is the resource the agent or the property? (Recommended: agent as resource, property as booking field)
- Vehicle inspection: offer mobile inspection at MVP or on-site only?
- Sports: peak/off-peak pricing needed at MVP?

## 16. Screens & flows
- **74 screens** in `docs/wireframes/` with IDs, descriptions and build phase in `docs/wireframes/README.md` (customer page, owner app, staff app, sign-up and Setup per business type, platform admin, website).
- **5 flow maps** (`Flow-1-Account`, `Flow-2-Daily`, `Flow-3-Setup`, `Flow-4-Customer`, `Flow-5-Staff`) show how screens connect; use them for Expo Router routes.
- Screens that differ by business type (sign-up step 3, Setup tab) are built as **one screen driven by the template config**, never one screen per niche.
