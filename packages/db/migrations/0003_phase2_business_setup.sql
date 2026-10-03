CREATE TABLE "booking_fields" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "booking_fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"service_id" integer,
	"field_key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_searchable" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_fields_field_key_check" CHECK ("booking_fields"."field_key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "booking_fields_field_type_check" CHECK ("booking_fields"."field_type" IN ('text','number','select','date','address','phone'))
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_business_id_id_key" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "resource_services" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resource_services_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"resource_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_services_resource_id_service_id_key" UNIQUE("resource_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"resource_type" text NOT NULL,
	"user_id" integer,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resources_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "resources_resource_type_check" CHECK ("resources"."resource_type" IN ('staff','bay','court','room','property','other'))
);
--> statement-breakpoint
CREATE TABLE "service_price_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_price_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"service_id" integer NOT NULL,
	"name" text DEFAULT 'Peak' NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"price_sen" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_price_rules_weekday_check" CHECK ("service_price_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "service_price_rules_price_sen_check" CHECK ("service_price_rules"."price_sen" >= 0),
	CONSTRAINT "service_price_rules_time_check" CHECK ("service_price_rules"."end_time" > "service_price_rules"."start_time")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "services_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_min" integer NOT NULL,
	"duration_options" integer[],
	"price_unit" text DEFAULT 'per_booking' NOT NULL,
	"price_sen" integer DEFAULT 0 NOT NULL,
	"deposit_sen" integer DEFAULT 0 NOT NULL,
	"prepay_full" boolean DEFAULT false NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"travel_buffer_min" integer DEFAULT 0 NOT NULL,
	"location_type" text DEFAULT 'at_business' NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "services_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "services_duration_min_check" CHECK ("services"."duration_min" BETWEEN 5 AND 1440),
	CONSTRAINT "services_price_unit_check" CHECK ("services"."price_unit" IN ('per_booking','per_block')),
	CONSTRAINT "services_price_sen_check" CHECK ("services"."price_sen" >= 0),
	CONSTRAINT "services_deposit_sen_check" CHECK ("services"."deposit_sen" >= 0),
	CONSTRAINT "services_buffer_min_check" CHECK ("services"."buffer_min" >= 0),
	CONSTRAINT "services_travel_buffer_min_check" CHECK ("services"."travel_buffer_min" >= 0),
	CONSTRAINT "services_location_type_check" CHECK ("services"."location_type" IN ('at_business','at_customer_location'))
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "staff_invitations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"email" "citext" NOT NULL,
	"resource_id" integer,
	"token" text DEFAULT encode(gen_random_bytes(24), 'hex') NOT NULL,
	"invited_by" integer NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "time_off_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"resource_id" integer,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_range_check" CHECK ("time_off"."end_at" > "time_off"."start_at")
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "working_hours_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"resource_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "working_hours_weekday_check" CHECK ("working_hours"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "working_hours_time_check" CHECK ("working_hours"."end_time" > "working_hours"."start_time")
);
--> statement-breakpoint
ALTER TABLE "booking_fields" ADD CONSTRAINT "booking_fields_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_fields" ADD CONSTRAINT "booking_fields_business_id_service_id_fkey" FOREIGN KEY ("business_id","service_id") REFERENCES "public"."services"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_services" ADD CONSTRAINT "resource_services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_services" ADD CONSTRAINT "resource_services_business_id_resource_id_fkey" FOREIGN KEY ("business_id","resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_services" ADD CONSTRAINT "resource_services_business_id_service_id_fkey" FOREIGN KEY ("business_id","service_id") REFERENCES "public"."services"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_business_id_branch_id_fkey" FOREIGN KEY ("business_id","branch_id") REFERENCES "public"."branches"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_price_rules" ADD CONSTRAINT "service_price_rules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_price_rules" ADD CONSTRAINT "service_price_rules_business_id_service_id_fkey" FOREIGN KEY ("business_id","service_id") REFERENCES "public"."services"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_business_id_resource_id_fkey" FOREIGN KEY ("business_id","resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_business_id_resource_id_fkey" FOREIGN KEY ("business_id","resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_fields_key_uidx" ON "booking_fields" USING btree ("business_id",COALESCE("service_id", 0),"field_key");--> statement-breakpoint
CREATE INDEX "booking_fields_business_id_idx" ON "booking_fields" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "branches_business_id_idx" ON "branches" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "resource_services_business_id_idx" ON "resource_services" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "resource_services_service_id_idx" ON "resource_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "resources_business_id_idx" ON "resources" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "resources_user_id_idx" ON "resources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "service_price_rules_business_id_idx" ON "service_price_rules" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "service_price_rules_service_id_idx" ON "service_price_rules" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "services_business_id_idx" ON "services" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "staff_invitations_business_id_idx" ON "staff_invitations" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "time_off_business_range_idx" ON "time_off" USING btree ("business_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "working_hours_business_id_idx" ON "working_hours" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "working_hours_resource_weekday_idx" ON "working_hours" USING btree ("resource_id","weekday");