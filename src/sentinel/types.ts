import { z } from "zod";

export const ObservationSchema = z.object({
  id: z.number().optional(),
  source: z.string(),
  topic: z.string().optional(),
  timestamp: z.number(),
  summary: z.string(),
  data: z.unknown().optional(),
  metrics: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const InsightCategorySchema = z.enum(["pattern", "anomaly", "friction", "opportunity"]);
export type InsightCategory = z.infer<typeof InsightCategorySchema>;

export const InsightSchema = z.object({
  id: z.number().optional(),
  category: InsightCategorySchema,
  summary: z.string(),
  evidence: z.string(),
  derived_from: z.array(z.number()).default([]),
  confidence: z.number().min(0).max(1),
  generated_at: z.number(),
  filed_to: z.string().nullable().default(null),
});
export type Insight = z.infer<typeof InsightSchema>;

export const ConversationStateSchema = z.enum(["open", "closed", "dropped", "opt-out"]);
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const ConversationTurnSchema = z.object({
  sender: z.enum(["jr", "person"]),
  text: z.string(),
  ts: z.number(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export interface Conversation {
  id?: number;
  person_user_id: string;
  channel: string;
  thread_ts: string | null;
  topic: string;
  opening_message: string;
  state: ConversationState;
  turns: ConversationTurn[];
  opened_at: number;
  last_turn_at: number | null;
  closed_at: number | null;
  takeaway: string | null;
}

export interface PersonProfile {
  user_id: string;
  display_name: string | null;
  known_domains: string[];
  last_engaged_at: number | null;
  total_engaged: number;
  notes: string | null;
}

export interface OptOut {
  id?: number;
  person_user_id: string;
  scope: string;
  added_at: number;
  reason: string | null;
}

export const OpportunityScopeSchema = z.enum(["ops-efficiency", "strategic-revenue"]);
export type OpportunityScope = z.infer<typeof OpportunityScopeSchema>;

export const OpportunityStatusSchema = z.enum([
  "proposed",
  "in-progress",
  "shipped",
  "declined",
  "stale",
]);
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

export interface Opportunity {
  id?: number;
  title: string;
  scope: OpportunityScope;
  summary: string;
  evidence: string;
  proposed_at: number;
  confidence: number;
  filed_to: string | null;
  status: OpportunityStatus;
  status_notes: string | null;
}

export const ReportKindSchema = z.enum(["daily", "weekly-digest", "weekly-ideas"]);
export type ReportKind = z.infer<typeof ReportKindSchema>;
