/**
 * Integration test: full orchestration chain
 *
 * Proves that handleUserMessage drives the state machine end-to-end:
 *   User -> Shadow -> Nexus -> Atlas (research) + Ink (writing, depends on Atlas)
 *        -> Nexus consolidates -> Shadow reviews -> COMPLETE
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { OrchestrationEngine } from '../engine'
import { eventBus } from '@/lib/event-bus'

// ---------------------------------------------------------------------------
// In-memory DB helper
// ---------------------------------------------------------------------------

const TASKS_DDL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT    NOT NULL,
    description     TEXT,
    status          TEXT    NOT NULL DEFAULT 'inbox',
    priority        TEXT    NOT NULL DEFAULT 'medium',
    assigned_to     TEXT,
    parent_task_id  INTEGER REFERENCES tasks(id),
    orchestration_state TEXT,
    metadata        TEXT,
    created_by      TEXT    NOT NULL DEFAULT 'system',
    created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
  )
`

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.prepare(TASKS_DDL).run()
  return db
}

// ---------------------------------------------------------------------------
// Mock LLM
// ---------------------------------------------------------------------------

/**
 * Returns deterministic JSON responses keyed on which agent owns the call.
 *
 * Detection strategy: the system prompt (messages[0].content) contains the
 * agent's name as "# You are <Name>" — we match on those distinctive strings.
 */
