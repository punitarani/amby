ALTER TABLE "traces" RENAME COLUMN "agent_name" TO "specialist";
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "task_id" uuid;
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "runner_kind" text;
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "mode" text;
--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "depth" integer;
--> statement-breakpoint
UPDATE "traces" SET "specialist" = 'conversation' WHERE "specialist" = 'orchestrator';
--> statement-breakpoint
CREATE INDEX "traces_task_id_idx" ON "traces" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "traces_specialist_idx" ON "traces" USING btree ("specialist");
--> statement-breakpoint
CREATE INDEX "traces_runner_kind_idx" ON "traces" USING btree ("runner_kind");
--> statement-breakpoint
CREATE INDEX "traces_mode_idx" ON "traces" USING btree ("mode");
--> statement-breakpoint
ALTER TABLE "task_events" RENAME COLUMN "event_type" TO "kind";
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "thread_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "trace_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "root_task_id" uuid;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "specialist" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "runner_kind" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "input" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "output" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "artifacts" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "confirmation_state" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_root_task_id_fkey" FOREIGN KEY ("root_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tasks_thread_idx" ON "tasks" USING btree ("thread_id");
--> statement-breakpoint
CREATE INDEX "tasks_trace_id_idx" ON "tasks" USING btree ("trace_id");
--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");
--> statement-breakpoint
CREATE INDEX "tasks_root_task_id_idx" ON "tasks" USING btree ("root_task_id");
--> statement-breakpoint
CREATE INDEX "tasks_specialist_idx" ON "tasks" USING btree ("specialist");
--> statement-breakpoint
CREATE INDEX "tasks_runner_kind_idx" ON "tasks" USING btree ("runner_kind");
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "runtime" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "requires_browser" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "runtime_data" jsonb;
--> statement-breakpoint
UPDATE "tasks"
SET "runtime" = CASE
	WHEN "runner_kind" = 'browser_service' OR "input"->>'kind' = 'browser' THEN 'browser'
	WHEN "runner_kind" = 'background_handoff'
		OR "input"->>'kind' = 'background'
		OR "callback_id" IS NOT NULL
		OR "sandbox_id" IS NOT NULL
		OR "session_id" IS NOT NULL
		OR "command_id" IS NOT NULL THEN 'sandbox'
	ELSE 'in_process'
END;
--> statement-breakpoint
UPDATE "tasks"
SET "provider" = CASE
	WHEN "runtime" = 'browser' THEN 'stagehand'
	WHEN "runtime" = 'sandbox' THEN 'codex'
	ELSE 'internal'
END;
--> statement-breakpoint
UPDATE "tasks"
SET "requires_browser" = CASE
	WHEN "runtime" = 'browser' THEN true
	WHEN "runtime" = 'sandbox' THEN COALESCE("needs_browser" = 'true', false)
	ELSE false
END;
--> statement-breakpoint
UPDATE "tasks"
SET "runtime_data" = CASE
	WHEN "runtime" = 'sandbox' THEN NULLIF(
		jsonb_strip_nulls(
			jsonb_build_object(
				'authMode', "auth_mode",
				'sandboxId', "sandbox_id",
				'sessionId', "session_id",
				'commandId', "command_id",
				'artifactRoot', "artifact_root"
			)
		),
		'{}'::jsonb
	)
	WHEN "runtime" = 'browser' THEN NULLIF(
		jsonb_strip_nulls(
			jsonb_build_object(
				'mode', "input"#>>'{task,mode}',
				'startUrl', "input"#>>'{task,startUrl}',
				'sideEffectLevel', "input"#>>'{task,sideEffectLevel}'
			)
		),
		'{}'::jsonb
	)
	ELSE NULL
END;
--> statement-breakpoint
UPDATE "task_events"
SET "source" = CASE
	WHEN "source" = 'harness' THEN 'runtime'
	WHEN "source" = 'codex_notify' THEN 'backend'
	WHEN "source" = 'reconciler' THEN 'maintenance'
	ELSE "source"
END;
--> statement-breakpoint
UPDATE "task_events"
SET "kind" = CASE
	WHEN "kind" = 'codex.notify' THEN 'backend.notify'
	WHEN "kind" = 'reconciler.probe' THEN 'maintenance.probe'
	WHEN "kind" = 'task.completed' AND COALESCE("payload"->>'status', '') = 'partial' THEN 'task.partial'
	WHEN "kind" = 'task.completed' AND COALESCE("payload"->>'status', '') = 'escalate' THEN 'task.escalated'
	ELSE "kind"
