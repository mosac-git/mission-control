import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { getSubtasks, getParentChain, buildTaskTree, type TaskLike } from '../task-tree'

// ---------------------------------------------------------------------------
// DB schema tests (existing coverage for migration 042)
// ---------------------------------------------------------------------------

describe('task tree schema', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'inbox',
        assigned_to TEXT,
        parent_task_id INTEGER REFERENCES tasks(id),
        orchestration_state TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
      CREATE INDEX idx_tasks_orch_state ON tasks(orchestration_state);
    `)
  })

  it('supports parent-child task relationships', () => {
    db.prepare('INSERT INTO tasks (title, status) VALUES (?, ?)').run('Parent task', 'inbox')
    const parent = db.prepare('SELECT id FROM tasks WHERE title = ?').get('Parent task') as any
    db.prepare('INSERT INTO tasks (title, status, parent_task_id) VALUES (?, ?, ?)').run('Subtask', 'inbox', parent.id)
    const subtask = db.prepare('SELECT * FROM tasks WHERE parent_task_id = ?').get(parent.id) as any
    expect(subtask.title).toBe('Subtask')
    expect(subtask.parent_task_id).toBe(parent.id)
  })

  it('supports orchestration_state column', () => {
    db.prepare('INSERT INTO tasks (title, orchestration_state) VALUES (?, ?)').run('Test', 'SHADOW_ANALYZING')
    const task = db.prepare('SELECT orchestration_state FROM tasks WHERE title = ?').get('Test') as any
    expect(task.orchestration_state).toBe('SHADOW_ANALYZING')
  })

  it('retrieves full task tree', () => {
    db.prepare('INSERT INTO tasks (title) VALUES (?)').run('Root')
    const root = db.prepare('SELECT id FROM tasks WHERE title = ?').get('Root') as any
    db.prepare('INSERT INTO tasks (title, parent_task_id) VALUES (?, ?)').run('Child 1', root.id)
    db.prepare('INSERT INTO tasks (title, parent_task_id) VALUES (?, ?)').run('Child 2', root.id)
    const children = db.prepare('SELECT * FROM tasks WHERE parent_task_id = ?').all(root.id) as any[]
    expect(children).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// getSubtasks
// ---------------------------------------------------------------------------

describe('getSubtasks', () => {
  const tasks: TaskLike[] = [
    { id: 1, title: 'Root', parent_task_id: null },
    { id: 2, title: 'Child A', parent_task_id: 1 },
    { id: 3, title: 'Child B', parent_task_id: 1 },
    { id: 4, title: 'Grandchild', parent_task_id: 2 },
    { id: 5, title: 'Orphan', parent_task_id: 99 },
  ]

  it('returns direct children of a parent', () => {
    const result = getSubtasks(tasks, 1)
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.title)).toEqual(['Child A', 'Child B'])
  })

  it('returns empty array for leaf node', () => {
    expect(getSubtasks(tasks, 4)).toEqual([])
  })

  it('returns empty array for nonexistent parent', () => {
    expect(getSubtasks(tasks, 999)).toEqual([])
  })

  it('returns nested children (not grandchildren)', () => {
    const result = getSubtasks(tasks, 2)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Grandchild')
  })
})

// ---------------------------------------------------------------------------
// getParentChain
// ---------------------------------------------------------------------------

describe('getParentChain', () => {
  const tasks: TaskLike[] = [
    { id: 1, title: 'Root', parent_task_id: null },
    { id: 2, title: 'L1', parent_task_id: 1 },
    { id: 3, title: 'L2', parent_task_id: 2 },
    { id: 4, title: 'L3', parent_task_id: 3 },
  ]

  it('returns ancestor chain from task to root', () => {
    const chain = getParentChain(tasks, 4)
    expect(chain.map((t) => t.title)).toEqual(['L2', 'L1', 'Root'])
  })

  it('returns empty array for root task', () => {
    expect(getParentChain(tasks, 1)).toEqual([])
  })

  it('returns empty array for unknown task ID', () => {
    expect(getParentChain(tasks, 999)).toEqual([])
  })

  it('returns single parent for direct child of root', () => {
    const chain = getParentChain(tasks, 2)
    expect(chain).toHaveLength(1)
    expect(chain[0].title).toBe('Root')
  })

  it('handles cycle without infinite loop', () => {
    const cyclic: TaskLike[] = [
      { id: 1, title: 'A', parent_task_id: 2 },
      { id: 2, title: 'B', parent_task_id: 1 },
    ]
    // Should terminate without throwing
    const chain = getParentChain(cyclic, 1)
    expect(chain.length).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// buildTaskTree
// ---------------------------------------------------------------------------

describe('buildTaskTree', () => {
  it('returns null for empty array', () => {
    expect(buildTaskTree([])).toBeNull()
  })

  it('builds single-node tree', () => {
    const tasks: TaskLike[] = [{ id: 1, title: 'Only', parent_task_id: null }]
    const tree = buildTaskTree(tasks)
    expect(tree).not.toBeNull()
    expect(tree!.title).toBe('Only')
    expect(tree!.children).toEqual([])
  })

  it('builds two-level tree', () => {
    const tasks: TaskLike[] = [
      { id: 1, title: 'Root', parent_task_id: null },
      { id: 2, title: 'Child A', parent_task_id: 1 },
      { id: 3, title: 'Child B', parent_task_id: 1 },
    ]
    const tree = buildTaskTree(tasks)
    expect(tree!.title).toBe('Root')
    expect(tree!.children).toHaveLength(2)
    expect(tree!.children.map((c) => c.title).sort()).toEqual(['Child A', 'Child B'])
  })

  it('builds three-level tree', () => {
    const tasks: TaskLike[] = [
      { id: 1, title: 'Root', parent_task_id: null },
      { id: 2, title: 'Mid', parent_task_id: 1 },
      { id: 3, title: 'Leaf', parent_task_id: 2 },
    ]
    const tree = buildTaskTree(tasks)
    expect(tree!.title).toBe('Root')
    expect(tree!.children).toHaveLength(1)
    expect(tree!.children[0].title).toBe('Mid')
    expect(tree!.children[0].children).toHaveLength(1)
    expect(tree!.children[0].children[0].title).toBe('Leaf')
  })

  it('preserves extra properties on nodes', () => {
    const tasks: TaskLike[] = [
      { id: 1, title: 'Root', parent_task_id: null, status: 'inbox', priority: 'high' },
    ]
    const tree = buildTaskTree(tasks)
    expect(tree!.status).toBe('inbox')
    expect(tree!.priority).toBe('high')
  })
})
