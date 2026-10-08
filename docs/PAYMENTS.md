# Payments (ToyyibPay) — how it works and how to test locally

## How money flows
- **Booking payments** use the **business's own ToyyibPay account**. The owner pastes their *User Secret Key* in **Setup → Online payments** (screen H1). The API checks the key by creating the business's payment category with it, then stores the key **encrypted** (AES-256-GCM, `APP_ENCRYPTION_KEY`). Only the last 4 characters are ever shown. Customer money goes straight to the business; OutletBooking never holds it.
- **Plan payments** (Phase 7 website) use **FTech's** account (`PLATFORM_TOYYIBPAY_*`).
- A business that has **not** connected ToyyibPay still takes bookings: they are confirmed straight away and paid at the venue (owner records it in H7).

## Booking payment flow
1. Customer books a service that needs a deposit / full payment → booking is **pending**, slot held for the business's hold time (E6, default 15 min).
2. Customer taps **Pay RM x** → `POST /public/bookings/:token/pay` creates (or reuses) a ToyyibPay bill with the business's key and returns its page.
3. After paying, ToyyibPay:
   - calls `POST {API_PUBLIC_URL}/payments/toyyibpay/callback` (server to server), and
   - sends the customer back to `{APP_PUBLIC_URL}/book/<slug>/b/<token>?status_id=…&billcode=…`, which calls `POST /public/bookings/:token/refresh`.
4. Either way the API **asks ToyyibPay** (`getBillTransactions`) — the callback body is never trusted. Paid → payment `paid`, booking `confirmed` (if *Confirm automatically when paid* is on), `paid` + `confirmed` events, owner notified. Idempotent: repeated callbacks change nothing.
5. Not paid in time → the `expire-unpaid-bookings` job (every minute) re-checks the bill once more, then releases the slot (`cancelled`, reason *Not paid in time*, `expired` event). A payment that still arrives later revives the booking if the slot is free; otherwise the owner is told to refund.

## Testing with the ToyyibPay sandbox on your laptop
ToyyibPay must reach your API for the callback, and `localhost` is not reachable from the internet. Use a tunnel:

1. Create a sandbox account at **https://dev.toyyibpay.com** and copy your **User Secret Key**.
2. In `apps/api/.env`:
   ```
   APP_ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
   TOYYIBPAY_BASE_URL=https://dev.toyyibpay.com
   ```
3. Start a tunnel to the API (pick one):
   - Cloudflare: `cloudflared tunnel --url http://localhost:3000` → prints `https://xxxx.trycloudflare.com`
   - ngrok: `ngrok http 3000` → prints `https://xxxx.ngrok-free.app`
4. Put that URL in `apps/api/.env` as `API_PUBLIC_URL=https://xxxx.trycloudflare.com` and restart the API (`pnpm --filter api dev`).
5. In the app: **Setup → Online payments** → paste the key → **Connect ToyyibPay** → **Run RM 1.00 test payment** → pay with the sandbox bank simulator → **Check test payment**.
6. Book a paid service on the booking page (`http://localhost:8081/book/<your-link>`), tap **Pay**, pay in the simulator. The page comes back confirmed and the owner gets a "New booking · paid" notification.

Without a tunnel everything still works except the server-to-server callback: the customer's return to the booking page (and the expiry job) re-check the bill instead.

> Check in the sandbox (we could not reach ToyyibPay from the build machine): the amount on the ToyyibPay page must match the booking (we send `billAmount` in **sen**, e.g. 1000 = RM 10.00). If it shows 100× too much or too little, tell us.

## Background jobs (pg-boss)
Started with the API (`JOBS_ENABLED=true`, default). Tables live in the `pgboss` schema.

| Job | When | What |
|---|---|---|
| `expire-unpaid-bookings` | every minute | release unpaid pending bookings past their hold |
| `day-summary` | hourly, sends at 7 AM business time | push "Today: n bookings, first at …" to members with the app |
| `trial-reminders` | hourly | owners: "Free trial ends in 2 days", then "Your free trial has ended" (once each) |

On Supabase, pg-boss needs a **session** connection: set `JOBS_DATABASE_URL` to the Session pooler URL (port 5432).
