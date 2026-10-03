CREATE TABLE "bookings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bookings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"public_token" text DEFAULT encode(gen_random_bytes(16), 'hex') NOT NULL,
	"business_id" integer NOT NULL,
	"branch_id" integer,
	"resource_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"blocked_start_at" timestamp with time zone NOT NULL,
	"blocked_end_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"price_sen" integer DEFAULT 0 NOT NULL,
	"amount_due_sen" integer DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'not_required' NOT NULL,
	"location_address" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customer_notes" text,
	"internal_notes" text,
	"result_notes" text,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "bookings_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "bookings_duration_min_check" CHECK ("bookings"."duration_min" > 0),
	CONSTRAINT "bookings_status_check" CHECK ("bookings"."status" IN ('pending','confirmed','checked_in','completed','cancelled','no_show')),
	CONSTRAINT "bookings_source_check" CHECK ("bookings"."source" IN ('web','app','walk_in')),
	CONSTRAINT "bookings_price_sen_check" CHECK ("bookings"."price_sen" >= 0),
	CONSTRAINT "bookings_amount_due_sen_check" CHECK ("bookings"."amount_due_sen" >= 0),
	CONSTRAINT "bookings_payment_status_check" CHECK ("bookings"."payment_status" IN ('not_required','unpaid','paid','refunded')),
	CONSTRAINT "bookings_time_check" CHECK ("bookings"."end_at" > "bookings"."start_at"),
	CONSTRAINT "bookings_blocked_range_check" CHECK ("bookings"."blocked_start_at" <= "bookings"."start_at" AND "bookings"."blocked_end_at" >= "bookings"."end_at")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" "citext",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_business_id_phone_key" UNIQUE("business_id","phone"),
	CONSTRAINT "customers_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "customers_phone_check" CHECK ("customers"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_branch_id_fkey" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_resource_id_fkey" FOREIGN KEY ("business_id","resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_service_id_fkey" FOREIGN KEY ("business_id","service_id") REFERENCES "public"."services"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_customer_id_fkey" FOREIGN KEY ("business_id","customer_id") REFERENCES "public"."customers"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_business_start_idx" ON "bookings" USING btree ("business_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_resource_start_idx" ON "bookings" USING btree ("resource_id","start_at");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "bookings_pending_expiry_idx" ON "bookings" USING btree ("expires_at") WHERE "bookings"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "bookings_custom_fields_gin" ON "bookings" USING gin ("custom_fields" jsonb_path_ops);