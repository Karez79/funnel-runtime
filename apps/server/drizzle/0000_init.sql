CREATE TABLE `events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`funnel_id` text NOT NULL,
	`funnel_version` integer NOT NULL,
	`experiment_id` text NOT NULL,
	`variant` text NOT NULL,
	`step_id` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`client_ts` text,
	`server_ts` text NOT NULL,
	`client_seq` integer,
	`origin` text NOT NULL,
	`props_json` text DEFAULT '{}' NOT NULL,
	`flags_json` text DEFAULT '{}' NOT NULL,
	CONSTRAINT "events_origin_check" CHECK("events"."origin" IN ('client','server'))
);
--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `events_agg_idx` ON `events` (`funnel_id`,`funnel_version`,`variant`,`name`);--> statement-breakpoint
CREATE INDEX `events_campaign_idx` ON `events` (`utm_campaign`);--> statement-breakpoint
CREATE TABLE `funnel_activations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`funnel_id` text NOT NULL,
	`version` integer NOT NULL,
	`action` text NOT NULL,
	`from_version` integer,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`funnel_id`,`version`) REFERENCES `funnel_versions`(`funnel_id`,`version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "funnel_activations_action_check" CHECK("funnel_activations"."action" IN ('publish','rollback','activate'))
);
--> statement-breakpoint
CREATE TABLE `funnel_versions` (
	`funnel_id` text NOT NULL,
	`version` integer NOT NULL,
	`config_json` text NOT NULL,
	`config_hash` text NOT NULL,
	`release_note` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`funnel_id`, `version`),
	CONSTRAINT "funnel_versions_state_check" CHECK("funnel_versions"."state" IN ('draft','published'))
);
--> statement-breakpoint
CREATE TABLE `ingest_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text,
	`received_at` text NOT NULL,
	`accepted` integer NOT NULL,
	`duplicates` integer NOT NULL,
	`rejected` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rejected_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text,
	`event_id` text,
	`reason` text NOT NULL,
	`raw_json` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`funnel_id` text NOT NULL,
	`funnel_version` integer NOT NULL,
	`experiment_id` text NOT NULL,
	`variant` text NOT NULL,
	`variant_source` text NOT NULL,
	`traffic_type` text DEFAULT 'live' NOT NULL,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_content` text,
	`utm_term` text,
	`state_json` text NOT NULL,
	`state_rev` integer DEFAULT 0 NOT NULL,
	`result_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`funnel_id`,`funnel_version`) REFERENCES `funnel_versions`(`funnel_id`,`version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sessions_variant_check" CHECK("sessions"."variant" IN ('A','B')),
	CONSTRAINT "sessions_variant_source_check" CHECK("sessions"."variant_source" IN ('hash','override')),
	CONSTRAINT "sessions_traffic_type_check" CHECK("sessions"."traffic_type" IN ('live','qa','synthetic'))
);
--> statement-breakpoint
CREATE INDEX `sessions_version_idx` ON `sessions` (`funnel_id`,`funnel_version`,`variant`);