function createMockLLM() {
  // Track Nexus call count to distinguish assign vs consolidate phases.
  let nexusCallCount = 0

  const call = vi.fn().mockImplementation(async (opts: {
    messages: Array<{ role: string; content: string }>
  }) => {
    const systemPrompt: string = opts.messages[0]?.content ?? ''

    // ---- Shadow -------------------------------------------------------
    if (systemPrompt.includes('# You are Shadow')) {
      const userContent: string = opts.messages[1]?.content ?? ''
      if (userContent.includes('Review the following')) {
        return {
          content: JSON.stringify({
            message: 'Reviewed and approved. Here is your Shadow Collective project brief.',
            action: 'complete',
          }),
          model: 'test',
        }
      }
      return {
        content: JSON.stringify({
          message: "I'll have Nexus coordinate this. Research first, then writing.",
          action: 'delegate',
          delegate_to: 'nexus',
          task_summary: 'Write a project brief for Shadow Collective',
          priority: 'high',
        }),
        model: 'test',
      }
    }

    // ---- Nexus --------------------------------------------------------
    if (systemPrompt.includes('# You are Nexus')) {
      nexusCallCount++
      if (nexusCallCount === 1) {
        return {
          content: JSON.stringify({
            message: 'Breaking this into research and writing tracks.',
            action: 'assign',
            assignments: [
              {
                agent: 'atlas',
                subtask: 'Research SC positioning and market',
                priority: 'high',
              },
              {
                agent: 'ink',
                subtask: 'Draft the project brief using research',
                priority: 'medium',
                depends_on: ['atlas'],
              },
            ],
            execution_order: 'mixed',
          }),
          model: 'test',
        }
      }
      return {
        content: JSON.stringify({
          message: 'All work is done. Here is the consolidated brief.',
          action: 'consolidate',
          consolidated_result: 'Complete project brief content for Shadow Collective...',
        }),
        model: 'test',
      }
    }

    // ---- Atlas --------------------------------------------------------
    if (systemPrompt.includes('# You are Atlas')) {
      return {
        content: JSON.stringify({
          message: 'Research complete. Here are the findings.',
          status: 'complete',
          result: 'Market research findings for Shadow Collective...',
        }),
        model: 'test',
      }
    }

    // ---- Ink ----------------------------------------------------------
    if (systemPrompt.includes('# You are Ink')) {
      return {
        content: JSON.stringify({
          message: 'Brief drafted using Atlas research.',
          status: 'complete',
          result: 'Shadow Collective Project Brief: ...',
        }),
        model: 'test',
      }
    }

    // Fallback — should not be reached in this test
    return {
      content: JSON.stringify({
        message: 'Unknown agent response',
        action: 'complete',
        status: 'complete',
      }),
      model: 'test',
    }
  })

  return { call }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestrationEngine — full chain integration', () => {
  let db: Database.Database
  let engine: OrchestrationEngine
  let mockLLM: ReturnType<typeof createMockLLM>
  let receivedEvents: Array<{ type: string; data: unknown }>

  beforeEach(() => {
    db = createTestDb()
    mockLLM = createMockLLM()

    engine = new OrchestrationEngine({
      llm: mockLLM as unknown as import('../llm-client').LLMClient,
      discord: null,
      db,
      providerMinGap: 0,
    })

    receivedEvents = []
    eventBus.on('server-event', (evt: { type: string; data: unknown }) => {
      receivedEvents.push({ type: evt.type, data: evt.data })
    })
  })

  it('drives the full chain from user message to COMPLETE', async () => {
    const taskId = await engine.handleUserMessage(
      'Write a project brief for Shadow Collective',
      'mc-chat',
    )

    type TaskRow = {
      id: number
      title: string
      orchestration_state: string
      status: string
      parent_task_id: number | null
      assigned_to: string | null
    }

    const rootTask = db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow

    expect(rootTask).toBeTruthy()
    expect(rootTask.title).toBe('Write a project brief for Shadow Collective')
    expect(rootTask.parent_task_id).toBeNull()
    expect(rootTask.orchestration_state).toBe('COMPLETE')
    expect(rootTask.status).toBe('done')

    // root + nexus subtask + atlas subtask + ink subtask = 4 tasks
    const allTasks = db.prepare('SELECT * FROM tasks').all() as TaskRow[]
    expect(allTasks).toHaveLength(4)

    const nexusSubtask = allTasks.find(
      (t) => t.assigned_to === 'nexus' && t.parent_task_id === taskId,
    )
    expect(nexusSubtask).toBeTruthy()

    const specialistSubtasks = allTasks.filter(
      (t) => t.assigned_to !== 'nexus' && t.parent_task_id === taskId,
    )
    expect(specialistSubtasks).toHaveLength(2)

    const assignees = specialistSubtasks.map((t) => t.assigned_to).sort()
    expect(assignees).toEqual(['atlas', 'ink'])
  })

  it('records state transitions via the event bus', async () => {
    await engine.handleUserMessage(
      'Write a project brief for Shadow Collective',
      'mc-chat',
    )

    const eventTypes = receivedEvents
      .map((e) => e.type)
      .filter((t) => t.startsWith('orchestration.'))

    // Note: orchestration.task_received (CREATED state) is never emitted because
    // the engine writes CREATED directly in the INSERT rather than via transitionState.
    // All subsequent states DO go through transitionState and emit events.
    expect(eventTypes).toContain('orchestration.shadow_analyzing')
    expect(eventTypes).toContain('orchestration.delegated')
    expect(eventTypes).toContain('orchestration.subtasks_assigned')
    expect(eventTypes).toContain('orchestration.agent_working')
    expect(eventTypes).toContain('orchestration.consolidating')
    expect(eventTypes).toContain('orchestration.reviewing')
    expect(eventTypes).toContain('orchestration.complete')
  })

  it('calls LLM exactly 6 times across the full chain', async () => {
    await engine.handleUserMessage(
      'Write a project brief for Shadow Collective',
      'mc-chat',
    )

    // Shadow(1) + Nexus assign(2) + Atlas(3) + Ink(4) + Nexus consolidate(5) + Shadow review(6)
    expect(mockLLM.call).toHaveBeenCalledTimes(6)
  })

  it('emits chat.message events for each agent response', async () => {
    await engine.handleUserMessage(
      'Write a project brief for Shadow Collective',
      'mc-chat',
    )

    const chatEvents = receivedEvents.filter((e) => e.type === 'chat.message')
    // Shadow(x2) + Nexus(x2) + Atlas(x1) + Ink(x1) = 6
    expect(chatEvents.length).toBeGreaterThanOrEqual(6)

    const fromAgents = chatEvents.map(
      (e) => (e.data as { from_agent: string }).from_agent,
    )
    expect(fromAgents).toContain('shadow')
    expect(fromAgents).toContain('nexus')
    expect(fromAgents).toContain('atlas')
    expect(fromAgents).toContain('ink')
  })

  it('persists consolidated_result in root task metadata', async () => {
    const taskId = await engine.handleUserMessage(
      'Write a project brief for Shadow Collective',
      'mc-chat',
    )

    const row = db
      .prepare('SELECT metadata FROM tasks WHERE id = ?')
      .get(taskId) as { metadata: string | null }

    expect(row.metadata).toBeTruthy()
    const meta = JSON.parse(row.metadata!) as Record<string, unknown>
    expect(meta.consolidated_result).toContain('Shadow Collective')
  })

  it('sets created_by to discord-user when source is discord', async () => {
    const taskId = await engine.handleUserMessage(
      'Write a project brief for Shadow Collective',
      'discord',
    )

    const row = db
      .prepare('SELECT created_by, orchestration_state FROM tasks WHERE id = ?')
      .get(taskId) as { created_by: string; orchestration_state: string }

    expect(row.created_by).toBe('discord-user')
    expect(row.orchestration_state).toBe('COMPLETE')
  })
})
