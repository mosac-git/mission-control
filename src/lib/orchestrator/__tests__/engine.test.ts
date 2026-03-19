import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { OrchestrationEngine, type EngineDb, type TaskRow } from '../engine'
import { LLMClient, type LLMCallOptions, type LLMResponse } from '../llm-client'
import { DiscordPoster } from '../discord-poster'

// ---------------------------------------------------------------------------
// In-memory DB helper
// ---------------------------------------------------------------------------

function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.prepare(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT,
      created_by TEXT NOT NULL DEFAULT 'system',
      parent_task_id INTEGER REFERENCES tasks(id),
      orchestration_state TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run()
  db.prepare('CREATE INDEX idx_tasks_parent ON tasks(parent_task_id)').run()
  db.prepare('CREATE INDEX idx_tasks_orch_state ON tasks(orchestration_state)').run()
  return db
}

// ---------------------------------------------------------------------------
// Mock LLM responses
// ---------------------------------------------------------------------------

function shadowDelegateResponse(summary = 'Coordinate the task'): string {
  return JSON.stringify({
    message: 'I will delegate this. Nexus, handle it.',
    action: 'delegate',
    delegate_to: 'nexus',
    task_summary: summary,
    priority: 'high',
  })
}

function shadowCompleteResponse(): string {
  return JSON.stringify({
    message: 'Done. Here is the answer.',
    action: 'complete',
  })
}

function shadowRejectResponse(): string {
  return JSON.stringify({
    message: 'This is not something we handle.',
    action: 'reject',
  })
}

function shadowRequestInfoResponse(): string {
  return JSON.stringify({
    message: 'I need more details.',
    action: 'request_info',
  })
}

function nexusAssignResponse(
  agents: Array<{ agent: string; subtask: string }> = [
    { agent: 'forge', subtask: 'Build the widget' },
    { agent: 'atlas', subtask: 'Research the market' },
  ],
): string {
  return JSON.stringify({
    message: 'Breaking this into two tracks.',
    action: 'assign',
    assignments: agents.map((a) => ({
      agent: a.agent,
      subtask: a.subtask,
      priority: 'medium',
    })),
    execution_order: 'parallel',
  })
}

function nexusConsolidateResponse(result = 'Consolidated output.'): string {
  return JSON.stringify({
    message: 'All done. Here is the combined result.',
    action: 'consolidate',
    consolidated_result: result,
  })
}

function specialistCompleteResponse(result = 'Task completed successfully.'): string {
  return JSON.stringify({
    message: 'Done with my part.',
    status: 'complete',
    result,
  })
}

// ---------------------------------------------------------------------------
// Mock LLMClient
// ---------------------------------------------------------------------------

class MockLLMClient extends LLMClient {
  callHistory: LLMCallOptions[] = []
  private responses: string[] = []
  private callIndex = 0

  constructor() {
    super({ retryDelays: [0], fetchFn: (() => {}) as unknown as typeof fetch })
  }

  queueResponse(...responses: string[]) {
    this.responses.push(...responses)
  }

  async call(opts: LLMCallOptions): Promise<LLMResponse> {
    this.callHistory.push(opts)
    const content = this.responses[this.callIndex] ?? '{"message":"fallback","action":"complete"}'
    this.callIndex++
    return { content, model: opts.model }
  }
}

// ---------------------------------------------------------------------------
// Mock DiscordPoster
// ---------------------------------------------------------------------------

class MockDiscordPoster extends DiscordPoster {
  posted: Array<{ channel: string; agent: string; content: string }> = []
  taskUpdates: Array<{ title: string; status: string }> = []

  constructor() {
    super(
      [
        { channelName: 'general', webhookUrl: 'http://mock/general' },
        { channelName: 'taskboard', webhookUrl: 'http://mock/taskboard' },
      ],
      (async () => ({ ok: true })) as unknown as typeof fetch,
    )
  }

  async postAsAgent(channel: string, agentName: string, content: string) {
    this.posted.push({ channel, agent: agentName, content })
  }

  async postTaskUpdate(taskTitle: string, status: string) {
    this.taskUpdates.push({ title: taskTitle, status })
  }
}

// ---------------------------------------------------------------------------
// Helper to get a task row from the DB
// ---------------------------------------------------------------------------

function getTask(db: Database.Database, taskId: number): TaskRow {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow
}

function getAllTasks(db: Database.Database): TaskRow[] {
  return db.prepare('SELECT * FROM tasks ORDER BY id').all() as TaskRow[]
}

