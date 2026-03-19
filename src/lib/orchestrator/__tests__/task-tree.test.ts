import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'

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