END;
--> statement-breakpoint
WITH ranked_terminal AS (
	SELECT
		"task_id",
		"kind",
		row_number() OVER (
			PARTITION BY "task_id"
			ORDER BY "occurred_at" DESC, "created_at" DESC, "id" DESC
		) AS "rn"
	FROM "task_events"
	WHERE "kind" IN (
		'task.completed',
		'task.partial',
		'task.escalated',
		'task.failed',
		'task.timed_out',
		'task.lost'
	)
),
mapped_terminal AS (
	SELECT
		"task_id",
		CASE "kind"
			WHEN 'task.completed' THEN 'succeeded'
			WHEN 'task.partial' THEN 'partial'
			WHEN 'task.escalated' THEN 'escalated'
			WHEN 'task.failed' THEN 'failed'
			WHEN 'task.timed_out' THEN 'timed_out'
			WHEN 'task.lost' THEN 'lost'
		END AS "status"
	FROM ranked_terminal
	WHERE "rn" = 1
)
UPDATE "tasks" AS "t"
SET "status" = "mapped_terminal"."status"
FROM mapped_terminal
WHERE "t"."id" = "mapped_terminal"."task_id"
	AND "t"."status" <> "mapped_terminal"."status";
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "runtime" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "provider" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "auth_mode";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "needs_browser";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "sandbox_id";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "session_id";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "command_id";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "artifact_root";
--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "channel_type";
--> statement-breakpoint
CREATE INDEX "tasks_runtime_status_heartbeat_idx" ON "tasks" USING btree ("runtime","status","heartbeat_at");
--> statement-breakpoint
WITH missing_traces AS (
	SELECT
		tr.id AS trace_id,
		tr.task_id,
		tr.conversation_id,
		tr.thread_id,
		tr.specialist,
		tr.runner_kind,
		tr.depth,
		tr.status AS trace_status,
		tr.started_at,
		tr.completed_at,
		conv.user_id,
		tr.metadata,
		tr.metadata->'request' AS request_meta,
		tr.metadata->'request'->'input' AS request_input,
		tr.metadata->'response' AS response_meta,
		tool.payload->'output' AS tool_output
	FROM traces AS tr
	JOIN conversations AS conv
		ON conv.id = tr.conversation_id
	LEFT JOIN tasks AS existing
		ON existing.id = tr.task_id
	LEFT JOIN LATERAL (
		SELECT te.payload
		FROM trace_events AS te
		WHERE te.trace_id = tr.id
			AND te.kind = 'tool_result'
		ORDER BY te.seq DESC
		LIMIT 1
	) AS tool
		ON true
	WHERE tr.task_id IS NOT NULL
		AND existing.id IS NULL
),
prepared AS (
	SELECT
		mt.*,
		CASE
			WHEN COALESCE(mt.response_meta->>'status', '') = 'completed' THEN 'succeeded'
			WHEN COALESCE(mt.response_meta->>'status', '') = 'partial' THEN 'partial'
			WHEN COALESCE(mt.response_meta->>'status', '') = 'escalate' THEN 'escalated'
			WHEN COALESCE(mt.response_meta->>'status', '') = 'failed' THEN 'failed'
			WHEN mt.trace_status = 'completed' THEN 'succeeded'
			WHEN mt.trace_status = 'failed' THEN 'failed'
			ELSE 'running'
		END AS task_status,
		CASE
			WHEN mt.runner_kind = 'browser_service' THEN 'browser'
			WHEN mt.runner_kind = 'background_handoff' THEN 'sandbox'
			ELSE 'in_process'
		END AS runtime,
		CASE
			WHEN mt.runner_kind = 'browser_service' THEN 'stagehand'
			WHEN mt.runner_kind = 'background_handoff' THEN 'codex'
			ELSE 'internal'
		END AS provider,
		CASE
			WHEN mt.runner_kind = 'browser_service' THEN true
			WHEN mt.runner_kind = 'background_handoff'
				THEN COALESCE((mt.request_input->>'needsBrowser')::boolean, false)
			ELSE false
		END AS requires_browser,
		COALESCE(
			CASE
				WHEN mt.request_input->>'kind' = 'specialist' THEN mt.request_input->>'goal'
				WHEN mt.request_input->>'kind' = 'browser' THEN mt.request_input#>>'{task,instruction}'
				WHEN mt.request_input->>'kind' = 'settings' THEN (mt.request_input->'task')::text
				WHEN mt.request_input->>'kind' = 'background' THEN mt.request_input->>'prompt'
				ELSE NULL
			END,
			mt.response_meta->>'summary',
			'Recovered task'
		) AS prompt,
		CASE
			WHEN COALESCE((mt.request_meta->>'requiresConfirmation')::boolean, false) THEN 'required'
			ELSE 'not_required'
		END AS confirmation_state,
		COALESCE(NULLIF(mt.request_meta->>'rootTaskId', ''), mt.task_id::text)::uuid AS root_task_id,
		NULLIF(mt.request_meta->>'parentTaskId', '')::uuid AS parent_task_id,
		CASE
			WHEN mt.request_input->>'kind' = 'browser' THEN NULLIF(
				jsonb_strip_nulls(
					jsonb_build_object(
						'mode', mt.request_input#>>'{task,mode}',
						'startUrl', mt.request_input#>>'{task,startUrl}',
						'sideEffectLevel', mt.request_input#>>'{task,sideEffectLevel}',
						'finalPage', mt.tool_output->'page',
						'actions', mt.tool_output->'actions'
					)
				),
				'{}'::jsonb
			)
			WHEN mt.request_input->>'kind' = 'settings' THEN jsonb_build_object(
				'settingsTask',
				mt.request_input->'task'
			)
			WHEN mt.request_input->>'kind' = 'background' THEN NULLIF(
				jsonb_strip_nulls(
					jsonb_build_object(
						'instructions', mt.request_input->'instructions',
						'context', mt.request_input->'context'
					)
				),
				'{}'::jsonb
			)
			ELSE NULL
		END AS runtime_data,
		NULLIF(
			jsonb_strip_nulls(
				jsonb_build_object(
					'depth', COALESCE(mt.request_meta->'depth', to_jsonb(mt.depth)),
					'spawnedBySpecialist', mt.request_meta->'spawnedBySpecialist',
					'resourceLocks', COALESCE(mt.request_meta->'resourceLocks', '[]'::jsonb),
					'mutates', mt.request_meta->'mutates',
					'writesExternal', mt.request_meta->'writesExternal'
				)
			),
			'{}'::jsonb
		) AS task_metadata,
		CASE
			WHEN mt.response_meta ? 'data' THEN mt.response_meta->'data'
			WHEN mt.tool_output ? 'output' THEN mt.tool_output->'output'
			ELSE NULL
		END AS output_data,
		CASE
			WHEN mt.response_meta ? 'artifacts' THEN mt.response_meta->'artifacts'
			WHEN mt.tool_output ? 'artifacts' THEN mt.tool_output->'artifacts'
			ELSE NULL
		END AS artifacts_data,
		mt.response_meta->>'summary' AS output_summary,
		CASE
			WHEN (
				CASE
					WHEN COALESCE(mt.response_meta->>'status', '') = 'completed' THEN 'succeeded'
					WHEN COALESCE(mt.response_meta->>'status', '') = 'partial' THEN 'partial'
					WHEN COALESCE(mt.response_meta->>'status', '') = 'escalate' THEN 'escalated'
					WHEN COALESCE(mt.response_meta->>'status', '') = 'failed' THEN 'failed'
					WHEN mt.trace_status = 'completed' THEN 'succeeded'
					WHEN mt.trace_status = 'failed' THEN 'failed'
					ELSE 'running'
				END
			) = 'failed'
				THEN COALESCE(mt.response_meta#>>'{issues,0,message}', mt.response_meta->>'summary')
			ELSE NULL
		END AS error_text
	FROM missing_traces AS mt
)
INSERT INTO tasks (
	id,
	user_id,
	runtime,
	provider,
	status,
	thread_id,
	trace_id,
	parent_task_id,
	root_task_id,
	specialist,
	runner_kind,
	input,
	output,
	artifacts,
	confirmation_state,
	prompt,
	requires_browser,
	runtime_data,
	output_summary,
	error,
	started_at,
	completed_at,
	created_at,
	updated_at,
	metadata,
	conversation_id
)
SELECT
	p.task_id,
	p.user_id,
	p.runtime,
	p.provider,
	p.task_status,
	p.thread_id,
	p.trace_id,
	p.parent_task_id,
	p.root_task_id,
	p.specialist,
	p.runner_kind,
	p.request_input,
	p.output_data,
	p.artifacts_data,
	p.confirmation_state,
	p.prompt,
	p.requires_browser,
	p.runtime_data,
	p.output_summary,
	p.error_text,
	p.started_at,
	CASE
		WHEN p.task_status IN ('pending', 'awaiting_auth', 'preparing', 'running') THEN NULL
		ELSE p.completed_at
	END,
	p.started_at,
	COALESCE(p.completed_at, p.started_at),
	p.task_metadata,
	p.conversation_id
FROM prepared AS p;
--> statement-breakpoint
WITH missing_traces AS (
	SELECT
		tr.id AS trace_id,
		tr.task_id,
		tr.conversation_id,
		tr.thread_id,
		tr.specialist,
		tr.runner_kind,
		tr.depth,
		tr.status AS trace_status,
		tr.started_at,
		tr.completed_at,
		tr.metadata,
		tr.metadata->'request' AS request_meta,
		tr.metadata->'request'->'input' AS request_input
	FROM traces AS tr
	LEFT JOIN tasks AS existing
		ON existing.id = tr.task_id
	WHERE tr.task_id IS NOT NULL
		AND existing.id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM task_events AS te
			WHERE te.task_id = tr.task_id
				AND te.kind = 'task.created'
		)
)
INSERT INTO task_events (
	task_id,
	event_id,
	source,
	kind,
	seq,
	payload,
	occurred_at
)
SELECT
	mt.task_id,
	gen_random_uuid(),
	'server',
	'task.created',
	NULL,
	jsonb_strip_nulls(
		jsonb_build_object(
			'conversationId', mt.conversation_id,
			'threadId', mt.thread_id,
			'traceId', mt.trace_id,
			'parentTaskId', NULLIF(mt.request_meta->>'parentTaskId', ''),
			'rootTaskId', COALESCE(NULLIF(mt.request_meta->>'rootTaskId', ''), mt.task_id::text),
			'runtime',
				CASE
					WHEN mt.runner_kind = 'browser_service' THEN 'browser'
					WHEN mt.runner_kind = 'background_handoff' THEN 'sandbox'
					ELSE 'in_process'
				END,
			'provider',
				CASE
					WHEN mt.runner_kind = 'browser_service' THEN 'stagehand'
					WHEN mt.runner_kind = 'background_handoff' THEN 'codex'
					ELSE 'internal'
				END
		)
	),
	mt.started_at
