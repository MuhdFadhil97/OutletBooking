# Wireframes — OutletBooking

Approved mid-fidelity screens from the design canvas — **74 screens + 5 flow maps**. Each file is an HTML reference (390×844 phone frame; taller boards scroll; I1–I4 are desktop pages for `apps/web`); rebuild the mobile ones as React Native screens in `apps/mobile`. Read the markup for layout, copy, spacing and colours. Ignore the `<x-dc>`, `<helmet>`, `support.js` and `data-dc-script` parts — they belong to the design tool.


## Flow maps (start here)
Five boards show how the screens connect — each card has the screen ID used in the table below:
`Flow-1-Account` (getting in, first run, paying, admin) · `Flow-2-Daily` (Today, Calendar, Bookings) · `Flow-3-Setup` (Setup tab) · `Flow-4-Customer` (booking page by business type) · `Flow-5-Staff` (staff app). Use them to plan Expo Router routes and navigation.

| ID | File | Screen | Niche shown | Built in phase |
|---|---|---|---|---|
| C1 | Main.dc.html | Customer · Choose service | Sports | 4 |
| C2 | Customer-Court.dc.html | Customer · Court × time grid, 1/2/3-hour choice | Sports | 4 |
| C3 | Customer-Details.dc.html | Customer · Details & pay (ToyyibPay) | Sports | 4–5 |
| C4 | Customer-Confirmed.dc.html | Customer · Confirmed | Sports | 4 |
| C5 | Customer-Inspection.dc.html | Customer · Vehicle inspection details (custom fields, mobile location, deposit) | Vehicle inspection | 4 |
| C6 | Customer-Viewing.dc.html | Customer · Property viewing request (agent, slot, buyer/tenant) | Real estate | 4 |
| O0 | Owner-Login.dc.html | Log in (owner & staff) | All | **1** |
| O1a | Owner-Signup-Account.dc.html | Sign-up 1/3 · account (name, email, mobile, password, PDPA consent) | All | **1** |
| O1b | Owner-Signup.dc.html | Sign-up 2/3 · business name, booking link, template | Sports | **1** |
| O1c | Owner-Signup-Setup.dc.html | Sign-up 3/3 · courts & hours, starter services, payment rule (pre-filled from template) | Sports | **2** (UI shell in 1, "Skip for now" works) |
| O1c-RE | Owner-Signup-Setup-RealEstate.dc.html | Sign-up 3/3 · agents, viewing types, travel time between viewings, hours, no payment | Real estate | 2 |
| O1c-VI | Owner-Signup-Setup-Inspection.dc.html | Sign-up 3/3 · bays, mobile inspection (fee, area), services, booking fields (plate etc.), deposit | Vehicle inspection | 2 |
| O1c-WS | Owner-Signup-Setup-Workshop.dc.html | Sign-up 3/3 · bays, jobs ("from" prices), booking fields, hours, pay at workshop | Workshop | 2 |
| O1c-SA | Owner-Signup-Setup-Salon.dc.html | Sign-up 3/3 · stylists, customers pick a stylist toggle, services, hours, pay at shop | Barber / Salon | 2 |
| O1c-OT | Owner-Signup-Setup-Other.dc.html | Sign-up 3/3 · name what is booked (Room/Doctor/Teacher…), count, first service, hours | Other | 2 |

