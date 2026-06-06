import { z } from "zod";

export interface ActionContext {
  request_id: string;
  slack_post: (text: string) => Promise<{ ts: string }>;
  slack_edit: (ts: string, text: string) => Promise<void>;
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface CatalogAction<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  args_schema: z.ZodSchema<TArgs>;
  idempotent: boolean;
  external_effect: boolean;
  estimated_duration_ms?: number;
  invoke(args: TArgs, ctx: ActionContext): Promise<TResult>;
}