FROM missing_traces AS mt;
--> statement-breakpoint
WITH missing_terminal AS (
	SELECT
		tr.task_id,
		tr.started_at,
		tr.completed_at,
		tr.status AS trace_status,
		tr.metadata->'response' AS response_meta,
		CASE
			WHEN COALESCE(tr.metadata->'response'->>'status', '') = 'completed' THEN 'succeeded'
			WHEN COALESCE(tr.metadata->'response'->>'status', '') = 'partial' THEN 'partial'
			WHEN COALESCE(tr.metadata->'response'->>'status', '') = 'escalate' THEN 'escalated'
			WHEN COALESCE(tr.metadata->'response'->>'status', '') = 'failed' THEN 'failed'
			WHEN tr.status = 'completed' THEN 'succeeded'
			WHEN tr.status = 'failed' THEN 'failed'
			ELSE 'running'
		END AS task_status
	FROM traces AS tr
	JOIN tasks AS t
		ON t.id = tr.task_id
	WHERE tr.task_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM task_events AS te
			WHERE te.task_id = tr.task_id
				AND te.kind IN (
					'task.completed',
					'task.partial',
					'task.escalated',
					'task.failed',
					'task.timed_out',
					'task.lost'
				)
		)
)
INSERT INTO task_events (
	task_id,
	event_id,
	source,
	kind,
	seq,
	payload,
	occurred_at
)
SELECT
	mt.task_id,
	gen_random_uuid(),
	'server',
	CASE mt.task_status
		WHEN 'succeeded' THEN 'task.completed'
		WHEN 'partial' THEN 'task.partial'
		WHEN 'escalated' THEN 'task.escalated'
		WHEN 'failed' THEN 'task.failed'
		WHEN 'timed_out' THEN 'task.timed_out'
		WHEN 'lost' THEN 'task.lost'
	END,
	NULL,
	jsonb_strip_nulls(
		jsonb_build_object(
			'status',
				COALESCE(
					mt.response_meta->>'status',
					CASE mt.task_status
						WHEN 'succeeded' THEN 'completed'
						WHEN 'partial' THEN 'partial'
						WHEN 'escalated' THEN 'escalate'
						WHEN 'failed' THEN 'failed'
						ELSE mt.task_status
					END
				),
			'summary', mt.response_meta->>'summary',
			'issues', mt.response_meta->'issues'
		)
	),
	COALESCE(mt.completed_at, mt.started_at)
FROM missing_terminal AS mt
WHERE mt.task_status NOT IN ('pending', 'awaiting_auth', 'preparing', 'running');
