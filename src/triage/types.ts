import { z } from "zod";

export type TriageState =
  | "PENDING_CLASSIFY"
  | "CLASSIFIED"
  | "RESEARCHING"
  | "PLANNING"
  | "PLAYBOOK_MATCHED"
  | "AWAITING_APPROVAL"
  | "EDITING"
  | "EXECUTING"
  | "FAILED_AT_STEP"
  | "COMPLETE"
  | "CANCELLED"
  | "ABANDONED";

export const ClassifierOutputSchema = z.object({
  is_task: z.boolean(),
  confidence: z.number().min(0).max(1),
  suggested_category: z.string().optional(),
  playbook_match: z
    .object({
      playbook_id: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
});
export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

export const PlanStepSchema = z.object({
  action: z.string(),
  args: z.record(z.string(), z.unknown()),
  rationale: z.string().optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlanHistoryEntrySchema = z.object({
  plan: PlanSchema,
  edit_text: z.string().nullable(),
  ts: z.number(),
});
export type PlanHistoryEntry = z.infer<typeof PlanHistoryEntrySchema>;

export interface TriageSession {
  request_id: string;
  channel: string;
  thread_ts: string;
  requester_user_id: string;
  requester_message: string;
  progress_ts: string | null;
  summary_ts: string | null;
  state: TriageState;
  classifier_output: ClassifierOutput | null;
  research_bundle: unknown;
  playbook_id: string | null;
  plan_history: PlanHistoryEntry[];
  final_plan: Plan | null;
  execution_log: ExecutionLogEntry[];
  failed_at_step: number | null;
  created_at: number;
  updated_at: number;
}

export interface ExecutionLogEntry {
  step_idx: number;
  action: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "success" | "error" | "retried_success" | "retried_error";
  started_at: number | null;
  ended_at: number | null;
  result_excerpt: string | null;
  retried: boolean;
}
