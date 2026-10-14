CREATE TABLE "two_factors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "two_factors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "two_factors_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "admin_business_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_business_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"admin_user_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement_dismissals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "announcement_dismissals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"announcement_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_dismissals_announcement_id_user_id_key" UNIQUE("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "announcements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"audience" text NOT NULL,
	"audience_value" text,
	"channels" text[] NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"send_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_type_check" CHECK ("announcements"."type" IN ('maintenance','price_change','feature_change','other')),
	CONSTRAINT "announcements_audience_check" CHECK ("announcements"."audience" IN ('all','plan','template','business')),
	CONSTRAINT "announcements_channels_check" CHECK (cardinality("announcements"."channels") > 0 AND "announcements"."channels" <@ ARRAY['email','in_app','push']),
	CONSTRAINT "announcements_audience_value_check" CHECK (("announcements"."audience" = 'all') = ("announcements"."audience_value" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "email_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer,
	"user_id" integer,
	"template" text NOT NULL,
	"to_masked" text NOT NULL,
	"provider_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_events_provider_message_id_unique" UNIQUE("provider_message_id"),
	CONSTRAINT "email_events_template_check" CHECK ("email_events"."template" IN ('verify_email','reset_password','staff_invite','receipt','trial_ending','sign_in_link','deletion_notice','announcement','refund_note')),
	CONSTRAINT "email_events_status_check" CHECK ("email_events"."status" IN ('sent','delivered','bounced','complained','failed'))
);
--> statement-breakpoint
CREATE TABLE "payment_checks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"payment_id" integer NOT NULL,
	"problem" text NOT NULL,
	"callback_status" text,
	"recheck_status" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_checks_problem_check" CHECK ("payment_checks"."problem" IN ('callback_recheck_mismatch','no_callback','recheck_failed'))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plans_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price_sen" integer NOT NULL,
	"resource_limit" integer NOT NULL,
	"extra_resource_sen" integer DEFAULT 1000 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code"),
	CONSTRAINT "plans_code_check" CHECK ("plans"."code" IN ('starter','business')),
	CONSTRAINT "plans_price_sen_check" CHECK ("plans"."price_sen" > 0),
	CONSTRAINT "plans_resource_limit_check" CHECK ("plans"."resource_limit" > 0),
	CONSTRAINT "plans_extra_resource_sen_check" CHECK ("plans"."extra_resource_sen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"trial_days" integer DEFAULT 7 NOT NULL,
	"grace_days" integer DEFAULT 3 NOT NULL,
	"renewal_reminder_days" integer[] DEFAULT '{7,3,1}' NOT NULL,
	"unpaid_delete_after_months" integer DEFAULT 12 NOT NULL,
	"deletion_notice_days" integer DEFAULT 30 NOT NULL,
	"close_delete_after_days" integer DEFAULT 90 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_id_check" CHECK ("platform_settings"."id" = 1),
	CONSTRAINT "platform_settings_trial_days_check" CHECK ("platform_settings"."trial_days" BETWEEN 1 AND 90),
	CONSTRAINT "platform_settings_grace_days_check" CHECK ("platform_settings"."grace_days" BETWEEN 0 AND 30)
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "privacy_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"requester_name" text NOT NULL,
	"requester_email" "citext",
	"requester_phone" text,
	"requester_kind" text NOT NULL,
	"kind" text NOT NULL,
	"business_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() + interval '21 days' NOT NULL,
	"extended_reason" text,
	"checklist" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"handled_by_user_id" integer,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_requester_kind_check" CHECK ("privacy_requests"."requester_kind" IN ('owner','staff','customer','visitor')),
	CONSTRAINT "privacy_requests_kind_check" CHECK ("privacy_requests"."kind" IN ('access','correction','deletion','portability','stop_marketing','other')),
	CONSTRAINT "privacy_requests_status_check" CHECK ("privacy_requests"."status" IN ('open','waiting_id_check','in_progress','sent_to_business','done','rejected')),
	CONSTRAINT "privacy_requests_contact_check" CHECK ("privacy_requests"."requester_email" IS NOT NULL OR "privacy_requests"."requester_phone" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "support_cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer,
	"lead_id" integer,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_admin_user_id" integer,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_cases_source_check" CHECK ("support_cases"."source" IN ('whatsapp','email','website','phone','other')),
	CONSTRAINT "support_cases_status_check" CHECK ("support_cases"."status" IN ('open','waiting','closed'))
);
--> statement-breakpoint
CREATE TABLE "support_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "support_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"admin_user_id" integer,
	"kind" text DEFAULT 'internal' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_notes_kind_check" CHECK ("support_notes"."kind" IN ('internal','owner_message'))
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" DROP CONSTRAINT "admin_audit_log_action_check";--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_payment_id_payments_id_fk";
--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "booking_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "suspend_reason" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "close_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "deletion_notice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "deletion_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "deletion_hold_reason" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "free_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_no" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "bank_ref" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "role" text DEFAULT 'support' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "invited_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_business_notes" ADD CONSTRAINT "admin_business_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_business_notes" ADD CONSTRAINT "admin_business_notes_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checks" ADD CONSTRAINT "payment_checks_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_checks" ADD CONSTRAINT "payment_checks_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_assigned_admin_user_id_users_id_fk" FOREIGN KEY ("assigned_admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_case_id_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_business_notes_business_idx" ON "admin_business_notes" USING btree ("business_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "announcement_dismissals_user_idx" ON "announcement_dismissals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "announcements_send_idx" ON "announcements" USING btree ("send_at") WHERE "announcements"."sent_at" IS NULL;--> statement-breakpoint
CREATE INDEX "announcements_created_by_idx" ON "announcements" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "email_events_problem_idx" ON "email_events" USING btree ("created_at" DESC NULLS LAST) WHERE "email_events"."status" IN ('bounced','complained','failed');--> statement-breakpoint
CREATE INDEX "email_events_business_idx" ON "email_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "email_events_user_idx" ON "email_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_checks_open_idx" ON "payment_checks" USING btree ("checked_at") WHERE "payment_checks"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "payment_checks_payment_idx" ON "payment_checks" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_checks_resolved_by_idx" ON "payment_checks" USING btree ("resolved_by_user_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_open_idx" ON "privacy_requests" USING btree ("due_at") WHERE "privacy_requests"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "privacy_requests_business_idx" ON "privacy_requests" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_handled_by_idx" ON "privacy_requests" USING btree ("handled_by_user_id");--> statement-breakpoint
CREATE INDEX "support_cases_status_idx" ON "support_cases" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "support_cases_business_idx" ON "support_cases" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "support_cases_lead_idx" ON "support_cases" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "support_cases_assigned_idx" ON "support_cases" USING btree ("assigned_admin_user_id");--> statement-breakpoint
CREATE INDEX "support_notes_case_idx" ON "support_notes" USING btree ("case_id","created_at");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_id_key" UNIQUE("business_id","id");--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_payment_id_fkey" FOREIGN KEY ("business_id","payment_id") REFERENCES "public"."payments"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "businesses_deletion_due_idx" ON "businesses" USING btree ("deletion_due_at") WHERE "businesses"."deletion_due_at" IS NOT NULL AND "businesses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_admin_idx" ON "admin_audit_log" USING btree ("admin_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_no_unique" UNIQUE("receipt_no");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_suspend_check" CHECK (("businesses"."suspended_at" IS NULL) = ("businesses"."suspend_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_no_check" CHECK ("payments"."receipt_no" IS NULL OR "payments"."purpose" = 'subscription');--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_reason_code_check" CHECK ("refunds"."reason_code" IN ('charged_twice','not_applied','first_payment_guarantee','cancellation','other'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_target_check" CHECK ("refunds"."booking_id" IS NOT NULL OR "refunds"."payment_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_action_check" CHECK (action IN ('extend_trial','give_free_months','change_plan','pause_booking_page','resume_booking_page','suspend_business','unsuspend_business','change_owner','resend_link','export_data','close_account','send_deletion_notice','hold_deletion','release_deletion','delete_business_data','record_payment','record_refund','recheck_payment','retry_job','update_plans','update_platform_settings','add_admin','change_admin_role','remove_admin','reset_two_factor','send_announcement','privacy_request_update','support_case_update','note'));--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_role_check" CHECK ("platform_admins"."role" IN ('support','super_admin'));