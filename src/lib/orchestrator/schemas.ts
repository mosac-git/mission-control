import { z } from 'zod'

export const shadowResponseSchema = z.object({
  message: z.string(),
  action: z.enum(['delegate', 'complete', 'reject', 'request_info', 'request_approval']),
  delegate_to: z.string().optional(),
  task_summary: z.string().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  notes: z.string().optional(),
})

export const nexusAssignmentSchema = z.object({
  agent: z.string(),
  subtask: z.string(),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  depends_on: z.array(z.string()).optional(),
})

export const nexusResponseSchema = z.object({
  message: z.string(),
  action: z.enum(['assign', 'consolidate', 'escalate', 'request_info']),
  assignments: z.array(nexusAssignmentSchema).optional(),
  execution_order: z.enum(['parallel', 'sequential', 'mixed']).optional(),
  consolidated_result: z.string().optional(),
  notes: z.string().optional(),
})

export const specialistResponseSchema = z.object({
  message: z.string(),
  status: z.enum(['complete', 'partial', 'failed', 'need_help']),
  result: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  notes: z.string().optional(),
})

export type ShadowResponse = z.infer<typeof shadowResponseSchema>
export type NexusResponse = z.infer<typeof nexusResponseSchema>
export type SpecialistResponse = z.infer<typeof specialistResponseSchema>
