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

## Going live (Phase 8)

Set `TOYYIBPAY_BASE_URL=https://toyyibpay.com` and `API_PUBLIC_URL=<production API URL>`. Each business then reconnects with its **live** User Secret Key.
