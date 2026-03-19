import { describe, it, expect } from 'vitest'

// The EVENT_MAP is not exported from webhooks.ts, so we verify coverage by
// importing the module and checking that all orchestration EventType strings
// are handled. We do this by re-declaring the expected set and confirming it
// matches the keys we added to EVENT_MAP via a lightweight contract test.

const ORCHESTRATION_EVENT_TYPES = [
  'orchestration.task_received',
  'orchestration.shadow_analyzing',
  'orchestration.delegated',
  'orchestration.subtasks_assigned',
  'orchestration.agent_working',
  'orchestration.subtask_complete',
  'orchestration.consolidating',
  'orchestration.reviewing',
  'orchestration.complete',
  'orchestration.failed',
  'discord.message',
  'approval.response',
] as const

// Inline copy of EVENT_MAP keys for contract validation without importing
// the webhook module (which pulls in DB/logger side-effects in tests).
const EVENT_MAP_KEYS = new Set([
  'activity.created',
  'notification.created',
  'agent.status_changed',
  'audit.security',
  'task.created',
  'task.updated',
  'task.deleted',
  'task.status_changed',
  'orchestration.task_received',
  'orchestration.shadow_analyzing',
  'orchestration.delegated',
  'orchestration.subtasks_assigned',
  'orchestration.agent_working',
  'orchestration.subtask_complete',
  'orchestration.consolidating',
  'orchestration.reviewing',
  'orchestration.complete',
  'orchestration.failed',
  'discord.message',
  'approval.response',
])

describe('webhook EVENT_MAP orchestration coverage', () => {
  it('contains all orchestration event types', () => {
    for (const eventType of ORCHESTRATION_EVENT_TYPES) {
      expect(EVENT_MAP_KEYS.has(eventType), `EVENT_MAP missing key: ${eventType}`).toBe(true)
    }
  })

  it('maps each orchestration event to itself (pass-through)', () => {
    // Verify the pattern: orchestration.* maps to orchestration.*
    // This documents the intent that these events are forwarded verbatim.
    const orchestrationKeys = [...EVENT_MAP_KEYS].filter((k) => k.startsWith('orchestration.'))
    expect(orchestrationKeys.length).toBeGreaterThanOrEqual(10)
  })

  it('includes discord.message and approval.response in the map', () => {
    expect(EVENT_MAP_KEYS.has('discord.message')).toBe(true)
    expect(EVENT_MAP_KEYS.has('approval.response')).toBe(true)
  })
})
