-- =====================================================================
-- OutletBooking — Database schema (reference)
-- PostgreSQL 16, portable (works on local Docker Postgres and Supabase)
--
-- Conventions
--   * Primary keys: integer GENERATED ALWAYS AS IDENTITY
--   * Foreign keys: integer
--   * Money: integer sen (MYR)        * Time: timestamptz (UTC)
--   * Enums: text + CHECK (easy to extend in migrations)
--   * Integer IDs are never exposed publicly. Public URLs use
--     businesses.slug and bookings.public_token.
--
-- This file is the reference design. The Drizzle schema in
-- packages/db must produce the same structure via migrations.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =====================================================================
-- 1. AUTH (Better Auth, configured for numeric IDs + snake_case names)
--    Let the Better Auth CLI generate the exact columns; these are the
--    expected core tables.
-- =====================================================================
CREATE TABLE users (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text        NOT NULL,
  email           citext      NOT NULL UNIQUE,
  email_verified  boolean     NOT NULL DEFAULT false,
  image           text,
  phone           text,
  terms_accepted_at timestamptz,         -- PDPA consent at sign-up / accept invite
  terms_version   text,                  -- LEGAL_VERSION agreed to (re-ask when it changes)
  two_factor_enabled boolean  NOT NULL DEFAULT false,   -- Better Auth two-factor plugin (required for platform admins, I6)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);

