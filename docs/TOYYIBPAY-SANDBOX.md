# Testing payments with the ToyyibPay sandbox

Each business connects its **own** ToyyibPay account in the app (Setup → Payments). Customer money goes straight to that account. These steps test the whole flow locally with fake money.

## 1. One-time setup

1. Register a sandbox account at **https://dev.toyyibpay.com** (it acts as the "business" account).
2. In the sandbox dashboard, copy your **User Secret Key**.
3. Check `apps/api/.env` has:
   ```
   TOYYIBPAY_BASE_URL=https://dev.toyyibpay.com
   APP_ENCRYPTION_KEY=<32 random bytes, base64>   # already generated for you; keep it
   ```

## 2. Connect the business (H1)

1. Start the API and the app, then log in as the owner.
2. Go to **Setup → Payments (ToyyibPay)**, paste the User Secret Key, then tap **Connect ToyyibPay**. The app creates the payment category for you.
3. Tap **Run RM 1.00 test payment**, pay it with the sandbox bank simulator, then come back and tap **Check test payment**.

## 3. Customer pays a deposit

1. Set a service to *Deposit* or *Full payment upfront* (Setup → Payment to confirm).
2. Open the booking page (`/book/<your-slug>`), book a slot and you're sent to ToyyibPay.
3. Pay with the sandbox simulator (success or fail):
   - **On success:** ToyyibPay returns you to `/my-booking/<token>`. The app asks the API to re-check the bill, and the booking turns **confirmed**.
   - **On fail:** you see **Payment not completed** with the countdown and **Try again** (F4).

Step 3 works **without a tunnel**, because the return page triggers the re-check.

## 4. Optional: receive ToyyibPay's callback on your laptop

ToyyibPay also POSTs to `/toyyibpay/callback`. That only reaches your laptop through a tunnel.

1. Start a tunnel:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   (Install `cloudflared` from Cloudflare first; `ngrok http 3000` also works.)
2. Copy the `https://….trycloudflare.com` URL it prints into `apps/api/.env` as `API_PUBLIC_URL=…`, then restart the API.
3. New bills now carry that callback URL. In the API log you will see the callback arrive. The API re-checks the bill with `getBillTransactions` before marking it paid, so a fake callback can't confirm a booking.

## 5. Background jobs (pg-boss)

These run inside the API process (`JOBS_ENABLED=true`):

| Job | When (Malaysia time) | What it does |
|---|---|---|
| Expire unpaid bookings | every minute | Bookings not paid within the hold are cancelled (`payment_timeout`) and the owner is notified. If the customer had already paid, it confirms the booking instead |
| Staff day summary | 7:30 AM | Push "Today: N bookings" to each member |
| Trial reminders | 9:00 AM | Owners get "trial ends in 2 days" once, then "trial has ended" once |

pg-boss keeps its tables in the `pgboss` schema of the same Postgres. On Supabase, use the **Session** pooler (5432) for the API process that runs jobs.

## 6. FTech's own account: plan payments on the website

Plan payments (Starter / Business, paid at `/billing`) go to **FTech's own** ToyyibPay account, never to a business's. One-time setup:

1. Create a sandbox account at https://dev.toyyibpay.com (separate from any business account you used for sections 1–3) and note its **User Secret Key**.
2. In that account create a **category** (any name, e.g. `OutletBooking plans`) and note its **category code**.
3. Put both in `apps/api/.env` (never commit them):
   ```
   PLATFORM_TOYYIBPAY_SECRET_KEY=...
   PLATFORM_TOYYIBPAY_CATEGORY_CODE=...
   ```
   Leave them empty and plan payment stays off (the pay page tells owners to WhatsApp FTech).
4. Local website links need `WEBSITE_URL=http://localhost:3001` and the website origin in `TRUSTED_ORIGINS` (already in `.env.example`).
5. Callbacks: like section 4, set `API_PUBLIC_URL` to a tunnel so ToyyibPay can reach `POST /toyyibpay/plan-callback`. Without a tunnel it still works: the page you return to re-checks the bill with ToyyibPay itself.

Try it: sign in to the app as an owner **whose email is confirmed**, open Setup → Plan → Continue (or ask for a sign-in link at `/billing/sign-in`), pick a plan, pay with the sandbox FPX test bank, and you land on the receipt page. The receipt PDF is also emailed to the receipt address.

An owner whose email is not confirmed yet gets the confirmation email instead of a sign-in link (Better Auth would otherwise delete their password login).

## Going live (Phase 8)

Set `TOYYIBPAY_BASE_URL=https://toyyibpay.com` and `API_PUBLIC_URL=<production API URL>`. Each business then reconnects with its **live** User Secret Key.
