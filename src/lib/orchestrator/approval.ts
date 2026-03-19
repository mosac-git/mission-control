/**
 * Approval flow module for Shadow Collective orchestration.
 *
 * Handles approval requests from agents, stores pending approvals in DB
 * metadata, broadcasts events, and processes approval responses from
 * Discord reactions or the MC panel.
 */

import { eventBus } from '@/lib/event-bus'
import type { EngineDb } from './engine'

export interface ApprovalRequest {
  taskId: number
  agentName: string
  reason: string
  previousState: string // orchestration state before BLOCKED, to resume to
}

// In-memory map of pending approvals keyed by taskId
const pendingApprovals = new Map<number, ApprovalRequest>()

/**
 * Request approval for a task.
 *
 * Sets the task's orchestration_state to BLOCKED, persists approval metadata
 * to the DB, and broadcasts an `approval.requested` event.
 *
 * @param taskId       - ID of the task requiring approval.
 * @param agentName    - Name of the agent requesting approval.
 * @param reason       - Human-readable reason for the approval request.
 * @param previousState - The orchestration state the task was in before
 *                        blocking, so it can resume correctly on approval.
 * @param db           - Database connection (injected for testability;
 *                       defaults to the production database).
 */
export function requestApproval(
  taskId: number,
  agentName: string,
  reason: string,
  previousState: string,
  db?: EngineDb,
): void {
  const database = db ?? getProductionDb()

  // Merge approval metadata into existing task metadata
  const task = database.prepare('SELECT metadata FROM tasks WHERE id = ?').get(taskId) as
    | { metadata: string | null }
    | undefined

  const metadata: Record<string, unknown> = task?.metadata
    ? (JSON.parse(task.metadata) as Record<string, unknown>)
    : {}

  metadata.approval_pending = true
  metadata.approval_reason = reason
  metadata.approval_agent = agentName
  metadata.approval_previous_state = previousState

  database
    .prepare(
      "UPDATE tasks SET orchestration_state = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .run('BLOCKED', JSON.stringify(metadata), taskId)

  // Track in memory for fast lookup
  pendingApprovals.set(taskId, { taskId, agentName, reason, previousState })

  eventBus.broadcast('approval.requested', { taskId, agentName, reason })
}

/**
 * Handle an approval response (approved or denied).
 *
 * When approved the task resumes from the state it was in before BLOCKED.
 * When denied the task is transitioned to CANCELLED with status `done`.
 *
 * No-op if the task does not exist or is not currently in BLOCKED state.
 *
 * @param taskId      - ID of the task being responded to.
 * @param approved    - Whether the request was approved.
 * @param respondedBy - Username or source of the response (Discord / MC panel).
 * @param db          - Database connection (injected for testability).
 */
export function handleApprovalResponse(
  taskId: number,
  approved: boolean,
  respondedBy: string,
  db?: EngineDb,
): void {
  const database = db ?? getProductionDb()

  const task = database
    .prepare('SELECT metadata, orchestration_state FROM tasks WHERE id = ?')
    .get(taskId) as { metadata: string | null; orchestration_state: string | null } | undefined

  if (!task || task.orchestration_state !== 'BLOCKED') return

  const metadata: Record<string, unknown> = task.metadata
    ? (JSON.parse(task.metadata) as Record<string, unknown>)
    : {}

  // Recover the state to resume to (fall back to CREATED if metadata missing)
  const previousState = (metadata.approval_previous_state as string | undefined) ?? 'CREATED'

  // Strip approval-specific keys and record response info
  delete metadata.approval_pending
  delete metadata.approval_reason
  delete metadata.approval_agent
  delete metadata.approval_previous_state

  metadata.approval_responded_by = respondedBy
  metadata.approval_approved = approved

  if (approved) {
    database
      .prepare(
        "UPDATE tasks SET orchestration_state = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(previousState, JSON.stringify(metadata), taskId)
  } else {
    database
      .prepare(
        "UPDATE tasks SET orchestration_state = ?, status = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run('CANCELLED', 'done', JSON.stringify(metadata), taskId)
  }

  pendingApprovals.delete(taskId)

  eventBus.broadcast('approval.response', { taskId, approved, respondedBy })
}

/**
 * Return all currently pending approval requests (in-memory snapshot).
 */
export function getPendingApprovals(): ApprovalRequest[] {
  return Array.from(pendingApprovals.values())
}

/**
 * Clear all pending approvals (useful for testing cleanup).
 */
export function clearPendingApprovals(): void {
  pendingApprovals.clear()
}

// ---------------------------------------------------------------------------
// Internal: lazy-load the production DB to avoid import-time side effects
// ---------------------------------------------------------------------------

function getProductionDb(): EngineDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getDatabase } = require('../db') as { getDatabase: () => EngineDb }
  return getDatabase()
}
