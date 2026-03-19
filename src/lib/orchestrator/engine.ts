/**
 * Orchestration engine: task tree + state machine for Shadow Collective.
 *
 * Drives the full chain: User -> Shadow -> Nexus -> Specialists -> Consolidation -> Review -> Complete
 *
 * State machine:
 *   CREATED -> SHADOW_ANALYZING -> DELEGATED_TO_NEXUS -> NEXUS_BREAKING_DOWN
 *   -> SUBTASKS_ASSIGNED -> AGENTS_WORKING -> SUBTASKS_COMPLETE
 *   -> NEXUS_CONSOLIDATING -> SHADOW_REVIEWING -> COMPLETE -> REPORTED
 *
 * Failure states: FAILED, TIMED_OUT, CANCELLED, BLOCKED
 */

import { LLMClient } from './llm-client'
import { DiscordPoster } from './discord-poster'
import { getAgentConfig } from './agent-config'
import { getAgentPrompt, type TaskContext } from './agent-prompts'
import {
  shadowResponseSchema,
  nexusResponseSchema,
  specialistResponseSchema,
  type ShadowResponse,
  type NexusResponse,
  type SpecialistResponse,
} from './schemas'
import { syncOrchestrationStatus } from '@/lib/task-status'
import { eventBus, type EventType } from '@/lib/event-bus'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrchestrationState =
  | 'CREATED'
  | 'SHADOW_ANALYZING'
  | 'DELEGATED_TO_NEXUS'
  | 'NEXUS_BREAKING_DOWN'
  | 'SUBTASKS_ASSIGNED'
  | 'AGENTS_WORKING'
  | 'SUBTASKS_COMPLETE'
  | 'NEXUS_CONSOLIDATING'
  | 'SHADOW_REVIEWING'
  | 'COMPLETE'
  | 'REPORTED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'CANCELLED'
  | 'BLOCKED'

/** Minimal DB row shape returned by task queries. */
export interface TaskRow {
  id: number
  title: string
  description: string | null
  status: string
  priority: string
  assigned_to: string | null
  parent_task_id: number | null
  orchestration_state: string | null
  metadata: string | null
  created_by: string
}

/** Abstraction over the DB so the engine is testable with in-memory SQLite. */
export interface EngineDb {
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
}

export interface EngineOptions {
  llm?: LLMClient
  discord?: DiscordPoster | null
  db: EngineDb
  /** Max concurrent LLM calls (default 3). */
  maxConcurrent?: number
  /** Min gap in ms between calls to the same provider (default 2000). Set to 0 for tests. */
  providerMinGap?: number
}

// ---------------------------------------------------------------------------
// Event mapping: orchestration state -> eventBus event type
// ---------------------------------------------------------------------------

const STATE_EVENT_MAP: Partial<Record<OrchestrationState, EventType>> = {
  CREATED: 'orchestration.task_received',
  SHADOW_ANALYZING: 'orchestration.shadow_analyzing',
  DELEGATED_TO_NEXUS: 'orchestration.delegated',
  SUBTASKS_ASSIGNED: 'orchestration.subtasks_assigned',
  AGENTS_WORKING: 'orchestration.agent_working',
  SUBTASKS_COMPLETE: 'orchestration.subtask_complete',
  NEXUS_CONSOLIDATING: 'orchestration.consolidating',
  SHADOW_REVIEWING: 'orchestration.reviewing',
  COMPLETE: 'orchestration.complete',
  FAILED: 'orchestration.failed',
}

// ---------------------------------------------------------------------------
// OrchestrationEngine
// ---------------------------------------------------------------------------

export class OrchestrationEngine {
  private llm: LLMClient
  private discord: DiscordPoster | null
  private db: EngineDb

  // Concurrency controls
  private activeCalls = 0
  private readonly maxConcurrent: number
  private providerLastCall = new Map<string, number>()
  private readonly providerMinGap: number
  private waitQueue: Array<() => void> = []

  constructor(opts: EngineOptions) {
    this.llm = opts.llm || new LLMClient()
    this.discord = opts.discord ?? null
    this.db = opts.db
    this.maxConcurrent = opts.maxConcurrent ?? 3
    this.providerMinGap = opts.providerMinGap ?? 2000
  }

  // -----------------------------------------------------------------------
  // Public: entry point
  // -----------------------------------------------------------------------

