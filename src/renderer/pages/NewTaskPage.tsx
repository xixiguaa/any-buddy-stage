import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import TaskComposer from '../components/TaskComposer.js'
import { useAppStore } from '../stores/app-store.js'

const NEW_TASK_DRAFT_ID = '__new_task__'

export default function NewTaskPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  
  const workspaces = useAppStore(state => state.workspaces)
  const drafts = useAppStore(state => state.drafts)
  const createTask = useAppStore(state => state.createTask)
  const saveDraft = useAppStore(state => state.saveDraft)
  const clearDraft = useAppStore(state => state.clearDraft)
  const loadDraft = useAppStore(state => state.loadDraft)
  const createWorkspaceFromFolderPicker = useAppStore(state => state.createWorkspaceFromFolderPicker)
  
  const defaultWorkspaceId = useMemo(() => params.get('workspace') ?? undefined, [params])
  
  useEffect(() => {
    loadDraft(NEW_TASK_DRAFT_ID).catch(error => console.error(error))
  }, [loadDraft])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px',
      minHeight: '100%',
      background: '#ffffff',
      width: '100%'
    }}>
      {/* Title Header */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '48px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.03em', margin: 0 }}>
          WorkBuddy
        </h1>
        <div style={{ fontSize: '18px', color: '#64748b', fontWeight: 500, marginTop: '8px' }}>
          你的职场超能力
        </div>
      </div>

      {/* Composer Section */}
      <div style={{ width: '100%', maxWidth: '720px' }}>
        <TaskComposer
          workspaces={workspaces}
          draft={drafts[NEW_TASK_DRAFT_ID]}
          defaultWorkspaceId={defaultWorkspaceId}
          onDraftChange={draft => saveDraft(NEW_TASK_DRAFT_ID, draft)}
          onClearDraft={() => clearDraft(NEW_TASK_DRAFT_ID)}
          onPickWorkspace={() => createWorkspaceFromFolderPicker()}
          onCreate={async (input, initialMessage) => {
            const task = await createTask(input, initialMessage)
            navigate(`/tasks/${task.id}`)
          }}
        />
      </div>
    </div>
  )
}
