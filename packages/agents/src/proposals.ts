/** Bounded untrusted proposal data; contains no actor, grant or decision authority. */
import { z } from 'zod';
import { CRITICAL_ACTION_CATEGORIES } from '@flux88/core';
const uuid = z.string().uuid();
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const scalar = z.union([z.null(), z.boolean(), z.number().finite(), z.string()]);
function jsonAtDepth(depth: number): z.ZodType<Json> {
  if (depth === 0) return scalar;
  const child = jsonAtDepth(depth - 1);
  return z.union([scalar, z.array(child).max(1000), z.record(child).refine((v) => Object.keys(v).length <= 200)]);
}
const json = jsonAtDepth(20);
const payloadSchema = z.record(json).refine((v) => JSON.stringify(v).length <= 65_536);
export const proposalSchema = z.object({
  actionType: z.enum(CRITICAL_ACTION_CATEGORIES),
  actionPayload: payloadSchema,
  targetResource: z.string().trim().min(1).max(500),
  expectedImpact: z.string().trim().min(1).max(2000),
  risks: z.string().trim().min(1).max(2000),
  expiresAt: z.string().datetime(),
  taskId: uuid.optional(),
  // A batch is one explicitly described payload consumed once, never a multi-use grant.
  batchId: uuid.optional(),
}).strict();
export type ApprovalProposal = z.infer<typeof proposalSchema>;

export const preparedActionSchema = proposalSchema.omit({ expiresAt: true, taskId: true, batchId: true }).strict();
export const approvalRequestTtlMs = 15 * 60_000;