  /**
   * Handle a new user message.  Creates a root task, sends it to Shadow,
   * and kicks off the state machine.  Returns the new task ID.
   */
  async handleUserMessage(
    message: string,
    source: 'discord' | 'mc-chat',
  ): Promise<number> {
    // 1. Create task
    const taskId = this.createTask({
      title: message.slice(0, 200),
      description: message,
      status: 'inbox',
      orchestrationState: 'CREATED',
      createdBy: source === 'discord' ? 'discord-user' : 'mc-user',
    })

    // 2. Transition to SHADOW_ANALYZING
    this.transitionState(taskId, 'SHADOW_ANALYZING')

    // 3. Call Shadow
    try {
      const taskContext: TaskContext = { task: message }
      const rawResponse = await this.callAgent('shadow', taskContext)

      // 4. Handle Shadow's response
      await this.handleShadowResponse(taskId, rawResponse)
    } catch (err) {
      this.transitionState(taskId, 'FAILED')
      this.setTaskError(taskId, err instanceof Error ? err.message : String(err))
    }

    return taskId
  }

  // -----------------------------------------------------------------------
  // Public: state machine driver
  // -----------------------------------------------------------------------

  /**
   * Continue processing a task based on its current orchestration state.
   * Called after each agent response to drive the chain forward.
   */
  async processTask(taskId: number): Promise<void> {
    const task = this.getTask(taskId)
    if (!task) return

    const state = task.orchestration_state as OrchestrationState | null
    if (!state) return

    switch (state) {
      case 'SUBTASKS_ASSIGNED':
      case 'AGENTS_WORKING':
        await this.executeSubtasks(taskId)
        break

      case 'SUBTASKS_COMPLETE':
        // Call Nexus for consolidation
        this.transitionState(taskId, 'NEXUS_CONSOLIDATING')
        try {
          const subtasks = this.getChildTasks(taskId).filter(
            (s) => s.assigned_to != null && s.assigned_to !== 'nexus',
          )
          const subtaskSummaries = subtasks.map(
            (s) => `[${s.assigned_to ?? 'unassigned'}] ${s.title}: ${this.getSubtaskResult(s)}`,
          )
          const taskContext: TaskContext = {
            task: `Consolidate the results from all specialists for: ${task.title}`,
            subtasks: subtaskSummaries,
          }
          const rawResponse = await this.callAgent('nexus', taskContext)
          await this.handleNexusResponse(taskId, rawResponse)
        } catch (err) {
          this.transitionState(taskId, 'FAILED')
          this.setTaskError(taskId, err instanceof Error ? err.message : String(err))
        }
        break

      case 'SHADOW_REVIEWING': {
        // Shadow reviews consolidated result
        try {
          const meta = this.getTaskMetadata(taskId)
          const consolidated = meta?.consolidated_result ?? 'No consolidated result available.'
          const taskContext: TaskContext = {
            task: `Review the following consolidated result for the original request "${task.title}":\n\n${consolidated}`,
          }
          const rawResponse = await this.callAgent('shadow', taskContext)
          await this.handleShadowReviewResponse(taskId, rawResponse)
        } catch (err) {
          this.transitionState(taskId, 'FAILED')
          this.setTaskError(taskId, err instanceof Error ? err.message : String(err))
        }
        break
      }

      default:
        // No automatic processing for other states
        break
    }
  }

  /**
   * Cancel a task, transitioning it to CANCELLED state.
   */
  cancelTask(taskId: number): void {
    this.transitionState(taskId, 'CANCELLED')
  }

  // -----------------------------------------------------------------------
  // Agent call with rate limiting
  // -----------------------------------------------------------------------

  async callAgent(agentName: string, taskContext: TaskContext): Promise<string> {
    const config = getAgentConfig(agentName)
    if (!config) throw new Error(`Unknown agent: ${agentName}`)

    // 1. Wait for concurrency slot
    await this.acquireConcurrencySlot()

    try {
      // 2. Wait for provider gap
      await this.waitForProviderGap(config.provider)

      // 3. Build prompt
      const systemPrompt = getAgentPrompt(agentName, taskContext)

      // 4. Call LLM
      const response = await this.llm.call({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: taskContext.task },
        ],
        provider: config.provider,
      })

      // 5. Record provider call time
      this.providerLastCall.set(config.provider, Date.now())

