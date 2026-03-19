import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getOrchestrationEngine } from '@/lib/orchestrator'

/**
 * POST /api/orchestrator — Submit a task to the orchestration engine.
 * Body: { message: string, source?: 'discord' | 'mc-chat' }
 * Returns: { taskId: number, status: 'ok' }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: '"message" is required' }, { status: 400 })
    }

    const source: 'discord' | 'mc-chat' =
      body.source === 'discord' ? 'discord' : 'mc-chat'

    const engine = getOrchestrationEngine()
    const taskId = await engine.handleUserMessage(message, source)

    logger.info({ taskId, source }, 'Orchestration task created')
    return NextResponse.json({ taskId, status: 'ok' }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/orchestrator error')
    return NextResponse.json({ error: 'Failed to start orchestration' }, { status: 500 })
  }
}

/**
 * GET /api/orchestrator?taskId=<id> — Check orchestration status.
 * Returns: { task, subtasks, orchestration_state }
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const taskIdParam = searchParams.get('taskId')
    if (!taskIdParam) {
      return NextResponse.json({ error: '"taskId" query param is required' }, { status: 400 })
    }

    const taskId = parseInt(taskIdParam, 10)
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return NextResponse.json({ error: 'Invalid taskId' }, { status: 400 })
    }

    const db = getDatabase()

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const subtasks = db
      .prepare('SELECT * FROM tasks WHERE parent_task_id = ?')
      .all(taskId) as Record<string, unknown>[]

    // Parse metadata JSON for task and subtasks
    function parseTaskMetadata(row: Record<string, unknown>): Record<string, unknown> {
      if (typeof row.metadata === 'string') {
        try {
          return { ...row, metadata: JSON.parse(row.metadata) }
        } catch {
          return row
        }
      }
      return row
    }

    return NextResponse.json({
      task: parseTaskMetadata(task),
      subtasks: subtasks.map(parseTaskMetadata),
      orchestration_state: task.orchestration_state ?? null,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/orchestrator error')
    return NextResponse.json({ error: 'Failed to fetch orchestration status' }, { status: 500 })
  }
}

/**
 * DELETE /api/orchestrator?taskId=<id> — Cancel an orchestration.
 * Updates orchestration_state to CANCELLED and status to done.
 * Returns: { status: 'cancelled' }
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const taskIdParam = searchParams.get('taskId')
    if (!taskIdParam) {
      return NextResponse.json({ error: '"taskId" query param is required' }, { status: 400 })
    }

    const taskId = parseInt(taskIdParam, 10)
    if (!Number.isFinite(taskId) || taskId <= 0) {
      return NextResponse.json({ error: 'Invalid taskId' }, { status: 400 })
    }

    const db = getDatabase()

    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    db.prepare(
      'UPDATE tasks SET orchestration_state = ?, status = ?, updated_at = unixepoch() WHERE id = ?',
    ).run('CANCELLED', 'done', taskId)

    logger.info({ taskId }, 'Orchestration task cancelled')
    return NextResponse.json({ status: 'cancelled' })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/orchestrator error')
    return NextResponse.json({ error: 'Failed to cancel orchestration' }, { status: 500 })
  }
}
