import { describe, it, expect } from 'vitest'
import { shadowResponseSchema, nexusResponseSchema, specialistResponseSchema } from '../schemas'

describe('agent output schemas', () => {
  it('validates Shadow delegate response', () => {
    const valid = {
      message: "I'll handle this. Nexus, break this down.",
      action: 'delegate',
      delegate_to: 'nexus',
      task_summary: 'Write a project brief',
      priority: 'high',
    }
    expect(shadowResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('validates Shadow complete response', () => {
    const valid = { message: 'Done. Here is the result.', action: 'complete' }
    expect(shadowResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('validates Shadow request_approval response', () => {
    const valid = { message: 'This needs approval.', action: 'request_approval', notes: 'High cost action' }
    expect(shadowResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid Shadow action', () => {
    const invalid = { message: 'test', action: 'fly' }
    expect(shadowResponseSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects missing message', () => {
    const invalid = { action: 'delegate' }
    expect(shadowResponseSchema.safeParse(invalid).success).toBe(false)
  })

  it('validates Nexus assign response with assignments', () => {
    const valid = {
      message: 'Breaking this into two tracks.',
      action: 'assign',
      assignments: [
        { agent: 'atlas', subtask: 'Research competitors', priority: 'high' },
        { agent: 'ink', subtask: 'Draft brief', depends_on: ['atlas'], priority: 'medium' },
      ],
      execution_order: 'mixed',
    }
    expect(nexusResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('validates Nexus consolidate response', () => {
    const valid = {
      message: 'All subtasks complete. Here is the consolidated result.',
      action: 'consolidate',
      consolidated_result: 'The full brief content...',
    }
    expect(nexusResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('validates Specialist complete response', () => {
    const valid = {
      message: 'Research complete. Here are the findings.',
      status: 'complete',
      result: 'Detailed research findings...',
      artifacts: ['https://example.com/report'],
    }
    expect(specialistResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('validates Specialist need_help response', () => {
    const valid = {
      message: 'I need more context on the target audience.',
      status: 'need_help',
      notes: 'Missing audience demographics',
    }
    expect(specialistResponseSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid specialist status', () => {
    const invalid = { message: 'done', status: 'winning' }
    expect(specialistResponseSchema.safeParse(invalid).success).toBe(false)
  })
})
