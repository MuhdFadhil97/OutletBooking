# PRD — OutletBooking (Booking & Appointment SaaS)

| Item | Detail |
|---|---|
| Product | **OutletBooking** — multi-tenant booking & appointment SaaS (mobile-first) |
| Pilot niches | Real estate viewing, vehicle inspection, sports court booking |
| Payment gateway | ToyyibPay (FPX / DuitNow) |
| Trial | 7-day free trial |
| Market | Malaysian SMEs — any service business that takes appointments |
| Platforms | Android & iOS app (owner/staff), web booking page (customer) |
| Stack | Expo app + Hono API + PostgreSQL (local Docker first; Supabase as managed Postgres for staging/production) — see `CLAUDE.md` |
| Version | 1.0 (MVP) |
| Owner | Muhammad Fadhil — FTech IT Consulting Sdn Bhd |
| Status | Draft |

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

### 6.2 Out of scope (MVP) — planned later
- In-app subscription billing (billed on website after pilot)
- Automated WhatsApp Cloud API messages
- Customer mobile app / customer accounts
- Packages, memberships, loyalty points (OutletIQ integration)
- POS checkout (MYPOS integration), LHDN e-Invoice
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

### FR-13 Reports
| ID | Requirement | Priority |
|---|---|---|
| FR-13.1 | Today summary: bookings, completed, no-shows, expected revenue | Must |
| FR-13.2 | Date range: bookings per day, revenue, no-show rate, top services | Must |
| FR-13.3 | Resource/staff utilisation (% of available hours booked) | Should |
| FR-13.4 | New vs returning customers | Could |

## 8. Key user flows

**Owner onboarding**
1. Download app → Sign up → Business name, phone, template, slug
2. Review pre-filled services → edit price/duration
3. Add resources → set working hours
4. Share booking link / print QR → done

**Customer booking (with deposit)**
1. Scan QR or tap link → choose service → choose resource or "any"
2. Pick date and time → enter name + phone
3. Pay deposit (FPX/DuitNow) → booking confirmed → confirmation page
4. Owner/staff receive push notification

**Day of service (staff)**
1. Open app → Today list
2. Customer arrives → Check in → Complete (or mark No-show)

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
| Security | All data access through the API; every query scoped by the user's business_id (tested); no secrets or DB credentials in the app; passwords and sessions handled by Better Auth |
| Privacy | PDPA-compliant privacy notice; collect minimum customer data (name, phone) |
| Performance | Booking page first load < 3 s on 4G; slot lookup < 1 s |
| Availability | Local Docker Postgres in development; Supabase-managed Postgres (Singapore) for staging/production with daily backups; schema kept portable (plain Postgres 16) |
| Usability | Owner can set up in < 15 min without training; large tap targets; works on mid-range Android |
| Localisation | English first; strings centralised for Bahasa Malaysia later; MYR; Asia/Kuala_Lumpur |
| Offline | App shows last loaded schedule when offline (read-only) |
| Observability | Error tracking (Sentry); webhook and payment logs |

## 11. Data model (summary)
See `docs/SCHEMA.md` (ERD and table guide) and `docs/schema.sql` (full DDL). Integer primary/foreign keys; public links use slug and random booking tokens. Main entities: businesses, business_members, subscriptions, branches, resources, services, service_price_rules, resource_services, working_hours, time_off, booking_fields, customers, bookings, booking_attachments, payments.

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
| Phase 4–5 (public page, payments, jobs) | Weeks 4–5 |
| Phase 6 (niche features, reports, trial) | Week 6 |
| Phase 7 (move to Supabase + staging) | Week 7 |
| Play Store internal/closed testing + pilots | Week 8 |
| Paid launch | After 1–2 month pilot |

## 15. Decisions & open questions

**Decided**
| Topic | Decision |
|---|---|
| Product name | OutletBooking |
| Payment gateway | ToyyibPay first |
| Free offering | 7-day free trial (no permanent free plan at launch) |
| Pilot niches | Real estate viewing, vehicle inspection, sports booking |

**Still open**
- Domain: check and register (e.g. outletbooking.my / outletbooking.com) and secure the app name on Play Store
- Pilot businesses: identify 1–2 per niche (agency, inspection centre, sports centre)
- Real estate: is the resource the agent or the property? (Recommended: agent as resource, property as booking field)
- Vehicle inspection: offer mobile inspection at MVP or on-site only?
- Sports: peak/off-peak pricing needed at MVP?
