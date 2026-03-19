import type { Task } from './db'

export type TaskStatus = Task['status']

function hasAssignee(assignedTo: string | null | undefined): boolean {
  return Boolean(assignedTo && assignedTo.trim())
}

/**
 * Keep task state coherent when a task is created with an assignee.
 * If caller asks for `inbox` but also sets `assigned_to`, normalize to `assigned`.
 */
export function normalizeTaskCreateStatus(
  requestedStatus: TaskStatus | undefined,
  assignedTo: string | undefined
): TaskStatus {
  const status = requestedStatus ?? 'inbox'
  if (status === 'inbox' && hasAssignee(assignedTo)) return 'assigned'
  return status
}

/**
 * Auto-adjust status for assignment-only updates when caller does not
 * explicitly request a status transition.
 */
export function normalizeTaskUpdateStatus(args: {
  currentStatus: TaskStatus
  requestedStatus: TaskStatus | undefined
  assignedTo: string | null | undefined
  assignedToProvided: boolean
}): TaskStatus | undefined {
  const { currentStatus, requestedStatus, assignedTo, assignedToProvided } = args
  if (requestedStatus !== undefined) return requestedStatus
  if (!assignedToProvided) return undefined

  if (hasAssignee(assignedTo) && currentStatus === 'inbox') return 'assigned'
  if (!hasAssignee(assignedTo) && currentStatus === 'assigned') return 'inbox'
  return undefined
}

/**
 * Map an orchestration engine state string to the nearest Task status.
 * Returns undefined if the state is unrecognised (caller should leave status unchanged).
 */
export function syncOrchestrationStatus(orchestrationState: string): TaskStatus | undefined {
  switch (orchestrationState) {
    case 'CREATED':
      return 'inbox'

    case 'SHADOW_ANALYZING':
      return 'assigned'

    case 'DELEGATED_TO_NEXUS':
    case 'NEXUS_BREAKING_DOWN':
    case 'SUBTASKS_ASSIGNED':
    case 'AGENTS_WORKING':
    case 'BLOCKED':
      return 'in_progress'

    case 'SUBTASKS_COMPLETE':
    case 'NEXUS_CONSOLIDATING':
      return 'review'

    case 'SHADOW_REVIEWING':
      return 'quality_review'

    case 'COMPLETE':
    case 'REPORTED':
    case 'FAILED':
    case 'TIMED_OUT':
    case 'CANCELLED':
      return 'done'

    default:
      return undefined
  }
}

