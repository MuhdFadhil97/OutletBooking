CREATE TABLE "listings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "listings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"area" text,
	"address" text,
	"agent_resource_id" integer,
	"status" text DEFAULT 'available' NOT NULL,
	"open_for_viewings" boolean DEFAULT true NOT NULL,
	"photo_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "listings_business_id_ref_key" UNIQUE("business_id","ref"),
	CONSTRAINT "listings_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "listings_status_check" CHECK ("listings"."status" IN ('available','under_offer','closed'))
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "checklist_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"section_id" integer NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_items_business_id_id_key" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "checklist_sections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "checklist_sections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_sections_business_id_id_key" UNIQUE("business_id","id")
);
--> statement-breakpoint
CREATE TABLE "inspection_item_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inspection_item_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"result_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_item_results_result_id_item_id_key" UNIQUE("result_id","item_id"),
	CONSTRAINT "inspection_item_results_outcome_check" CHECK ("inspection_item_results"."outcome" IN ('pass','attention','fail','na'))
);
--> statement-breakpoint
CREATE TABLE "inspection_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inspection_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"business_id" integer NOT NULL,
	"booking_id" integer NOT NULL,
	"overall" text,
	"notes" text,
	"report_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_results_business_id_booking_id_key" UNIQUE("business_id","booking_id"),
	CONSTRAINT "inspection_results_business_id_id_key" UNIQUE("business_id","id"),
	CONSTRAINT "inspection_results_overall_check" CHECK ("inspection_results"."overall" IN ('pass','attention','fail'))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "listing_id" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_business_id_agent_resource_id_fkey" FOREIGN KEY ("business_id","agent_resource_id") REFERENCES "public"."resources"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_business_id_section_id_fkey" FOREIGN KEY ("business_id","section_id") REFERENCES "public"."checklist_sections"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_sections" ADD CONSTRAINT "checklist_sections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_item_results" ADD CONSTRAINT "inspection_item_results_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_item_results" ADD CONSTRAINT "inspection_item_results_business_id_result_id_fkey" FOREIGN KEY ("business_id","result_id") REFERENCES "public"."inspection_results"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_item_results" ADD CONSTRAINT "inspection_item_results_business_id_item_id_fkey" FOREIGN KEY ("business_id","item_id") REFERENCES "public"."checklist_items"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_results" ADD CONSTRAINT "inspection_results_business_id_booking_id_fkey" FOREIGN KEY ("business_id","booking_id") REFERENCES "public"."bookings"("business_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_business_id_idx" ON "listings" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "checklist_items_business_id_idx" ON "checklist_items" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "checklist_items_section_idx" ON "checklist_items" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "checklist_sections_business_id_idx" ON "checklist_sections" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "inspection_item_results_business_id_idx" ON "inspection_item_results" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "inspection_results_business_id_idx" ON "inspection_results" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_listing_id_fkey" FOREIGN KEY ("business_id","listing_id") REFERENCES "public"."listings"("business_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_listing_idx" ON "bookings" USING btree ("listing_id") WHERE "bookings"."listing_id" IS NOT NULL;