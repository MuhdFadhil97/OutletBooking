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
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE TABLE business_members (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id  integer     NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('owner','staff')),
  can_view_all boolean     NOT NULL DEFAULT false,   -- staff may see all bookings
  can_take_payments boolean NOT NULL DEFAULT true,   -- record cash / DuitNow / card (D12, S2, H7)
  can_edit_setup boolean    NOT NULL DEFAULT false,  -- services, prices, hours (D12)
  is_active    boolean     NOT NULL DEFAULT true,
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
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((booking_id IS NOT NULL) <> (subscription_id IS NOT NULL)),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE RESTRICT
);
CREATE INDEX payments_booking_idx ON payments(booking_id);
CREATE INDEX payments_business_idx ON payments(business_id, created_at);

CREATE TABLE refunds (                       -- D4: refunds are paid outside the app; recorded only
  id                  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id         integer     NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  booking_id          integer     NOT NULL,
  payment_id          integer     REFERENCES payments(id) ON DELETE RESTRICT,
  amount_sen          integer     NOT NULL CHECK (amount_sen > 0),
  method              text        NOT NULL CHECK (method IN ('bank_transfer','duitnow','cash')),
  reason              text,
  recorded_by_user_id integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, booking_id) REFERENCES bookings(business_id, id) ON DELETE RESTRICT
);
CREATE INDEX refunds_booking_idx ON refunds(booking_id);

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
  tested_at             timestamptz,          -- RM 1.00 test payment passed
  test_bill_code        text,                 -- BillCode of the latest RM 1.00 test bill
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
-- 6. PLATFORM ADMIN (FTech only — not tenant data)
-- =====================================================================
CREATE TABLE platform_admins (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     integer     NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_log (               -- I2: every admin action is logged
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id  integer     NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_id    integer     REFERENCES businesses(id) ON DELETE SET NULL,
  action         text        NOT NULL CHECK (action IN ('extend_trial','pause_booking_page','resume_booking_page','change_plan','note')),
  reason         text        NOT NULL,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_business_idx ON admin_audit_log(business_id, created_at DESC);

-- =====================================================================
-- 7. PILOT NICHE EXTRAS (Phase 6 — confirm before migrating)
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
ALTER TABLE bookings ADD COLUMN listing_id integer;
ALTER TABLE bookings ADD FOREIGN KEY (business_id, listing_id) REFERENCES listings(business_id, id);

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
    'notifications','platform_admins','admin_audit_log','listings','checklist_sections',
    'checklist_items','inspection_results','inspection_item_results'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_set_updated_at', t);
  END LOOP;
END $$;
