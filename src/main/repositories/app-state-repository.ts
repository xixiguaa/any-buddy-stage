import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { AppState, Workspace, Task, TaskWorkspace, Message, TaskDraft, AgentRun, AgentEvent, HumanApproval, AppSettings } from '../../shared/types.js'

export class AppStateRepository {
  private db: Database.Database | null = null

  constructor(private readonly filePath: string) {}

  private initDb() {
    if (this.db) return this.db

    // Ensure path directory exists
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })

    const db = new Database(this.filePath)
    
    // Enable WAL mode for better concurrency and write performance
    db.pragma('journal_mode = WAL')

    // Create database schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        icon TEXT,
        defaultPermissionMode TEXT NOT NULL,
        isArchived INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastOpenedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        modelId TEXT NOT NULL,
        expertId TEXT,
        primaryWorkspaceId TEXT,
        permissionMode TEXT NOT NULL,
        connectorIds TEXT NOT NULL,
        skillIds TEXT NOT NULL,
        status TEXT NOT NULL,
        unreadEventCount INTEGER NOT NULL DEFAULT 0,
        lastRunId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_workspaces (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        workspaceId TEXT NOT NULL,
        role TEXT NOT NULL,
        accessMode TEXT NOT NULL,
        addedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        runId TEXT,
        workspaceId TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS drafts (
        taskId TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        selectedSkillIds TEXT NOT NULL,
        selectedConnectorIds TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        workspaceIds TEXT NOT NULL,
        parentRunId TEXT,
        agentId TEXT NOT NULL,
        agentName TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        graphThreadId TEXT NOT NULL,
        checkpointId TEXT,
        currentNode TEXT,
        startedAt TEXT,
        completedAt TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_events (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        runId TEXT NOT NULL,
        parentRunId TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        taskId TEXT NOT NULL,
        runId TEXT NOT NULL,
        toolCallId TEXT,
        reason TEXT NOT NULL,
        originalArgs TEXT,
        editedArgs TEXT,
        decision TEXT NOT NULL,
        decidedAt TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    this.db = db
    return db
  }

  async load(initialState: AppState): Promise<AppState> {
    const db = this.initDb()

    // Check if the database has any tasks or workspaces, if not, seed with initial state
    const workspaceCount = (db.prepare('SELECT count(*) as count FROM workspaces').get() as { count: number }).count
    if (workspaceCount === 0) {
      await this.save(initialState)
      return initialState
    }

    // Load workspaces
    const workspacesRows = db.prepare('SELECT * FROM workspaces').all() as any[]
    const workspaces: Workspace[] = workspacesRows.map(row => ({
      id: row.id,
      name: row.name,
      path: row.path,
      icon: row.icon || undefined,
      defaultPermissionMode: row.defaultPermissionMode as any,
      isArchived: Boolean(row.isArchived),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastOpenedAt: row.lastOpenedAt || undefined,
    }))

    // Load tasks
    const tasksRows = db.prepare('SELECT * FROM tasks').all() as any[]
    const tasks: Task[] = tasksRows.map(row => ({
      id: row.id,
      title: row.title,
      mode: row.mode as any,
      modelId: row.modelId,
      expertId: row.expertId || undefined,
      primaryWorkspaceId: row.primaryWorkspaceId || undefined,
      permissionMode: row.permissionMode as any,
      connectorIds: JSON.parse(row.connectorIds),
      skillIds: JSON.parse(row.skillIds),
      status: row.status as any,
      unreadEventCount: row.unreadEventCount,
      lastRunId: row.lastRunId || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))

    // Load taskWorkspaces
    const taskWorkspacesRows = db.prepare('SELECT * FROM task_workspaces').all() as any[]
    const taskWorkspaces: TaskWorkspace[] = taskWorkspacesRows.map(row => ({
      id: row.id,
      taskId: row.taskId,
      workspaceId: row.workspaceId,
      role: row.role as any,
      accessMode: row.accessMode as any,
      addedAt: row.addedAt,
    }))

    // Load messages
    const messagesRows = db.prepare('SELECT * FROM messages').all() as any[]
    const messages: Message[] = messagesRows.map(row => ({
      id: row.id,
      taskId: row.taskId,
      runId: row.runId || undefined,
      workspaceId: row.workspaceId || undefined,
      role: row.role as any,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.createdAt,
    }))

    // Load drafts
    const draftsRows = db.prepare('SELECT * FROM drafts').all() as any[]
    const drafts: TaskDraft[] = draftsRows.map(row => ({
      taskId: row.taskId,
      content: row.content,
      selectedSkillIds: JSON.parse(row.selectedSkillIds),
      selectedConnectorIds: JSON.parse(row.selectedConnectorIds),
      updatedAt: row.updatedAt,
    }))

    // Load agentRuns
    const agentRunsRows = db.prepare('SELECT * FROM agent_runs').all() as any[]
    const agentRuns: AgentRun[] = agentRunsRows.map(row => ({
      id: row.id,
      taskId: row.taskId,
      workspaceIds: JSON.parse(row.workspaceIds),
      parentRunId: row.parentRunId || undefined,
      agentId: row.agentId,
      agentName: row.agentName,
      kind: row.kind as any,
      status: row.status as any,
      graphThreadId: row.graphThreadId,
      checkpointId: row.checkpointId || undefined,
      currentNode: row.currentNode || undefined,
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))

    // Load agentEvents
    const agentEventsRows = db.prepare('SELECT * FROM agent_events').all() as any[]
    const agentEvents: AgentEvent[] = agentEventsRows.map(row => ({
      id: row.id,
      taskId: row.taskId,
      runId: row.runId,
      parentRunId: row.parentRunId || undefined,
      type: row.type as any,
      payload: JSON.parse(row.payload),
      createdAt: row.createdAt,
    }))

    // Load approvals
    const approvalsRows = db.prepare('SELECT * FROM approvals').all() as any[]
    const approvals: HumanApproval[] = approvalsRows.map(row => ({
      id: row.id,
      taskId: row.taskId,
      runId: row.runId,
      toolCallId: row.toolCallId || undefined,
      reason: row.reason,
      originalArgs: row.originalArgs ? JSON.parse(row.originalArgs) : undefined,
      editedArgs: row.editedArgs ? JSON.parse(row.editedArgs) : undefined,
      decision: row.decision as any,
      decidedAt: row.decidedAt || undefined,
      createdAt: row.createdAt,
    }))

    // Load settings
    const settingsRows = db.prepare('SELECT * FROM settings').all() as { key: string, value: string }[]
    const settingsMap: Record<string, string> = {}
    for (const row of settingsRows) {
      settingsMap[row.key] = row.value
    }

    const settings: AppSettings = {
      networkEnabled: settingsMap.networkEnabled === 'true',
      webSearchEnabled: settingsMap.webSearchEnabled === 'true',
      maxConcurrentRuns: settingsMap.maxConcurrentRuns ? parseInt(settingsMap.maxConcurrentRuns, 10) : 2,
      defaultWorkspaceId: settingsMap.defaultWorkspaceId || undefined,
      sandboxEnabled: settingsMap.sandboxEnabled === 'true',
      wechatWebhook: settingsMap.wechatWebhook || undefined,
      wechatSecret: settingsMap.wechatSecret || undefined,
      dingtalkWebhook: settingsMap.dingtalkWebhook || undefined,
      dingtalkSecret: settingsMap.dingtalkSecret || undefined,
    }

    return {
      version: 1,
      tasks,
      taskWorkspaces,
      messages,
      drafts,
      workspaces,
      agentRuns,
      agentEvents,
      approvals,
      settings,
    }
  }

  async save(state: AppState): Promise<void> {
    const db = this.initDb()

    const runTransaction = db.transaction((s: AppState) => {
      // Clear all existing table contents
      db.prepare('DELETE FROM workspaces').run()
      db.prepare('DELETE FROM tasks').run()
      db.prepare('DELETE FROM task_workspaces').run()
      db.prepare('DELETE FROM messages').run()
      db.prepare('DELETE FROM drafts').run()
      db.prepare('DELETE FROM agent_runs').run()
      db.prepare('DELETE FROM agent_events').run()
      db.prepare('DELETE FROM approvals').run()
      db.prepare('DELETE FROM settings').run()

      // Insert workspaces
      const insertWorkspace = db.prepare(`
        INSERT INTO workspaces (id, name, path, icon, defaultPermissionMode, isArchived, createdAt, updatedAt, lastOpenedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const w of s.workspaces) {
        insertWorkspace.run(
          w.id,
          w.name,
          w.path,
          w.icon || null,
          w.defaultPermissionMode,
          w.isArchived ? 1 : 0,
          w.createdAt,
          w.updatedAt,
          w.lastOpenedAt || null
        )
      }

      // Insert tasks
      const insertTask = db.prepare(`
        INSERT INTO tasks (id, title, mode, modelId, expertId, primaryWorkspaceId, permissionMode, connectorIds, skillIds, status, unreadEventCount, lastRunId, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const t of s.tasks) {
        insertTask.run(
          t.id,
          t.title,
          t.mode,
          t.modelId,
          t.expertId || null,
          t.primaryWorkspaceId || null,
          t.permissionMode,
          JSON.stringify(t.connectorIds),
          JSON.stringify(t.skillIds),
          t.status,
          t.unreadEventCount,
          t.lastRunId || null,
          t.createdAt,
          t.updatedAt
        )
      }

      // Insert taskWorkspaces
      const insertTaskWorkspace = db.prepare(`
        INSERT INTO task_workspaces (id, taskId, workspaceId, role, accessMode, addedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      for (const tw of s.taskWorkspaces) {
        insertTaskWorkspace.run(
          tw.id,
          tw.taskId,
          tw.workspaceId,
          tw.role,
          tw.accessMode,
          tw.addedAt
        )
      }

      // Insert messages
      const insertMessage = db.prepare(`
        INSERT INTO messages (id, taskId, runId, workspaceId, role, content, metadata, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const m of s.messages) {
        insertMessage.run(
          m.id,
          m.taskId,
          m.runId || null,
          m.workspaceId || null,
          m.role,
          m.content,
          m.metadata ? JSON.stringify(m.metadata) : null,
          m.createdAt
        )
      }

      // Insert drafts
      const insertDraft = db.prepare(`
        INSERT INTO drafts (taskId, content, selectedSkillIds, selectedConnectorIds, updatedAt)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const d of s.drafts) {
        insertDraft.run(
          d.taskId,
          d.content,
          JSON.stringify(d.selectedSkillIds),
          JSON.stringify(d.selectedConnectorIds),
          d.updatedAt
        )
      }

      // Insert agentRuns
      const insertAgentRun = db.prepare(`
        INSERT INTO agent_runs (id, taskId, workspaceIds, parentRunId, agentId, agentName, kind, status, graphThreadId, checkpointId, currentNode, startedAt, completedAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const r of s.agentRuns) {
        insertAgentRun.run(
          r.id,
          r.taskId,
          JSON.stringify(r.workspaceIds),
          r.parentRunId || null,
          r.agentId,
          r.agentName,
          r.kind,
          r.status,
          r.graphThreadId,
          r.checkpointId || null,
          r.currentNode || null,
          r.startedAt || null,
          r.completedAt || null,
          r.createdAt,
          r.updatedAt
        )
      }

      // Insert agentEvents
      const insertAgentEvent = db.prepare(`
        INSERT INTO agent_events (id, taskId, runId, parentRunId, type, payload, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const e of s.agentEvents) {
        insertAgentEvent.run(
          e.id,
          e.taskId,
          e.runId,
          e.parentRunId || null,
          e.type,
          JSON.stringify(e.payload),
          e.createdAt
        )
      }

      // Insert approvals
      const insertApproval = db.prepare(`
        INSERT INTO approvals (id, taskId, runId, toolCallId, reason, originalArgs, editedArgs, decision, decidedAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const a of s.approvals) {
        insertApproval.run(
          a.id,
          a.taskId,
          a.runId,
          a.toolCallId || null,
          a.reason,
          a.originalArgs ? JSON.stringify(a.originalArgs) : null,
          a.editedArgs ? JSON.stringify(a.editedArgs) : null,
          a.decision,
          a.decidedAt || null,
          a.createdAt
        )
      }

      // Insert settings
      const insertSetting = db.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
      `)
      for (const [key, value] of Object.entries(s.settings)) {
        if (value !== undefined && value !== null) {
          insertSetting.run(key, String(value))
        }
      }
    })

    runTransaction(state)
  }
}
