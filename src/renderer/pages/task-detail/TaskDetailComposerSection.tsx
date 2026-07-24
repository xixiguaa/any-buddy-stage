import { createAnybuddyClients } from '../../api/clients.js'
import TaskComposer from '../../components/TaskComposer.js'
import { useTaskDetail } from './TaskDetailContext.js'

/**
 * 任务详情页底部消息发送区域组件
 * 包裹 TaskComposer 并处理草稿保存、发送消息及更新 Task 配置
 */
export default function TaskDetailComposerSection() {
  const { taskId, task, workspaces, drafts, saveDraft, clearDraft, sendMessage } = useTaskDetail()

  if (!task || !taskId) return null

  return (
    <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', background: '#ffffff' }}>
      <TaskComposer
        workspaces={workspaces}
        draft={drafts[taskId]}
        defaultMode={task.mode}
        defaultPermissionMode={task.permissionMode}
        hideTitle={true}
        hideWorkspacePicker={true}
        buttonLabel="发送"
        onDraftChange={(draft) => {
          void saveDraft(taskId, {
            content: draft.content,
            selectedSkillIds: draft.selectedSkillIds,
            selectedConnectorIds: draft.selectedConnectorIds,
            selectedExpertIds: draft.selectedExpertIds,
            selectedExpertId: draft.selectedExpertId,
          })
        }}
        onClearDraft={() => clearDraft(taskId)}
        onSend={async (content, options) => {
          const clients = createAnybuddyClients(window.anybuddy)
          const updateResult = await clients.task.update(taskId, {
            mode: options.mode,
            modelId: options.modelId,
            skillIds: options.skillIds,
            connectorIds: options.connectorIds,
            expertIds: options.expertIds ?? [],
            activeExpertId: options.activeExpertId,
            permissionMode: options.permissionMode,
          })
          if (!updateResult.ok) {
            throw new Error(updateResult.error.message)
          }
          await sendMessage(taskId, content)
          await clearDraft(taskId)
        }}
      />
    </div>
  )
}