      return response.content
    } finally {
      this.releaseConcurrencySlot()
    }
  }

  // -----------------------------------------------------------------------
  // Response handlers
  // -----------------------------------------------------------------------

  async handleShadowResponse(taskId: number, rawResponse: string): Promise<void> {
    const parsed = await this.parseWithRetry<ShadowResponse>(
      'shadow',
      shadowResponseSchema,
      rawResponse,
      { task: 'Please respond in valid JSON format.' },
    )

    // Post Shadow's message to Discord and MC Chat
    await this.postAgentMessage('Shadow', parsed.message)
    this.broadcastChat('shadow', parsed.message)

    switch (parsed.action) {
      case 'delegate': {
        // Create subtask for Nexus
        const nexusTaskId = this.createSubtask(
          taskId,
          parsed.task_summary ?? `Coordinate: ${this.getTask(taskId)?.title ?? 'task'}`,
          'nexus',
          { priority: parsed.priority },
        )
        this.transitionState(taskId, 'DELEGATED_TO_NEXUS')

        // Call Nexus
        this.transitionState(nexusTaskId, 'NEXUS_BREAKING_DOWN')
        try {
          const parentTask = this.getTask(taskId)
          const taskContext: TaskContext = {
            task: parsed.task_summary ?? parentTask?.title ?? '',
            parentTask: parentTask?.description ?? parentTask?.title,
          }
          const nexusRaw = await this.callAgent('nexus', taskContext)
          await this.handleNexusResponse(taskId, nexusRaw)
        } catch (err) {
          this.transitionState(taskId, 'FAILED')
          this.setTaskError(taskId, err instanceof Error ? err.message : String(err))
        }
        break
      }

      case 'complete':
        this.transitionState(taskId, 'COMPLETE')
        break

      case 'reject':
        this.transitionState(taskId, 'CANCELLED')
        break

      case 'request_info':
      case 'request_approval':
        this.transitionState(taskId, 'BLOCKED')
        break
    }
  }

  async handleNexusResponse(parentTaskId: number, rawResponse: string): Promise<void> {
    const parsed = await this.parseWithRetry<NexusResponse>(
      'nexus',
      nexusResponseSchema,
      rawResponse,
      { task: 'Please respond in valid JSON format.' },
    )

    // Post Nexus's message
    await this.postAgentMessage('Nexus', parsed.message)
    this.broadcastChat('nexus', parsed.message)

    switch (parsed.action) {
      case 'assign': {
        if (!parsed.assignments || parsed.assignments.length === 0) {
          this.transitionState(parentTaskId, 'FAILED')
          this.setTaskError(parentTaskId, 'Nexus returned assign action with no assignments')
          return
        }

        // Store execution plan in parent metadata
        this.updateTaskMetadata(parentTaskId, {
          execution_order: parsed.execution_order ?? 'parallel',
          assignments: parsed.assignments,
        })

        // Create subtasks for each assignment
        for (const assignment of parsed.assignments) {
          this.createSubtask(
            parentTaskId,
            assignment.subtask,
            assignment.agent,
            {
              priority: assignment.priority,
              depends_on: assignment.depends_on,
            },
          )
        }

        this.transitionState(parentTaskId, 'SUBTASKS_ASSIGNED')

        // Kick off execution
        await this.executeSubtasks(parentTaskId)
        break
      }

      case 'consolidate': {
        this.updateTaskMetadata(parentTaskId, {
          consolidated_result: parsed.consolidated_result,
        })
        this.transitionState(parentTaskId, 'SHADOW_REVIEWING')
        // Drive the review step
        await this.processTask(parentTaskId)
        break
      }

      case 'escalate':
        this.transitionState(parentTaskId, 'SHADOW_REVIEWING')
        await this.processTask(parentTaskId)
        break

      case 'request_info':
        this.transitionState(parentTaskId, 'BLOCKED')
        break
    }
  }

  async handleSpecialistResponse(subtaskId: number, rawResponse: string): Promise<void> {
    const subtask = this.getTask(subtaskId)
    if (!subtask) return

    const agentName = subtask.assigned_to ?? 'unknown'
    const parsed = await this.parseWithRetry<SpecialistResponse>(
      agentName,
      specialistResponseSchema,
      rawResponse,
      { task: 'Please respond in valid JSON format.' },
    )

    // Post specialist's message
    const config = getAgentConfig(agentName)
    const displayName = config?.name ?? agentName
    await this.postAgentMessage(displayName, parsed.message)
    this.broadcastChat(agentName, parsed.message)

    // Update subtask
    const statusMap: Record<string, string> = {
      complete: 'done',
      partial: 'in_progress',
      failed: 'done',
      need_help: 'review',
    }
    const newStatus = statusMap[parsed.status] ?? 'in_progress'
    this.db.prepare(
      'UPDATE tasks SET status = ?, metadata = ?, updated_at = unixepoch() WHERE id = ?',
    ).run(
      newStatus,
      JSON.stringify({
        ...this.getTaskMetadata(subtaskId),
        result: parsed.result,
        artifacts: parsed.artifacts,
        specialist_status: parsed.status,
      }),
      subtaskId,
    )

    if (parsed.status === 'complete' || parsed.status === 'failed') {
      this.transitionState(subtaskId, 'COMPLETE')
    }

    // Check if all specialist siblings are complete
    const parentId = subtask.parent_task_id
    if (parentId != null) {
      const siblings = this.getChildTasks(parentId)
      // Filter to specialist subtasks only (exclude nexus coordination subtask)
      const specialistSiblings = siblings.filter(
        (s) => s.assigned_to != null && s.assigned_to !== 'nexus',
      )
      const allDone =
        specialistSiblings.length > 0 &&
        specialistSiblings.every((s) => {
          const meta = this.getTaskMetadata(s.id)
          const specStatus = meta?.specialist_status
          return specStatus === 'complete' || specStatus === 'failed'
        })

      if (allDone) {
        this.transitionState(parentId, 'SUBTASKS_COMPLETE')
        await this.processTask(parentId)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Shadow review (final step)
  // -----------------------------------------------------------------------

  private async handleShadowReviewResponse(
    taskId: number,
    rawResponse: string,
  ): Promise<void> {
    const parsed = await this.parseWithRetry<ShadowResponse>(
      'shadow',
      shadowResponseSchema,
      rawResponse,
      { task: 'Please respond in valid JSON format.' },
    )

    await this.postAgentMessage('Shadow', parsed.message)
    this.broadcastChat('shadow', parsed.message)

    switch (parsed.action) {
      case 'complete':
        this.transitionState(taskId, 'COMPLETE')
        break

      case 'delegate':
        // Shadow wants more work
        this.transitionState(taskId, 'DELEGATED_TO_NEXUS')
        break

      case 'reject':
        this.transitionState(taskId, 'CANCELLED')
        break

      case 'request_info':
      case 'request_approval':
        this.transitionState(taskId, 'BLOCKED')
        break
    }
  }

  // -----------------------------------------------------------------------
  // Subtask execution with dependency ordering
  // -----------------------------------------------------------------------

  async executeSubtasks(parentTaskId: number): Promise<void> {
    const meta = this.getTaskMetadata(parentTaskId)
    const executionOrder = meta?.execution_order ?? 'parallel'
    // Only execute specialist subtasks (exclude nexus coordination subtask)
    const subtasks = this.getChildTasks(parentTaskId).filter(
      (s) => s.assigned_to != null && s.assigned_to !== 'nexus',
    )

    if (subtasks.length === 0) return

    this.transitionState(parentTaskId, 'AGENTS_WORKING')

    if (executionOrder === 'sequential') {
      // Run one at a time
      for (const subtask of subtasks) {
        await this.runSpecialistSubtask(subtask)
      }
    } else if (executionOrder === 'parallel') {
      // Fire all at once (respecting max concurrent via callAgent)
      await Promise.all(subtasks.map((s) => this.runSpecialistSubtask(s)))
    } else {
      // mixed: honor depends_on chains
      await this.executeMixedOrder(subtasks)
    }
  }

  private async executeMixedOrder(subtasks: TaskRow[]): Promise<void> {
    const completed = new Set<string>()
    const remaining = [...subtasks]

    while (remaining.length > 0) {
      const ready = remaining.filter((s) => {
        const meta = this.getTaskMetadata(s.id)
        const deps = (meta?.depends_on as string[] | undefined) ?? []
        return deps.every((dep) => completed.has(dep))
      })

      if (ready.length === 0) {
        // All remaining tasks have unresolvable deps -- run them anyway
        await Promise.all(remaining.map((s) => this.runSpecialistSubtask(s)))
        break
      }

      await Promise.all(ready.map((s) => this.runSpecialistSubtask(s)))
      for (const s of ready) {
        completed.add(s.assigned_to ?? '')
        const idx = remaining.indexOf(s)
        if (idx !== -1) remaining.splice(idx, 1)
      }
    }
  }

  private async runSpecialistSubtask(subtask: TaskRow): Promise<void> {
    const agentName = subtask.assigned_to
    if (!agentName) return

    try {
      const parentTask = subtask.parent_task_id
        ? this.getTask(subtask.parent_task_id)
        : null
      const taskContext: TaskContext = {
        task: subtask.title,
        parentTask: parentTask?.title ?? undefined,
      }
      const rawResponse = await this.callAgent(agentName, taskContext)
      await this.handleSpecialistResponse(subtask.id, rawResponse)
    } catch (err) {
      // Mark subtask as failed
      this.db.prepare(
        'UPDATE tasks SET status = ?, metadata = ?, updated_at = unixepoch() WHERE id = ?',
      ).run(
        'done',
        JSON.stringify({
          ...this.getTaskMetadata(subtask.id),
          specialist_status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        }),
        subtask.id,
      )
      this.transitionState(subtask.id, 'FAILED')

      // Check sibling completion even on failure
      if (subtask.parent_task_id != null) {
        const siblings = this.getChildTasks(subtask.parent_task_id)
        const specialistSiblings = siblings.filter(
          (s) => s.assigned_to != null && s.assigned_to !== 'nexus',
        )
        const allDone =
          specialistSiblings.length > 0 &&
          specialistSiblings.every((s) => {
            const meta = this.getTaskMetadata(s.id)
            const specStatus = meta?.specialist_status
            return specStatus === 'complete' || specStatus === 'failed'
          })
        if (allDone) {
          this.transitionState(subtask.parent_task_id, 'SUBTASKS_COMPLETE')
          await this.processTask(subtask.parent_task_id)
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  transitionState(taskId: number, newState: OrchestrationState): void {
    // 1. Update orchestration_state in DB
    this.db.prepare(
      'UPDATE tasks SET orchestration_state = ?, updated_at = unixepoch() WHERE id = ?',
    ).run(newState, taskId)

    // 2. Update task status using syncOrchestrationStatus
    const mappedStatus = syncOrchestrationStatus(newState)
    if (mappedStatus) {
      this.db.prepare('UPDATE tasks SET status = ?, updated_at = unixepoch() WHERE id = ?').run(
        mappedStatus,
        taskId,
      )
    }

    // 3. Broadcast event via eventBus
    const eventType = STATE_EVENT_MAP[newState]
    if (eventType) {
      eventBus.broadcast(eventType, { taskId, state: newState })
    }

    // 4. Post status update to Discord #taskboard
    const task = this.getTask(taskId)
    if (task && this.discord) {
      this.discord
        .postTaskUpdate(task.title, mappedStatus ?? newState, task.assigned_to ?? undefined)
        .catch(() => {
          /* swallow Discord post failures */
        })
    }
  }

  // -----------------------------------------------------------------------
  // DB helpers
  // -----------------------------------------------------------------------

  private createTask(opts: {
    title: string
    description?: string
    status?: string
    orchestrationState?: OrchestrationState
    createdBy?: string
    parentTaskId?: number
    assignedTo?: string
    priority?: string
    metadata?: Record<string, unknown>
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO tasks (title, description, status, orchestration_state, created_by, parent_task_id, assigned_to, priority, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.title,
        opts.description ?? null,
        opts.status ?? 'inbox',
        opts.orchestrationState ?? null,
        opts.createdBy ?? 'system',
        opts.parentTaskId ?? null,
        opts.assignedTo ?? null,
        opts.priority ?? 'medium',
        opts.metadata ? JSON.stringify(opts.metadata) : null,
      )
    return Number(result.lastInsertRowid)
  }

  createSubtask(
    parentId: number,
    title: string,
    assignedTo: string,
    metadata?: Record<string, unknown>,
  ): number {
    return this.createTask({
      title,
      parentTaskId: parentId,
      assignedTo,
      orchestrationState: 'CREATED',
      metadata,
    })
  }

  private getTask(taskId: number): TaskRow | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow | undefined
    return row ?? null
  }

  private getChildTasks(parentId: number): TaskRow[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE parent_task_id = ?')
      .all(parentId) as TaskRow[]
  }

  private getTaskMetadata(taskId: number): Record<string, unknown> | null {
    const task = this.getTask(taskId)
    if (!task?.metadata) return null
    try {
      return JSON.parse(task.metadata) as Record<string, unknown>
    } catch {
      return null
    }
  }

  private updateTaskMetadata(
    taskId: number,
    updates: Record<string, unknown>,
  ): void {
    const existing = this.getTaskMetadata(taskId) ?? {}
    const merged = { ...existing, ...updates }
    this.db.prepare('UPDATE tasks SET metadata = ?, updated_at = unixepoch() WHERE id = ?').run(
      JSON.stringify(merged),
      taskId,
    )
  }

  private setTaskError(taskId: number, errorMessage: string): void {
    this.updateTaskMetadata(taskId, { error: errorMessage })
  }

  private getSubtaskResult(task: TaskRow): string {
    if (!task.metadata) return '(no result)'
    try {
      const meta = JSON.parse(task.metadata) as Record<string, unknown>
      return (meta.result as string) ?? '(no result)'
    } catch {
      return '(no result)'
    }
  }

  // -----------------------------------------------------------------------
  // Concurrency management
  // -----------------------------------------------------------------------

  private acquireConcurrencySlot(): Promise<void> {
    if (this.activeCalls < this.maxConcurrent) {
      this.activeCalls++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeCalls++
        resolve()
      })
    })
  }

  private releaseConcurrencySlot(): void {
    this.activeCalls--
    const next = this.waitQueue.shift()
    if (next) next()
  }

  private async waitForProviderGap(provider: string): Promise<void> {
    const last = this.providerLastCall.get(provider)
    if (last != null) {
      const elapsed = Date.now() - last
      if (elapsed < this.providerMinGap) {
        await this.sleep(this.providerMinGap - elapsed)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Parse with retry (one retry on JSON parse failure)
  // -----------------------------------------------------------------------

  private async parseWithRetry<T>(
    agentName: string,
    schema: { safeParse(data: unknown): { success: boolean; data?: T; error?: unknown } },
    rawResponse: string,
    retryContext: TaskContext,
  ): Promise<T> {
    // Attempt 1: parse raw response
    const json = this.extractJson(rawResponse)
    const result = schema.safeParse(json)
    if (result.success && result.data) return result.data

    // Attempt 2: retry with JSON format nudge
    const retryResponse = await this.callAgent(agentName, {
      ...retryContext,
      task: `${retryContext.task}\n\nIMPORTANT: You must respond with valid JSON. Your previous response could not be parsed. Please respond ONLY with a valid JSON object.`,
    })
    const retryJson = this.extractJson(retryResponse)
    const retryResult = schema.safeParse(retryJson)
    if (retryResult.success && retryResult.data) return retryResult.data

    throw new Error(
      `Schema validation failed for ${agentName} after retry: ${JSON.stringify(retryResult.error)}`,
    )
  }

  private extractJson(raw: string): unknown {
    // Try direct parse first
    try {
      return JSON.parse(raw)
    } catch {
      // Try extracting from markdown code fence
      const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
      if (fenceMatch?.[1]) {
        try {
          return JSON.parse(fenceMatch[1])
        } catch {
          // fall through
        }
      }
      // Try finding a JSON object in the text
      const objectMatch = raw.match(/\{[\s\S]*\}/)
      if (objectMatch?.[0]) {
        try {
          return JSON.parse(objectMatch[0])
        } catch {
          // fall through
        }
      }
      return raw
    }
  }

  // -----------------------------------------------------------------------
  // Discord / Chat helpers
  // -----------------------------------------------------------------------

  private async postAgentMessage(agentName: string, message: string): Promise<void> {
    if (!this.discord) return
    try {
      await this.discord.postAsAgent('general', agentName, message)
    } catch {
      // Swallow Discord failures
    }
  }

  private broadcastChat(agentName: string, message: string): void {
    eventBus.broadcast('chat.message', {
      from_agent: agentName,
      content: message,
      conversation_id: 'orchestration',
    })
  }

  // -----------------------------------------------------------------------
  // Utility
  // -----------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