CREATE TABLE accounts (
  id                        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id                   integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id                text        NOT NULL,
  provider_id               text        NOT NULL,
  password                  text,               -- hashed by Better Auth
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_id_idx ON accounts(user_id);

CREATE TABLE verifications (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier  text        NOT NULL,
  value       text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_identifier_idx ON verifications(identifier);
-- Email sign-in links for the website (I13, M6) use Better Auth's magic-link plugin, stored in verifications.

-- Better Auth two-factor plugin (TOTP + backup codes). Used by platform admins (I6, I29).
CREATE TABLE two_factors (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       integer     NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  secret        text        NOT NULL,      -- encrypted by Better Auth
  backup_codes  text        NOT NULL,      -- encrypted by Better Auth
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text        NOT NULL UNIQUE,
  platform    text        NOT NULL CHECK (platform IN ('android','ios','web')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_id_idx ON push_tokens(user_id);

-- =====================================================================
-- 2. TENANT
-- =====================================================================
CREATE TABLE businesses (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                citext      NOT NULL UNIQUE
                      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,49}$'),
  name                text        NOT NULL,
  template            text        NOT NULL DEFAULT 'other'
                      CHECK (template IN ('real_estate','vehicle_inspection','sports',
                                          'workshop','barber_salon','clinic','tuition','other')),
  phone               text,
  whatsapp_phone      text,
  email               citext,
  address             text,
  description         text,
  logo_key            text,                         -- file key in object storage
  timezone            text        NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  currency            char(3)     NOT NULL DEFAULT 'MYR',
  resource_label      text        NOT NULL DEFAULT 'Resource',  -- "Agent", "Bay", "Court"
  slot_interval_min   integer     NOT NULL DEFAULT 30  CHECK (slot_interval_min BETWEEN 5 AND 240),
  min_advance_min     integer     NOT NULL DEFAULT 60  CHECK (min_advance_min >= 0),
  max_days_ahead      integer     NOT NULL DEFAULT 30  CHECK (max_days_ahead BETWEEN 1 AND 365),
  cancel_cutoff_min   integer     NOT NULL DEFAULT 120 CHECK (cancel_cutoff_min >= 0),
  pending_expiry_min  integer     NOT NULL DEFAULT 15  CHECK (pending_expiry_min BETWEEN 5 AND 1440),
  booking_enabled     boolean     NOT NULL DEFAULT true,   -- false = booking page paused (F3)
  auto_confirm_paid   boolean     NOT NULL DEFAULT true,   -- E6
  customers_can_cancel boolean    NOT NULL DEFAULT true,   -- E6 / F5
  late_cancel_keeps_deposit boolean NOT NULL DEFAULT true, -- E6
  settings            jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- template-specific: mobile fee/area, report options, travel areas…
  -- Platform admin (I2, I26)
  suspended_at        timestamptz,                  -- suspended for misuse: app + booking page locked
  suspend_reason      text,
  close_requested_at  timestamptz,                  -- owner asked to close; data deleted 90 days later
  deletion_notice_sent_at timestamptz,              -- M7 sent
  deletion_due_at     timestamptz,                  -- daily job deletes tenant data on/after this date
  deletion_hold_reason text,                        -- set = deletion paused by an admin
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,                  -- tenant data deleted; row kept (name only) for FTech's receipts
  CHECK ((suspended_at IS NULL) = (suspend_reason IS NULL))
);
CREATE INDEX businesses_deletion_due_idx ON businesses(deletion_due_at) WHERE deletion_due_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE business_members (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('owner','staff')),
  can_view_all boolean     NOT NULL DEFAULT false,   -- staff may see all bookings
  can_take_payments boolean NOT NULL DEFAULT true,   -- record cash / DuitNow / card (D12, S2, H7)
  can_edit_setup boolean    NOT NULL DEFAULT false,  -- services, prices, hours (D12)
  is_active    boolean     NOT NULL DEFAULT true,
  notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,  -- G3 push switches {"newBookings","changes","daySummary"}; missing = on
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);
CREATE INDEX business_members_user_id_idx ON business_members(user_id);

CREATE TABLE staff_invitations (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email        citext      NOT NULL,
  resource_id  integer,                                   -- FK added below
  role         text        NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  can_view_all boolean     NOT NULL DEFAULT false,
  can_take_payments boolean NOT NULL DEFAULT true,
  can_edit_setup boolean   NOT NULL DEFAULT false,
  token        text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by   integer     NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_invitations_business_id_idx ON staff_invitations(business_id);

CREATE TABLE subscriptions (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id           integer     NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  plan                  text        NOT NULL DEFAULT 'trial'
                        CHECK (plan IN ('trial','starter','business')),
  status                text        NOT NULL DEFAULT 'trialing'
                        CHECK (status IN ('trialing','active','past_due','expired','cancelled')),
  resource_limit        integer     NOT NULL DEFAULT 10,
  trial_ends_at         timestamptz NOT NULL DEFAULT now() + interval '7 days',
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  free_until            timestamptz,         -- free months given by an admin (I2); no payment created
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 3. SETUP
-- =====================================================================
CREATE TABLE branches (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  address      text,
  phone        text,
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
CREATE INDEX branches_business_id_idx ON branches(business_id);

CREATE TABLE resources (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id    integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id      integer,
  name           text        NOT NULL,
  resource_type  text        NOT NULL
                 CHECK (resource_type IN ('staff','bay','court','room','property','other')),
  user_id        integer     REFERENCES users(id) ON DELETE SET NULL,  -- linked staff login
  color          text,
  sort_order     integer     NOT NULL DEFAULT 0,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, branch_id) REFERENCES branches(business_id, id)
);
CREATE INDEX resources_business_id_idx ON resources(business_id);
CREATE INDEX resources_user_id_idx ON resources(user_id);

ALTER TABLE staff_invitations
  ADD FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE SET NULL;

CREATE TABLE services (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id        integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name               text        NOT NULL,
  description        text,
  duration_min       integer     NOT NULL CHECK (duration_min BETWEEN 5 AND 1440),
  duration_options   integer[],               -- e.g. {60,120,180}; NULL = fixed duration
  price_unit         text        NOT NULL DEFAULT 'per_booking'
                     CHECK (price_unit IN ('per_booking','per_block')),  -- per_block = per duration_min block
  price_sen          integer     NOT NULL DEFAULT 0 CHECK (price_sen >= 0),
  deposit_sen        integer     NOT NULL DEFAULT 0 CHECK (deposit_sen >= 0),
  prepay_full        boolean     NOT NULL DEFAULT false,
  buffer_min         integer     NOT NULL DEFAULT 0 CHECK (buffer_min >= 0),
  travel_buffer_min  integer     NOT NULL DEFAULT 0 CHECK (travel_buffer_min >= 0),
  location_type      text        NOT NULL DEFAULT 'at_business'
                     CHECK (location_type IN ('at_business','at_customer_location')),
  is_visible         boolean     NOT NULL DEFAULT true,
  sort_order         integer     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (business_id, id)
);
CREATE INDEX services_business_id_idx ON services(business_id);

CREATE TABLE service_price_rules (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id   integer     NOT NULL,
  name         text        NOT NULL DEFAULT 'Peak',
  weekday      smallint    NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  price_sen    integer     NOT NULL CHECK (price_sen >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  FOREIGN KEY (business_id, service_id) REFERENCES services(business_id, id) ON DELETE CASCADE
);
CREATE INDEX service_price_rules_service_id_idx ON service_price_rules(service_id);

CREATE TABLE resource_services (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  resource_id  integer     NOT NULL,
  service_id   integer     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, service_id),
  FOREIGN KEY (business_id, resource_id) REFERENCES resources(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, service_id)  REFERENCES services(business_id, id)  ON DELETE CASCADE
);
CREATE INDEX resource_services_service_id_idx ON resource_services(service_id);

CREATE TABLE working_hours (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  resource_id  integer     NOT NULL,
  weekday      smallint    NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  FOREIGN KEY (business_id, resource_id) REFERENCES resources(business_id, id) ON DELETE CASCADE
);
CREATE INDEX working_hours_resource_weekday_idx ON working_hours(resource_id, weekday);

CREATE TABLE time_off (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  resource_id  integer,                    -- NULL = whole business closed (public holiday)
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at),
  FOREIGN KEY (business_id, resource_id) REFERENCES resources(business_id, id) ON DELETE CASCADE
);
CREATE INDEX time_off_business_range_idx ON time_off(business_id, start_at, end_at);

CREATE TABLE booking_fields (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  service_id   integer,                    -- NULL = applies to all services
  field_key    text        NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{1,39}$'),  -- e.g. plate_number
  label        text        NOT NULL,       -- e.g. "Plate number"
  field_type   text        NOT NULL
               CHECK (field_type IN ('text','number','select','date','address','phone')),
  options      jsonb,                      -- for select: ["Buyer","Tenant"]
  is_required  boolean     NOT NULL DEFAULT false,
  is_searchable boolean    NOT NULL DEFAULT false,  -- plate number, property ref
  show_to_staff boolean    NOT NULL DEFAULT true,
  hint         text,                       -- placeholder, e.g. "e.g. WXY 1234"
  sort_order   integer     NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, service_id) REFERENCES services(business_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX booking_fields_key_uidx
  ON booking_fields(business_id, COALESCE(service_id, 0), field_key);

-- =====================================================================
-- 4. CUSTOMERS & BOOKINGS
-- =====================================================================
CREATE TABLE customers (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  phone        text        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),  -- E.164; NULL after PDPA erase
  email        citext,
  notes        text,
  anonymized_at timestamptz,               -- PDPA erase (D11): name → 'Deleted customer', phone/email/notes → NULL
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  UNIQUE (business_id, phone),
  UNIQUE (business_id, id)
);

CREATE TABLE bookings (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_token       text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  business_id        integer     NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id          integer,
  resource_id        integer     NOT NULL,
  service_id         integer     NOT NULL,
  customer_id        integer     NOT NULL,

  start_at           timestamptz NOT NULL,   -- shown to customer
  end_at             timestamptz NOT NULL,
  blocked_start_at   timestamptz NOT NULL,   -- start_at - travel buffer (set by API)
  blocked_end_at     timestamptz NOT NULL,   -- end_at + buffer/travel buffer (set by API)
  duration_min       integer     NOT NULL CHECK (duration_min > 0),

  status             text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','checked_in','completed','cancelled','no_show')),
  source             text        NOT NULL DEFAULT 'web'
                     CHECK (source IN ('web','app','walk_in')),
  price_sen          integer     NOT NULL DEFAULT 0 CHECK (price_sen >= 0),
  amount_due_sen     integer     NOT NULL DEFAULT 0 CHECK (amount_due_sen >= 0),  -- deposit or full
  payment_status     text        NOT NULL DEFAULT 'not_required'
                     CHECK (payment_status IN ('not_required','unpaid','paid','refunded')),

  location_address   text,                   -- property viewing / mobile inspection
  custom_fields      jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- {"plate_number":"WXY1234"}
  customer_notes     text,
  internal_notes     text,
  result_notes       text,                   -- inspection result, etc.

  expires_at         timestamptz,            -- pending payment expiry
  reminder_sent_at   timestamptz,            -- D5 remind tomorrow's customers
  confirmed_at       timestamptz,
  checked_in_at      timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_by_user_id integer     REFERENCES users(id) ON DELETE SET NULL,  -- NULL = customer (web)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CHECK (end_at > start_at),
  CHECK (blocked_start_at <= start_at AND blocked_end_at >= end_at),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, branch_id)   REFERENCES branches(business_id, id),
  FOREIGN KEY (business_id, resource_id) REFERENCES resources(business_id, id),
  FOREIGN KEY (business_id, service_id)  REFERENCES services(business_id, id),
  FOREIGN KEY (business_id, customer_id) REFERENCES customers(business_id, id),

  -- No double booking: same resource, overlapping blocked time, active status
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(blocked_start_at, blocked_end_at, '[)') WITH &&
  ) WHERE (status IN ('pending','confirmed','checked_in'))
);
CREATE INDEX bookings_business_start_idx ON bookings(business_id, start_at);
CREATE INDEX bookings_resource_start_idx ON bookings(resource_id, start_at);
CREATE INDEX bookings_customer_idx       ON bookings(customer_id);
CREATE INDEX bookings_pending_expiry_idx ON bookings(expires_at) WHERE status = 'pending';
CREATE INDEX bookings_custom_fields_gin  ON bookings USING gin (custom_fields jsonb_path_ops);

CREATE TABLE booking_attachments (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id          integer     NOT NULL,
  file_key            text        NOT NULL,      -- object storage key
  content_type        text        NOT NULL,
  caption             text,
  uploaded_by_user_id integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE CASCADE
);
CREATE INDEX booking_attachments_booking_idx ON booking_attachments(booking_id);

-- =====================================================================
-- 5. PAYMENTS, REFUNDS, EVENTS & NOTIFICATIONS
-- =====================================================================
CREATE TABLE payments (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id      integer     NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  booking_id       integer,
  subscription_id  integer     REFERENCES subscriptions(id) ON DELETE RESTRICT,
  purpose          text        NOT NULL
                   CHECK (purpose IN ('deposit','full_payment','balance','subscription')),
  provider         text        NOT NULL DEFAULT 'toyyibpay'
                   CHECK (provider IN ('toyyibpay','manual')),   -- manual = recorded by owner/staff (H7, S2, D2)
  method           text        CHECK (method IN ('fpx','duitnow','card','cash','duitnow_qr','bank_transfer')),
  recorded_by_user_id integer  REFERENCES users(id) ON DELETE SET NULL,
  bill_code        text        UNIQUE,          -- ToyyibPay BillCode
  amount_sen       integer     NOT NULL CHECK (amount_sen > 0),
  status           text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','failed','expired','refunded')),
  transaction_ref  text,                         -- ToyyibPay transaction id
  paid_at          timestamptz,
  raw_callback     jsonb,
  receipt_no       text        UNIQUE,          -- plan payments only: OB-2026-000123 from receipt_no_seq (I15, I17, M4)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  CHECK ((booking_id IS NOT NULL) <> (subscription_id IS NOT NULL)),
  CHECK (receipt_no IS NULL OR purpose = 'subscription'),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_booking_idx ON payments(booking_id);
CREATE INDEX payments_business_idx ON payments(business_id, created_at);
CREATE SEQUENCE receipt_no_seq;   -- API: 'OB-' || year || '-' || lpad(nextval('receipt_no_seq')::text, 6, '0') when a plan payment is paid

-- Refunds are paid outside the app and only recorded here.
--   Booking refunds (D4): by the business to its customer; booking_id set.
--   Plan refunds (I24): by FTech to the business; payment_id = the plan payment, booking_id NULL.
CREATE TABLE refunds (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         integer     NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  booking_id          integer,
  payment_id          integer,
  amount_sen          integer     NOT NULL CHECK (amount_sen > 0),
  method              text        NOT NULL CHECK (method IN ('bank_transfer','duitnow','cash')),
  reason              text,
  reason_code         text        CHECK (reason_code IN ('charged_twice','not_applied','first_payment_guarantee','cancellation','other')),
  bank_ref            text,
  paid_on             date,
  recorded_by_user_id integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (booking_id IS NOT NULL OR payment_id IS NOT NULL),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id, payment_id) REFERENCES payments(business_id, id) ON DELETE RESTRICT
);
CREATE INDEX refunds_booking_idx ON refunds(booking_id);
CREATE INDEX refunds_payment_idx ON refunds(payment_id);

-- Each business connects its OWN ToyyibPay account (H1). Money goes straight to the business.
CREATE TABLE payment_accounts (
  id                    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id           integer     NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  provider              text        NOT NULL DEFAULT 'toyyibpay' CHECK (provider IN ('toyyibpay')),
  secret_key_encrypted  text,                 -- AES-256-GCM in the API with APP_ENCRYPTION_KEY; never returned to clients
  secret_key_last4      text,
  category_code         text,                 -- created automatically on connect
  status                text        NOT NULL DEFAULT 'not_connected'
                        CHECK (status IN ('not_connected','connected','error')),
  last_error            text,
  test_bill_code        text,                 -- BillCode of the RM 1.00 test payment (H1)
  tested_at             timestamptz,          -- RM 1.00 test payment passed
  connected_by_user_id  integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Booking timeline (H8) and history for reports / support
CREATE TABLE booking_events (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id    integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id     integer     NOT NULL,
  event_type     text        NOT NULL CHECK (event_type IN (
                   'created','confirmed','paid','payment_failed','pay_link_sent','reminder_sent','rescheduled',
                   'checked_in','completed','extended','no_show','cancelled','refunded','expired')),
  actor_user_id  integer     REFERENCES users(id) ON DELETE SET NULL,   -- NULL = customer or system
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE CASCADE
);
CREATE INDEX booking_events_booking_idx ON booking_events(booking_id, created_at);

-- In-app notifications (D6)
CREATE TABLE notifications (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN (
                 'booking_new','booking_paid','payment_failed','booking_cancelled','walk_in',
                 'staff_joined','reminders_sent','trial_ending','trial_ended')),
  title        text        NOT NULL,
  body         text,
  booking_id   integer,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_user_unread_idx ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- =====================================================================
-- 6. PLATFORM ADMIN & WEBSITE (FTech only — not tenant data; Phase 7)
-- =====================================================================
CREATE TABLE platform_admins (               -- I10
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer     NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'support' CHECK (role IN ('support','super_admin')),
  is_active   boolean     NOT NULL DEFAULT true,
  invited_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_log (               -- I2: every admin action is logged
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id  integer     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_id    integer     REFERENCES businesses(id) ON DELETE SET NULL,
  action         text        NOT NULL CHECK (action IN (
                   'extend_trial','give_free_months','change_plan','pause_booking_page','resume_booking_page',
                   'suspend_business','unsuspend_business','change_owner','resend_link','export_data','close_account',
                   'send_deletion_notice','hold_deletion','release_deletion','delete_business_data',
                   'record_payment','record_refund','recheck_payment','retry_job',
                   'update_plans','update_platform_settings','add_admin','change_admin_role','remove_admin','reset_two_factor',
                   'send_announcement','privacy_request_update','support_case_update','note')),
  reason         text        NOT NULL,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_business_idx ON admin_audit_log(business_id, created_at DESC);
CREATE INDEX admin_audit_log_admin_idx ON admin_audit_log(admin_user_id, created_at DESC);
-- The API only INSERTs into admin_audit_log; it never updates or deletes rows (I9 is read-only).

-- Admin-only notes on a business (I2)
CREATE TABLE admin_business_notes (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id    integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  admin_user_id  integer     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body           text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_business_notes_business_idx ON admin_business_notes(business_id, created_at DESC);

-- Plans & prices (I12). Shown on the website (I3, I4) and the app (E3). Super admins only.
CREATE TABLE plans (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                text        NOT NULL UNIQUE CHECK (code IN ('starter','business')),
  name                text        NOT NULL,
  price_sen           integer     NOT NULL CHECK (price_sen > 0),       -- per month
  resource_limit      integer     NOT NULL CHECK (resource_limit > 0),
  extra_resource_sen  integer     NOT NULL DEFAULT 1000 CHECK (extra_resource_sen >= 0),
  features            jsonb       NOT NULL DEFAULT '{}'::jsonb,         -- {"staff_app":true,"reports":true,...}
  is_public           boolean     NOT NULL DEFAULT true,
  sort_order          integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- New prices apply to new payments and the next renewal; paid periods keep the price in payments.amount_sen.

-- Single-row platform settings (I12)
CREATE TABLE platform_settings (
  id                     integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  trial_days             integer     NOT NULL DEFAULT 7  CHECK (trial_days BETWEEN 1 AND 90),
  grace_days             integer     NOT NULL DEFAULT 3  CHECK (grace_days BETWEEN 0 AND 30),
  renewal_reminder_days  integer[]   NOT NULL DEFAULT '{7,3,1}',
  unpaid_delete_after_months integer NOT NULL DEFAULT 12,
  deletion_notice_days   integer     NOT NULL DEFAULT 30,
  close_delete_after_days integer    NOT NULL DEFAULT 90,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Website contact form (I19)
CREATE TABLE leads (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reason          text        NOT NULL CHECK (reason IN ('demo','question','account_help')),
  name            text        NOT NULL,
  business_name   text,
  phone           text,
  email           citext,
  business_type   text,
  resource_count  text,
  message         text,
  consent_at      timestamptz NOT NULL,          -- ticked "FTech may contact me"
  status          text        NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX leads_status_idx ON leads(status, created_at DESC);

-- Support cases & internal notes (I11)
CREATE TABLE support_cases (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id          integer     REFERENCES businesses(id) ON DELETE SET NULL,
  lead_id              integer     REFERENCES leads(id) ON DELETE SET NULL,
  title                text        NOT NULL,
  source               text        NOT NULL CHECK (source IN ('whatsapp','email','website','phone','other')),
  status               text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','closed')),
  assigned_admin_user_id integer   REFERENCES users(id) ON DELETE SET NULL,
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_cases_status_idx ON support_cases(status, created_at DESC);
CREATE INDEX support_cases_business_idx ON support_cases(business_id);
CREATE INDEX support_cases_lead_idx ON support_cases(lead_id);
CREATE INDEX support_cases_assigned_idx ON support_cases(assigned_admin_user_id);

CREATE TABLE support_notes (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id        integer     NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
  admin_user_id  integer     REFERENCES users(id) ON DELETE SET NULL,
  kind           text        NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal','owner_message')),  -- owner_message = copied in from WhatsApp/email
  body           text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_notes_case_idx ON support_notes(case_id, created_at);

-- Privacy (PDPA) requests (I25)
CREATE TABLE privacy_requests (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_name    text        NOT NULL,
  requester_email   citext,
  requester_phone   text,
  requester_kind    text        NOT NULL CHECK (requester_kind IN ('owner','staff','customer','visitor')),
  kind              text        NOT NULL CHECK (kind IN ('access','correction','deletion','portability','stop_marketing','other')),
  business_id       integer     REFERENCES businesses(id) ON DELETE SET NULL,   -- the business the data belongs to, if any
  status            text        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','waiting_id_check','in_progress','sent_to_business','done','rejected')),
  received_at       timestamptz NOT NULL DEFAULT now(),
  due_at            timestamptz NOT NULL DEFAULT now() + interval '21 days',
  extended_reason   text,                         -- set when due_at is extended
  checklist         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes             text,
  handled_by_user_id integer    REFERENCES users(id) ON DELETE SET NULL,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_email IS NOT NULL OR requester_phone IS NOT NULL)
);
CREATE INDEX privacy_requests_open_idx ON privacy_requests(due_at) WHERE closed_at IS NULL;
CREATE INDEX privacy_requests_business_idx ON privacy_requests(business_id);
CREATE INDEX privacy_requests_handled_by_idx ON privacy_requests(handled_by_user_id);

-- Announcements to owners (I28): email, in-app banner on Today (O2), push
CREATE TABLE announcements (
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type                text        NOT NULL CHECK (type IN ('maintenance','price_change','feature_change','other')),
  audience            text        NOT NULL CHECK (audience IN ('all','plan','template','business')),
  audience_value      text,                       -- plan code, template or business slug
  channels            text[]      NOT NULL CHECK (cardinality(channels) > 0 AND channels <@ ARRAY['email','in_app','push']),
  title               text        NOT NULL,
  body                text        NOT NULL,
  send_at             timestamptz NOT NULL DEFAULT now(),
  ends_at             timestamptz,                -- banner hidden after this
  sent_at             timestamptz,
  sent_count          integer     NOT NULL DEFAULT 0,
  created_by_user_id  integer     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((audience = 'all') = (audience_value IS NULL))
);
CREATE INDEX announcements_send_idx ON announcements(send_at) WHERE sent_at IS NULL;
CREATE INDEX announcements_created_by_idx ON announcements(created_by_user_id);

CREATE TABLE announcement_dismissals (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  announcement_id  integer     NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);
CREATE INDEX announcement_dismissals_user_idx ON announcement_dismissals(user_id);

-- System health (I27): ToyyibPay payments whose callback and re-check disagree or never arrived
CREATE TABLE payment_checks (
  id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id       integer     NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  problem          text        NOT NULL CHECK (problem IN ('callback_recheck_mismatch','no_callback','recheck_failed')),
  callback_status  text,
  recheck_status   text,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by_user_id integer  REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_checks_open_idx ON payment_checks(checked_at) WHERE resolved_at IS NULL;
CREATE INDEX payment_checks_payment_idx ON payment_checks(payment_id);
CREATE INDEX payment_checks_resolved_by_idx ON payment_checks(resolved_by_user_id);

-- System health (I27): email delivery events from Resend webhooks (M1–M7, announcements)
CREATE TABLE email_events (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id          integer     REFERENCES businesses(id) ON DELETE SET NULL,
  user_id              integer     REFERENCES users(id) ON DELETE SET NULL,
  template             text        NOT NULL CHECK (template IN (
                         'verify_email','reset_password','staff_invite','receipt','trial_ending',
                         'sign_in_link','deletion_notice','announcement','refund_note')),
  to_masked            text        NOT NULL,       -- e.g. m***@gmail.com; full address is not stored here
  provider_message_id  text        UNIQUE,         -- Resend email id
  status               text        NOT NULL DEFAULT 'sent'
                       CHECK (status IN ('sent','delivered','bounced','complained','failed')),
  details              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_events_problem_idx ON email_events(created_at DESC) WHERE status IN ('bounced','complained','failed');
CREATE INDEX email_events_business_idx ON email_events(business_id);
CREATE INDEX email_events_user_idx ON email_events(user_id);
-- Failed background jobs (I27) are read from pg-boss's own tables, not stored here.

-- =====================================================================
-- 7. PILOT NICHE EXTRAS (Phase 6 — confirmed by the product owner, migrations 0016/0017)
-- =====================================================================
-- Real estate listings (ST-RE-L). Customers pick a listing when booking a viewing.
CREATE TABLE listings (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id        integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ref                text        NOT NULL,           -- e.g. LR-0231
  title              text        NOT NULL,
  area               text,
  address            text,
  agent_resource_id  integer,
  status             text        NOT NULL DEFAULT 'available'
                     CHECK (status IN ('available','under_offer','closed')),
  open_for_viewings  boolean     NOT NULL DEFAULT true,
  photo_key          text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  UNIQUE (business_id, ref),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, agent_resource_id) REFERENCES resources(business_id, id)
);
CREATE INDEX listings_business_id_idx ON listings(business_id);
ALTER TABLE bookings ADD COLUMN listing_id integer;
ALTER TABLE bookings ADD FOREIGN KEY (business_id, listing_id) REFERENCES listings(business_id, id);
CREATE INDEX bookings_listing_idx ON bookings(listing_id) WHERE listing_id IS NOT NULL;

-- Vehicle inspection checklist & report (ST-VI-C, S2)
CREATE TABLE checklist_sections (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  sort_order   integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);
CREATE INDEX checklist_sections_business_id_idx ON checklist_sections(business_id);
CREATE TABLE checklist_items (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  section_id   integer     NOT NULL,
  label        text        NOT NULL,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, section_id) REFERENCES checklist_sections(business_id, id) ON DELETE CASCADE
);
CREATE INDEX checklist_items_business_id_idx ON checklist_items(business_id);
CREATE INDEX checklist_items_section_idx ON checklist_items(section_id);
CREATE TABLE inspection_results (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id     integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id      integer     NOT NULL,
  overall         text        CHECK (overall IN ('pass','attention','fail')),
  notes           text,
  report_sent_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, booking_id),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE CASCADE
);
CREATE INDEX inspection_results_business_id_idx ON inspection_results(business_id);
CREATE TABLE inspection_item_results (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  result_id    integer     NOT NULL,
  item_id      integer     NOT NULL,
  outcome      text        NOT NULL CHECK (outcome IN ('pass','attention','fail','na')),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (result_id, item_id),
  FOREIGN KEY (business_id, result_id) REFERENCES inspection_results(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, item_id)   REFERENCES checklist_items(business_id, id)
);
CREATE INDEX inspection_item_results_business_id_idx ON inspection_item_results(business_id);

-- =====================================================================
-- 8. updated_at triggers
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','sessions','accounts','verifications','push_tokens',
    'businesses','business_members','staff_invitations','subscriptions',
    'branches','resources','services','service_price_rules','resource_services',
    'working_hours','time_off','booking_fields','customers','bookings',
    'booking_attachments','payments','refunds','payment_accounts','booking_events',
    'notifications','platform_admins','admin_audit_log','two_factors','admin_business_notes',
    'plans','platform_settings','leads','support_cases','support_notes','privacy_requests',
    'announcements','announcement_dismissals','payment_checks','email_events','listings','checklist_sections',
    'checklist_items','inspection_results','inspection_item_results'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;

-- =====================================================================
-- 9. DEFAULT ROWS (put in the Phase 7 migration; edit later in I12)
-- =====================================================================
INSERT INTO platform_settings (id) VALUES (1);
INSERT INTO plans (code, name, price_sen, resource_limit, extra_resource_sen, features, sort_order) VALUES
  ('starter',  'Starter',  4900, 3,  1000, '{"online_payment":true,"staff_app":false,"reports":false}', 1),
  ('business', 'Business', 9900, 10, 1000, '{"online_payment":true,"staff_app":true,"reports":true}',  2);
