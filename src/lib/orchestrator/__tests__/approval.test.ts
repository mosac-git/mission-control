import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import type { EngineDb } from '../engine'
import {
  requestApproval,
  handleApprovalResponse,
  getPendingApprovals,
  clearPendingApprovals,
} from '../approval'

// ---------------------------------------------------------------------------
// Mock the event bus so we can spy on broadcasts without needing a real server.
// vi.mock is hoisted to the top of the file, so we must not reference outer
// variables in the factory — use vi.fn() inline and retrieve it via import.
// ---------------------------------------------------------------------------

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

// Retrieve the mocked reference after mock registration
import { eventBus } from '@/lib/event-bus'
const broadcastMock = eventBus.broadcast as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// In-memory SQLite helper — mirrors the schema used in engine.test.ts
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
  return db
}

/** Insert a minimal task and return its ID */
function insertTask(
  db: Database.Database,
  opts: {
    orchestration_state?: string
    metadata?: Record<string, unknown>
    status?: string
  } = {},
): number {
  const result = db
    .prepare(
      `INSERT INTO tasks (title, orchestration_state, metadata, status)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      'Test task',
      opts.orchestration_state ?? 'AGENTS_WORKING',
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      opts.status ?? 'in_progress',
    )
  return Number(result.lastInsertRowid)
}

function getTask(
  db: Database.Database,
  taskId: number,
): { orchestration_state: string | null; metadata: string | null; status: string } {
  return db.prepare('SELECT orchestration_state, metadata, status FROM tasks WHERE id = ?').get(
    taskId,
  ) as { orchestration_state: string | null; metadata: string | null; status: string }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('approval flow', () => {
  let db: Database.Database
  let engineDb: EngineDb

  beforeEach(() => {
    db = createTestDb()
    engineDb = db as unknown as EngineDb
    broadcastMock.mockClear()
    clearPendingApprovals()
  })

  afterEach(() => {
    db.close()
  })

  // -------------------------------------------------------------------------
  // 1. requestApproval sets task to BLOCKED state in DB
  // -------------------------------------------------------------------------

  describe('requestApproval', () => {
    it('sets orchestration_state to BLOCKED', () => {
      const taskId = insertTask(db, { orchestration_state: 'AGENTS_WORKING' })

      requestApproval(taskId, 'shadow', 'Needs human sign-off', 'AGENTS_WORKING', engineDb)

      const task = getTask(db, taskId)
      expect(task.orchestration_state).toBe('BLOCKED')
    })

    it('persists approval metadata including previous state', () => {
      const taskId = insertTask(db, { orchestration_state: 'SHADOW_REVIEWING' })

      requestApproval(taskId, 'shadow', 'High cost operation', 'SHADOW_REVIEWING', engineDb)

      const task = getTask(db, taskId)
      const meta = JSON.parse(task.metadata ?? '{}') as Record<string, unknown>

      expect(meta.approval_pending).toBe(true)
      expect(meta.approval_reason).toBe('High cost operation')
      expect(meta.approval_agent).toBe('shadow')
      expect(meta.approval_previous_state).toBe('SHADOW_REVIEWING')
    })

    it('merges with existing task metadata without destroying it', () => {
      const taskId = insertTask(db, {
        orchestration_state: 'AGENTS_WORKING',
        metadata: { existing_key: 'keep me' },
      })

      requestApproval(taskId, 'nexus', 'Approval needed', 'AGENTS_WORKING', engineDb)

      const task = getTask(db, taskId)
      const meta = JSON.parse(task.metadata ?? '{}') as Record<string, unknown>
      expect(meta.existing_key).toBe('keep me')
      expect(meta.approval_pending).toBe(true)
    })

    // -----------------------------------------------------------------------
    // 2. requestApproval broadcasts approval.requested event
    // -----------------------------------------------------------------------

    it('broadcasts approval.requested event with correct payload', () => {
      const taskId = insertTask(db)

      requestApproval(taskId, 'shadow', 'Requires sign-off', 'AGENTS_WORKING', engineDb)

      expect(broadcastMock).toHaveBeenCalledOnce()
      expect(broadcastMock).toHaveBeenCalledWith('approval.requested', {
        taskId,
        agentName: 'shadow',
        reason: 'Requires sign-off',
      })
    })

    // -----------------------------------------------------------------------
    // 5. Approval stores previous state so it can resume correctly
    // -----------------------------------------------------------------------

    it('adds the request to the in-memory pending approvals map', () => {
      const taskId = insertTask(db, { orchestration_state: 'NEXUS_CONSOLIDATING' })

      requestApproval(taskId, 'nexus', 'Checking with human', 'NEXUS_CONSOLIDATING', engineDb)

      const pending = getPendingApprovals()
      const entry = pending.find((p) => p.taskId === taskId)

      expect(entry).toBeDefined()
      expect(entry?.previousState).toBe('NEXUS_CONSOLIDATING')
      expect(entry?.agentName).toBe('nexus')
    })
  })

  // -------------------------------------------------------------------------
  // 3. handleApprovalResponse approved=true resumes from previous state
  // -------------------------------------------------------------------------

  describe('handleApprovalResponse — approved', () => {
    it('transitions task back to the stored previous state', () => {
      const taskId = insertTask(db, { orchestration_state: 'AGENTS_WORKING' })
      requestApproval(taskId, 'shadow', 'Approve me', 'AGENTS_WORKING', engineDb)

      handleApprovalResponse(taskId, true, 'sachin', engineDb)

      const task = getTask(db, taskId)
      expect(task.orchestration_state).toBe('AGENTS_WORKING')
    })

    it('clears approval-specific metadata keys on approval', () => {
      const taskId = insertTask(db)
      requestApproval(taskId, 'shadow', 'Please approve', 'SHADOW_REVIEWING', engineDb)

      handleApprovalResponse(taskId, true, 'admin', engineDb)

      const task = getTask(db, taskId)
      const meta = JSON.parse(task.metadata ?? '{}') as Record<string, unknown>

      expect(meta.approval_pending).toBeUndefined()
      expect(meta.approval_reason).toBeUndefined()
      expect(meta.approval_agent).toBeUndefined()
      expect(meta.approval_previous_state).toBeUndefined()
    })

    it('records who responded and the approval decision in metadata', () => {
      const taskId = insertTask(db)
      requestApproval(taskId, 'shadow', 'Approve', 'AGENTS_WORKING', engineDb)

      handleApprovalResponse(taskId, true, 'sachin', engineDb)

      const meta = JSON.parse(getTask(db, taskId).metadata ?? '{}') as Record<string, unknown>
      expect(meta.approval_responded_by).toBe('sachin')
      expect(meta.approval_approved).toBe(true)
    })

    it('broadcasts approval.response event with approved=true', () => {
      const taskId = insertTask(db)
      requestApproval(taskId, 'shadow', 'Approve', 'AGENTS_WORKING', engineDb)
      broadcastMock.mockClear()

      handleApprovalResponse(taskId, true, 'sachin', engineDb)

      expect(broadcastMock).toHaveBeenCalledOnce()
      expect(broadcastMock).toHaveBeenCalledWith('approval.response', {
        taskId,
        approved: true,
        respondedBy: 'sachin',
      })
    })

    it('removes the entry from in-memory pending approvals on approval', () => {
      const taskId = insertTask(db)
      requestApproval(taskId, 'shadow', 'Approve', 'AGENTS_WORKING', engineDb)

      handleApprovalResponse(taskId, true, 'sachin', engineDb)

      const pending = getPendingApprovals()
      expect(pending.find((p) => p.taskId === taskId)).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // 4. handleApprovalResponse approved=false transitions to CANCELLED
  // -------------------------------------------------------------------------

  describe('handleApprovalResponse — denied', () => {
    it('transitions task to CANCELLED state', () => {
      const taskId = insertTask(db)
      requestApproval(taskId, 'nexus', 'Needs approval', 'AGENTS_WORKING', engineDb)

      handleApprovalResponse(taskId, false, 'admin', engineDb)

      const task = getTask(db, taskId)
      expect(task.orchestration_state).toBe('CANCELLED')
    })

    it('sets task status to done on denial', () => {
      const taskId = insertTask(db, { status: 'in_progress' })
      requestApproval(taskId, 'nexus', 'Needs approval', 'AGENTS_WORKING', engineDb)

      handleApprovalResponse(taskId, false, 'admin', engineDb)

      const task = getTask(db, taskId)
      expect(task.status).toBe('done')
    })

    it('records denial in metadata', () => {
      const taskId = insertTask(db)
      requestApproval(taskId, 'shadow', 'Please approve', 'SHADOW_REVIEWING', engineDb)

      handleApprovalResponse(taskId, false, 'admin', engineDb)

      const meta = JSON.parse(getTask(db, taskId).metadata ?? '{}') as Record<string, unknown>
      expect(meta.approval_responded_by).toBe('admin')
      expect(meta.approval_approved).toBe(false)
    })

    it('broadcasts approval.response event with approved=false', () => {
      const taskId = insertTask(db)
      requestApproval(taskId, 'shadow', 'Needs approval', 'AGENTS_WORKING', engineDb)
      broadcastMock.mockClear()

      handleApprovalResponse(taskId, false, 'admin', engineDb)

      expect(broadcastMock).toHaveBeenCalledOnce()
      expect(broadcastMock).toHaveBeenCalledWith('approval.response', {
        taskId,
        approved: false,
        respondedBy: 'admin',
      })
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('is a no-op when task does not exist', () => {
      // Should not throw
      expect(() => handleApprovalResponse(99999, true, 'admin', engineDb)).not.toThrow()
      expect(broadcastMock).not.toHaveBeenCalled()
    })

    it('is a no-op when task is not in BLOCKED state', () => {
      const taskId = insertTask(db, { orchestration_state: 'AGENTS_WORKING' })

      handleApprovalResponse(taskId, true, 'admin', engineDb)

      // State should remain unchanged since it was never BLOCKED
      expect(getTask(db, taskId).orchestration_state).toBe('AGENTS_WORKING')
      expect(broadcastMock).not.toHaveBeenCalled()
    })

    it('falls back to CREATED as previous state when metadata is missing', () => {
      // Manually insert a BLOCKED task with no metadata
      const taskId = insertTask(db, { orchestration_state: 'BLOCKED', metadata: {} })

      handleApprovalResponse(taskId, true, 'admin', engineDb)

      expect(getTask(db, taskId).orchestration_state).toBe('CREATED')
    })

    it('getPendingApprovals returns all pending entries', () => {
      const id1 = insertTask(db)
      const id2 = insertTask(db)

      requestApproval(id1, 'shadow', 'First', 'AGENTS_WORKING', engineDb)
      requestApproval(id2, 'nexus', 'Second', 'SHADOW_REVIEWING', engineDb)

      const pending = getPendingApprovals()
      expect(pending).toHaveLength(2)
      expect(pending.map((p) => p.taskId).sort()).toEqual([id1, id2].sort())
    })
  })
})
