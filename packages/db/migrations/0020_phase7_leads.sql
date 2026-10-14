CREATE TABLE "leads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reason" text NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"phone" text,
	"email" "citext",
	"business_type" text,
	"resource_count" text,
	"message" text,
	"consent_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_reason_check" CHECK ("leads"."reason" IN ('demo','question','account_help')),
	CONSTRAINT "leads_status_check" CHECK ("leads"."status" IN ('new','contacted','won','lost')),
	CONSTRAINT "leads_contact_check" CHECK ("leads"."phone" IS NOT NULL OR "leads"."email" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status","created_at" DESC NULLS LAST);