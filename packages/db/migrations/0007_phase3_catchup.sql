CREATE TABLE "booking_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "booking_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"booking_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_events_event_type_check" CHECK (event_type IN ('created','confirmed','paid','payment_failed','pay_link_sent','reminder_sent','rescheduled','checked_in','completed','extended','no_show','cancelled','refunded','expired'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "refunds_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"booking_id" integer NOT NULL,
	"payment_id" integer,
	"amount_sen" integer NOT NULL,
	"method" text NOT NULL,
	"reason" text,
	"recorded_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_sen_check" CHECK ("refunds"."amount_sen" > 0),
	CONSTRAINT "refunds_method_check" CHECK ("refunds"."method" IN ('bank_transfer','duitnow','cash'))
);
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_phone_check";--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "business_members" ADD COLUMN "can_take_payments" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "business_members" ADD COLUMN "can_edit_setup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "auto_confirm_paid" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "customers_can_cancel" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "late_cancel_keeps_deposit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_fields" ADD COLUMN "show_to_staff" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_fields" ADD COLUMN "hint" text;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD COLUMN "role" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD COLUMN "can_view_all" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD COLUMN "can_take_payments" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD COLUMN "can_edit_setup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_business_id_booking_id_fkey" FOREIGN KEY ("business_id","booking_id") REFERENCES "public"."bookings"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_booking_id_fkey" FOREIGN KEY ("business_id","booking_id") REFERENCES "public"."bookings"("business_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_events_booking_idx" ON "booking_events" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_events_business_id_idx" ON "booking_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "refunds_booking_idx" ON "refunds" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "refunds_business_id_idx" ON "refunds" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_role_check" CHECK ("staff_invitations"."role" IN ('owner','staff'));--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_phone_check" CHECK ("customers"."phone" IS NULL OR "customers"."phone" ~ '^\+[1-9][0-9]{7,14}$');