**Step 3 is one screen driven by the template, not six separate screens in code.** Build one `SetupStep` that reads the selected template's config (resource label, default count, sections to show: people list vs counter, mobile/location options, travel buffer, booking fields, starter services, hours, default payment rule). The six wireframes show what each config produces. Boards taller than 844 px scroll on the phone.
| O2 | Owner-Today.dc.html | Today dashboard (trial banner, KPIs, quick actions, up next) | Sports | **1** (shell), 3 (data) |
| O3 | Owner-Calendar.dc.html | Calendar · day by court | Sports | 3 |
| O4 | Owner-Booking.dc.html | Booking detail | Vehicle inspection | 3 |
| O5 | Owner-Service.dc.html | Edit service & pricing (duration options, peak rules, payment rule) | Sports | 2 |
| O6 | Owner-Resources.dc.html | Courts & working hours, time off | Sports | 2 |
| O7 | Owner-Share.dc.html | Share link & QR | Sports | 4 |
| O8 | Owner-Reports.dc.html | Reports | Sports | 6 |
| O9 | Owner-Bookings.dc.html | Bookings list · search by customer name | Vehicle inspection | 3 |
| ST | Owner-Setup.dc.html | Setup tab · Sports courts (courts, sports & prices, peak hours, booking length) | Sports | 2 |
| ST-RE | Owner-Setup-RealEstate.dc.html | Setup tab · agents, listings, viewing types, travel time & areas | Real estate | 2 (listings 6) |
| ST-RE-L | Owner-Setup-Listings.dc.html | Listings · search, status, open for viewings switch | Real estate | 6 |
| ST-VI | Owner-Setup-Inspection.dc.html | Setup tab · bays & inspectors, services, mobile inspection, checklist & report | Vehicle inspection | 2 (checklist 6) |
| ST-VI-C | Owner-Setup-Checklist.dc.html | Checklist sections, result labels, report options (WhatsApp PDF, photos) | Vehicle inspection | 6 |
| ST-WS | Owner-Setup-Workshop.dc.html | Setup tab · bays, jobs, quotes before work, pick-up & drop-off | Workshop | 2 / later |
| ST-SA | Owner-Setup-Salon.dc.html | Setup tab · stylists, services, stylist schedules, walk-in queue | Barber / Salon | 2 / later |
| ST-OT | Owner-Setup-Other.dc.html | Setup tab · rename what is booked, group bookings | Other | 2 / later |