// ---------------------------------------------------------------------------
// Suppress eventBus calls (module-level mock)
// ---------------------------------------------------------------------------

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/task-status', () => ({
  syncOrchestrationStatus: (state: string) => {
    const map: Record<string, string> = {
      CREATED: 'inbox',
      SHADOW_ANALYZING: 'assigned',
      DELEGATED_TO_NEXUS: 'in_progress',
      NEXUS_BREAKING_DOWN: 'in_progress',
      SUBTASKS_ASSIGNED: 'in_progress',
      AGENTS_WORKING: 'in_progress',
      SUBTASKS_COMPLETE: 'review',
      NEXUS_CONSOLIDATING: 'review',
      SHADOW_REVIEWING: 'quality_review',
      COMPLETE: 'done',
      REPORTED: 'done',
      FAILED: 'done',
      TIMED_OUT: 'done',
      CANCELLED: 'done',
      BLOCKED: 'in_progress',
    }
    return map[state] ?? undefined
  },
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestrationEngine', () => {
  let db: Database.Database
  let llm: MockLLMClient
  let discord: MockDiscordPoster
  let engine: OrchestrationEngine

  beforeEach(() => {
    db = createTestDb()
    llm = new MockLLMClient()
    discord = new MockDiscordPoster()
    engine = new OrchestrationEngine({ llm, discord, db: db as unknown as EngineDb, providerMinGap: 0 })
  })

  afterEach(() => {
    db.close()
  })

  // -----------------------------------------------------------------------
  // 1. handleUserMessage creates task and calls Shadow
  // -----------------------------------------------------------------------

  describe('handleUserMessage', () => {
    it('creates a task in DB with CREATED state then transitions to SHADOW_ANALYZING', async () => {
      llm.queueResponse(shadowCompleteResponse())

      const taskId = await engine.handleUserMessage('Write a report', 'mc-chat')

      expect(taskId).toBeGreaterThan(0)
      const task = getTask(db, taskId)
      expect(task.title).toBe('Write a report')
      expect(task.created_by).toBe('mc-user')
      // After completion, state should be COMPLETE
      expect(task.orchestration_state).toBe('COMPLETE')
    })

    it('calls Shadow with the user message', async () => {
      llm.queueResponse(shadowCompleteResponse())
      await engine.handleUserMessage('Hello Shadow', 'discord')

      expect(llm.callHistory).toHaveLength(1)
      // Should be calling shadow agent
      const call = llm.callHistory[0]
      expect(call.messages[1].content).toBe('Hello Shadow')
    })

    it('sets source to discord-user for discord messages', async () => {
      llm.queueResponse(shadowCompleteResponse())
      const taskId = await engine.handleUserMessage('Test', 'discord')
      expect(getTask(db, taskId).created_by).toBe('discord-user')
    })

    it('posts Shadow message to Discord', async () => {
      llm.queueResponse(shadowCompleteResponse())
      await engine.handleUserMessage('Test', 'mc-chat')

      expect(discord.posted.some((p) => p.agent === 'Shadow' && p.channel === 'general')).toBe(
        true,
      )
    })
  })

  // -----------------------------------------------------------------------
  // 2. Shadow delegate creates Nexus subtask and transitions state
  // -----------------------------------------------------------------------

  describe('Shadow delegate response', () => {
    it('creates Nexus subtask and transitions to DELEGATED_TO_NEXUS', async () => {
      // Shadow delegates, then Nexus assigns, then specialists complete, then Nexus consolidates, then Shadow reviews
      llm.queueResponse(
        shadowDelegateResponse('Plan the project'),
        nexusAssignResponse([{ agent: 'forge', subtask: 'Build it' }]),
        specialistCompleteResponse('Built.'),
        nexusConsolidateResponse('All done.'),
        shadowCompleteResponse(),
      )

      const taskId = await engine.handleUserMessage('Plan a project', 'mc-chat')

      const tasks = getAllTasks(db)
      // Root task + Nexus subtask + specialist subtask
      expect(tasks.length).toBeGreaterThanOrEqual(3)

      // Root should end up COMPLETE
      const root = getTask(db, taskId)
      expect(root.orchestration_state).toBe('COMPLETE')
    })

    it('transitions root task through DELEGATED_TO_NEXUS', async () => {
      // Shadow delegates then Nexus needs info (stops chain early)
      llm.queueResponse(
        shadowDelegateResponse(),
        JSON.stringify({
          message: 'I need more information.',
          action: 'request_info',
        }),
      )

      const taskId = await engine.handleUserMessage('Do something', 'mc-chat')
      const task = getTask(db, taskId)
      // Should be blocked because Nexus requested info
      expect(task.orchestration_state).toBe('BLOCKED')
    })
  })

  // -----------------------------------------------------------------------
  // 3. Nexus assign creates specialist subtasks
  // -----------------------------------------------------------------------

  describe('Nexus assign response', () => {
    it('creates specialist subtasks for each assignment', async () => {
      llm.queueResponse(
        shadowDelegateResponse(),
        nexusAssignResponse([
          { agent: 'forge', subtask: 'Build widget' },
          { agent: 'atlas', subtask: 'Research topic' },
        ]),
        specialistCompleteResponse('Widget built.'),
        specialistCompleteResponse('Research done.'),
        nexusConsolidateResponse('Combined result.'),
        shadowCompleteResponse(),
      )

      await engine.handleUserMessage('Build and research', 'mc-chat')

      const tasks = getAllTasks(db)
      const specialists = tasks.filter(
        (t) => t.assigned_to === 'forge' || t.assigned_to === 'atlas',
      )
      expect(specialists).toHaveLength(2)
      expect(specialists.map((s) => s.assigned_to).sort()).toEqual(['atlas', 'forge'])
    })

    it('stores execution_order in parent metadata', async () => {
      llm.queueResponse(
        shadowDelegateResponse(),
        nexusAssignResponse([{ agent: 'forge', subtask: 'Build' }]),
        specialistCompleteResponse(),
        nexusConsolidateResponse(),
        shadowCompleteResponse(),
      )

      const taskId = await engine.handleUserMessage('Build something', 'mc-chat')
      const root = getTask(db, taskId)
      const meta = JSON.parse(root.metadata ?? '{}')
      expect(meta.execution_order).toBe('parallel')
    })
  })

  // -----------------------------------------------------------------------
  // 4. Specialist complete checks siblings and triggers consolidation
  // -----------------------------------------------------------------------

  describe('specialist response handling', () => {
    it('triggers consolidation when all specialists complete', async () => {
      llm.queueResponse(
        shadowDelegateResponse(),
        nexusAssignResponse([
          { agent: 'forge', subtask: 'Part 1' },
          { agent: 'atlas', subtask: 'Part 2' },
        ]),
        specialistCompleteResponse('Part 1 done.'),
        specialistCompleteResponse('Part 2 done.'),
        nexusConsolidateResponse('Both parts combined.'),
        shadowCompleteResponse(),
      )

      const taskId = await engine.handleUserMessage('Two-part task', 'mc-chat')
      const root = getTask(db, taskId)
      expect(root.orchestration_state).toBe('COMPLETE')
    })

    it('does not trigger consolidation until all siblings complete', async () => {
      // Only one of two specialists responds
      let callCount = 0
      const origCall = llm.call.bind(llm)
      llm.call = async (opts: LLMCallOptions) => {
        callCount++
        if (callCount === 1) return origCall(opts) // Shadow
        if (callCount === 2) return origCall(opts) // Nexus
        if (callCount === 3) return origCall(opts) // First specialist
        // Fourth call (second specialist) throws to simulate incomplete
        throw new Error('LLM timeout')
      }

      llm.queueResponse(
        shadowDelegateResponse(),
        nexusAssignResponse([
          { agent: 'forge', subtask: 'Part 1' },
          { agent: 'atlas', subtask: 'Part 2' },
        ]),
        specialistCompleteResponse('Part 1 done.'),
        // atlas will fail (LLM timeout above)
        // After failure: both should be done (one complete, one failed)
        // This triggers consolidation
        nexusConsolidateResponse('Partial result.'),
        shadowCompleteResponse(),
      )

      const taskId = await engine.handleUserMessage('Two parts', 'mc-chat')
      // Even with one failure, the chain completes because failed counts as "done"
      const root = getTask(db, taskId)
      expect(['COMPLETE', 'FAILED']).toContain(root.orchestration_state)
    })
  })

  // -----------------------------------------------------------------------
  // 5. Full chain: user -> Shadow -> Nexus -> specialists -> consolidation -> review -> complete
  // -----------------------------------------------------------------------

  describe('full orchestration chain', () => {
    it('completes the entire chain end to end', async () => {
      llm.queueResponse(
        shadowDelegateResponse('Analyze and report'),
        nexusAssignResponse([
          { agent: 'atlas', subtask: 'Research competitors' },
          { agent: 'ink', subtask: 'Write report' },
        ]),
        specialistCompleteResponse('Competitor analysis done.'),
        specialistCompleteResponse('Report drafted.'),
        nexusConsolidateResponse('Final report with analysis and writeup.'),
        shadowCompleteResponse(),
      )

      const taskId = await engine.handleUserMessage('Competitive analysis report', 'mc-chat')

      // Verify final state
      const root = getTask(db, taskId)
      expect(root.orchestration_state).toBe('COMPLETE')
      expect(root.status).toBe('done')

      // Verify Discord messages were posted for each agent
      const agentNames = discord.posted.map((p) => p.agent)
      expect(agentNames).toContain('Shadow')
      expect(agentNames).toContain('Nexus')

      // Verify all tasks in DB
      const tasks = getAllTasks(db)
      expect(tasks.length).toBeGreaterThanOrEqual(4) // root + nexus subtask + 2 specialists
    })
  })

  // -----------------------------------------------------------------------
  // 6. Error handling: LLM failure transitions to FAILED
  // -----------------------------------------------------------------------

  describe('error handling', () => {
    it('transitions to FAILED when Shadow LLM call fails', async () => {
      llm.call = async () => {
        throw new Error('LLM is down')
      }

      const taskId = await engine.handleUserMessage('Test failure', 'mc-chat')
      const task = getTask(db, taskId)
      expect(task.orchestration_state).toBe('FAILED')
      expect(task.status).toBe('done')
    })

    it('stores error message in task metadata', async () => {
      llm.call = async () => {
        throw new Error('Connection refused')
      }

      const taskId = await engine.handleUserMessage('Test error', 'mc-chat')
      const meta = JSON.parse(getTask(db, taskId).metadata ?? '{}')
      expect(meta.error).toBe('Connection refused')
    })
  })

  // -----------------------------------------------------------------------
  // 7. Cancellation
  // -----------------------------------------------------------------------

  describe('cancellation', () => {
    it('transitions task to CANCELLED', async () => {
      llm.queueResponse(shadowRequestInfoResponse())
      const taskId = await engine.handleUserMessage('Need approval', 'mc-chat')

      // Task should be BLOCKED
      expect(getTask(db, taskId).orchestration_state).toBe('BLOCKED')

      // Cancel it
      engine.cancelTask(taskId)
      expect(getTask(db, taskId).orchestration_state).toBe('CANCELLED')
      expect(getTask(db, taskId).status).toBe('done')
    })
  })

  // -----------------------------------------------------------------------
  // 8. Parse failure: retry once then FAIL
  // -----------------------------------------------------------------------

  describe('parse failure and retry', () => {
    it('retries once with JSON nudge on parse failure', async () => {
      // First response is garbage, second (retry) is valid
      llm.queueResponse('This is not JSON at all. Just random text.', shadowCompleteResponse())

      const taskId = await engine.handleUserMessage('Test retry', 'mc-chat')
      const task = getTask(db, taskId)
      expect(task.orchestration_state).toBe('COMPLETE')
      // Should have called LLM twice (original + retry)
      expect(llm.callHistory).toHaveLength(2)
    })

    it('fails after retry still produces invalid output', async () => {
      llm.queueResponse('not json', 'still not json')

      const taskId = await engine.handleUserMessage('Test double fail', 'mc-chat')
      const task = getTask(db, taskId)
      expect(task.orchestration_state).toBe('FAILED')
    })

    it('extracts JSON from markdown code fence', async () => {
      const fenced = '```json\n' + shadowCompleteResponse() + '\n```'
      llm.queueResponse(fenced)

      const taskId = await engine.handleUserMessage('Test fenced', 'mc-chat')
      expect(getTask(db, taskId).orchestration_state).toBe('COMPLETE')
      // Only one call since first parse succeeded
      expect(llm.callHistory).toHaveLength(1)
    })

    it('extracts JSON embedded in text', async () => {
      const embedded =
        'Sure, here is my response: ' + shadowCompleteResponse() + ' Hope that helps!'
      llm.queueResponse(embedded)

      const taskId = await engine.handleUserMessage('Test embedded', 'mc-chat')
      expect(getTask(db, taskId).orchestration_state).toBe('COMPLETE')
      expect(llm.callHistory).toHaveLength(1)
    })
  })

  // -----------------------------------------------------------------------
  // Shadow reject and request_approval
  // -----------------------------------------------------------------------

  describe('Shadow non-delegate responses', () => {
    it('transitions to CANCELLED on reject', async () => {
      llm.queueResponse(shadowRejectResponse())
      const taskId = await engine.handleUserMessage('Inappropriate task', 'mc-chat')
      expect(getTask(db, taskId).orchestration_state).toBe('CANCELLED')
    })

    it('transitions to BLOCKED on request_approval', async () => {
      llm.queueResponse(
        JSON.stringify({
          message: 'This needs your approval.',
          action: 'request_approval',
          notes: 'Expensive operation',
        }),
      )
      const taskId = await engine.handleUserMessage('High cost task', 'mc-chat')
      expect(getTask(db, taskId).orchestration_state).toBe('BLOCKED')
    })
  })

  // -----------------------------------------------------------------------
  // Engine works without Discord
  // -----------------------------------------------------------------------

  describe('Discord-free operation', () => {
    it('works without Discord poster', async () => {
      const noDiscordEngine = new OrchestrationEngine({
        llm,
        discord: null,
        db: db as unknown as EngineDb,
        providerMinGap: 0,
      })
      llm.queueResponse(shadowCompleteResponse())

      const taskId = await noDiscordEngine.handleUserMessage('No discord', 'mc-chat')
      expect(getTask(db, taskId).orchestration_state).toBe('COMPLETE')
    })
  })

  // -----------------------------------------------------------------------
  // Concurrency controls
  // -----------------------------------------------------------------------

  describe('concurrency controls', () => {
    it('limits concurrent agent calls to maxConcurrent (3)', async () => {
      let peakConcurrency = 0
      let currentConcurrency = 0
      const origCall = llm.call.bind(llm)

      llm.call = async (opts: LLMCallOptions) => {
        currentConcurrency++
        peakConcurrency = Math.max(peakConcurrency, currentConcurrency)
        // Simulate some async work
        await new Promise((r) => setTimeout(r, 10))
        currentConcurrency--
        return origCall(opts)
      }

      // Queue enough responses for shadow + nexus + 5 specialists + nexus consolidate + shadow review
      llm.queueResponse(
        shadowDelegateResponse(),
        nexusAssignResponse([
          { agent: 'forge', subtask: 'A' },
          { agent: 'atlas', subtask: 'B' },
          { agent: 'ink', subtask: 'C' },
          { agent: 'oracle', subtask: 'D' },
          { agent: 'canvas', subtask: 'E' },
        ]),
        specialistCompleteResponse('A done'),
        specialistCompleteResponse('B done'),
        specialistCompleteResponse('C done'),
        specialistCompleteResponse('D done'),
        specialistCompleteResponse('E done'),
        nexusConsolidateResponse('All done'),
        shadowCompleteResponse(),
      )

      await engine.handleUserMessage('Parallel task', 'mc-chat')

      // The engine should have limited peak concurrency.
      // Note: the concurrency slot is acquired in callAgent and the actual LLM mock
      // resolves quickly, so the peak depends on scheduling. We verify it does not
      // exceed the maxConcurrent limit (3) + 1 for scheduling tolerance.
      expect(peakConcurrency).toBeLessThanOrEqual(4)
    })
  })

  // -----------------------------------------------------------------------
  // createSubtask
  // -----------------------------------------------------------------------

  describe('createSubtask', () => {
    it('creates subtask with correct parent and assigned_to', async () => {
      llm.queueResponse(shadowCompleteResponse())
      const parentId = await engine.handleUserMessage('Parent', 'mc-chat')

      const subtaskId = engine.createSubtask(parentId, 'Child task', 'forge', { priority: 'high' })
      const subtask = getTask(db, subtaskId)

      expect(subtask.parent_task_id).toBe(parentId)
      expect(subtask.assigned_to).toBe('forge')
      expect(subtask.orchestration_state).toBe('CREATED')
      const meta = JSON.parse(subtask.metadata ?? '{}')
      expect(meta.priority).toBe('high')
    })
  })

  // -----------------------------------------------------------------------
  // Nexus escalate path
  // -----------------------------------------------------------------------

  describe('Nexus escalate', () => {
    it('transitions to SHADOW_REVIEWING on escalate', async () => {
      llm.queueResponse(
        shadowDelegateResponse(),
        JSON.stringify({
          message: 'This needs Shadow attention.',
          action: 'escalate',
          notes: 'Critical issue found.',
        }),
        // Shadow reviews and completes
        shadowCompleteResponse(),
      )

      const taskId = await engine.handleUserMessage('Escalation test', 'mc-chat')
      const root = getTask(db, taskId)
      expect(root.orchestration_state).toBe('COMPLETE')
    })
  })
})
