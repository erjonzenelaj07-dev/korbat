import type { Logger } from "pino";
import { z } from "zod";

export const JobSchema = z.object({ type: z.string().min(1), payload: z.unknown() });
export type Job = z.infer<typeof JobSchema>;
export interface JobContext { log: Logger }
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

export const QUEUE_KEY = "korbat:jobs";

export function parseJob(raw: string): Job {
  return JobSchema.parse(JSON.parse(raw));
}

export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  register(type: string, handler: JobHandler): this {
    if (this.handlers.has(type)) throw new Error(`duplicate handler for job type: ${type}`);
    this.handlers.set(type, handler);
    return this;
  }
  async dispatch(job: Job, ctx: JobContext): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) throw new Error(`no handler for job type: ${job.type}`);
    await handler(job.payload, ctx);
  }
}