**Setup tab is also one screen driven by the template.** Three groups: "What customers book" (changes per type — items tagged "Only for this type" exist only for that template), "Rules" and "Business" (the same for every type). Build it from the template config, like sign-up step 3.
| D1 | Owner-NewBooking.dc.html | New booking: find/add customer, service, length, date, free court & time, payment, WhatsApp confirm | Sports | 3 |
| D2 | Owner-Walkin.dc.html | Walk-in now: next free resource suggested, optional name/mobile, pay now | Sports | 5 |
| D3 | Owner-Reschedule.dc.html | Reschedule: new date, inspector, slot, deposit carries over, notify | Vehicle inspection | 3 |
| D4 | Owner-Cancel.dc.html | Cancel: reason, keep deposit / full / partial refund, refund method, notify | Vehicle inspection | 3 |
| D5 | Owner-Reminders.dc.html | Remind tomorrow's customers: message template, progress, one-tap WhatsApp | Sports | 5 |
| D6 | Owner-Notifications.dc.html | Notifications (new paid, payment not completed, cancelled, walk-in, staff joined, trial) | Sports | 4 |
| D7 | Owner-CalendarWeek.dc.html | Calendar week view: busy grid by hour × day | Sports | 3 |
| D8 | Owner-TodayEmpty.dc.html | First-time Today: 5-step setup checklist, empty state | Sports | 1–2 |
| D9 | Owner-States.dc.html | Offline banner (read-only), "slot just taken" error, toast with undo | All | all phases |
| D10 | Owner-Customers.dc.html | Customers list: search, Regulars / New / No-shows (from Bookings header) | Sports | 6 |
| D11 | Owner-Customer.dc.html | Customer profile: call/WhatsApp/book, stats, notes, history, PDPA delete | Sports | 6 |
| D12 | Owner-Staff.dc.html | Staff & roles: list, invite (role, linked resource, permissions) | Sports | 2 |
| E1 | Owner-Forgot.dc.html | Forgot password | All | 1 |
| E2 | Owner-Reset.dc.html | Set new password (from email link) | All | 1 |
| E3 | Owner-Plans.dc.html | Choose a plan (opens website to pay) | Sports | 6 |
| E4 | Owner-TrialEnded.dc.html | Trial ended paywall (booking page paused, data safe, view only) | All | 6 |
| E5 | Owner-Profile.dc.html | Business profile (logo, name, link, phones, address, about) | Sports | 2 |
| E6 | Owner-Rules.dc.html | Booking rules (start times, notice, max days, unpaid hold, cancel cut-off, deposit) | All | 2 |
| F1 | Customer-DateTime.dc.html | Date & time picker for non-court niches (inspector, morning/afternoon slots) | Vehicle inspection | 4 |
| F2 | Customer-NoSlots.dc.html | Fully booked day with next available times | Sports | 4 |
| F3 | Customer-Paused.dc.html | Booking page paused (trial ended / owner turned off) | All | 6 |
| F4 | Customer-PayFailed.dc.html | Payment not completed, slot held countdown, retry | Sports | 5 |
| F5 | Customer-Manage.dc.html | View / cancel my booking (from confirmation link) | Sports | 4 |
| G1 | Staff-Invite.dc.html | Staff accepts invite and sets password | Real estate | 2 |
| G2 | Staff-Schedule.dc.html | Staff schedule by day, day off | Real estate | 6 |
| G3 | Staff-Profile.dc.html | Staff profile, own hours (read-only), notifications, log out | Real estate | 6 |
| H1 | Owner-Payments.dc.html | Payments: connect own ToyyibPay (secret key, auto category, RM 1 test), payment-to-confirm rule | All | 5 |
| H2 | Owner-Services.dc.html | Services list: reorder, show/hide, archived, add | Sports | 2 |
| H3 | Owner-BookingForm.dc.html | Booking form: fixed name/mobile + custom questions | Vehicle inspection | 2 |
| H4 | Owner-BookingField.dc.html | Edit question: type, hint, required, searchable, show to staff, which services, preview | Vehicle inspection | 2 |
| H5 | Owner-TimeOff.dc.html | Add time off: who, reason, dates, all day, yearly, clash warning | Sports | 2 |
| H6 | Owner-Account.dc.html | My account (from Setup avatar): details, password, notifications, help, log out, delete | All | 1–2 |
| H7 | Owner-BookingUnpaid.dc.html | Unpaid booking: hold countdown, resend pay link, record payment sheet | Sports | 5 |
| H8 | Owner-BookingCheckedIn.dc.html | Checked in: status timeline, mark completed, extend 1 hour | Sports | 3 |
| C6b | Customer-ViewingDetails.dc.html | Viewing step 3: details, budget, message, WhatsApp consent | Real estate | 4 |
| C6c | Customer-ViewingConfirmed.dc.html | Viewing booked | Real estate | 4 |
| C5c | Customer-InspectionConfirmed.dc.html | Inspection booked (deposit paid, balance, report on WhatsApp) | Vehicle inspection | 4–5 |
| I1 | Admin-Businesses.dc.html | Platform admin: all businesses, KPIs, filters, extend trial (desktop web) | Platform | 7 |
| I2 | Admin-Business.dc.html | Platform admin: business detail, extend trial with reason, audit log | Platform | 7 |
| I3 | Web-Landing.dc.html | Website landing page (responsive) | Website | 7 |
| I4 | Web-Billing.dc.html | Website: pay for plan via ToyyibPay, receipt & e-Invoice TIN | Website | 7 |
| S1 | Staff-Today.dc.html | Agent's viewings today (travel buffers, Waze/Maps) | Real estate | 6 |
| S2 | Staff-Job.dc.html | Inspection in progress (result, notes, photos, payment & collect balance) | Vehicle inspection | 6 |

Sample businesses (Smash Arena PJ, SemakAuto Puchong, Laman Realty), names and numbers are placeholders. Bracketed text like `[Property address]` marks content to be replaced by real data.
