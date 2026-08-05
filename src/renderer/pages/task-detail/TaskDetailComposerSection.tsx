import { createCulclawClients } from '../../api/clients.js'
import { rendererApi } from '../../api/bridge.js'
import TaskComposer from '../../components/TaskComposer.js'
import { useTaskDetail } from './TaskDetailContext.js'

/**
 * 任务详情页底部消息发送区域组件
 * 包裹 TaskComposer 并处理草稿保存、发送消息及更新 Task 配置
 */
export default function TaskDetailComposerSection() {
  const { taskId, task, workspaces, drafts, currentRun, isAgentWorking, saveDraft, clearDraft, sendMessage, selectTask } = useTaskDetail()

  // 路由切换期间不使用上一任务的数据初始化当前编辑器。
  if (!task || !taskId || task.id !== taskId) return null

  // 只有当前任务确为单专家对话时，才允许从专家库回写该任务。
  const manageExpertsSourceTask = task.activeExpertId && !task.activeExpertTeamId
    ? {
        taskId,
        activeExpertId: task.activeExpertId,
        expertIds: task.expertIds,
      }
    : undefined

  return (
    <div style={{ padding: '16px 24px', borderTop: '1px solid #f1f5f9', background: '#ffffff' }}>
      <TaskComposer
        workspaces={workspaces}
        draft={drafts[taskId]}
        defaultMode={task.mode}
        defaultModelId={task.modelId}
        defaultPermissionMode={task.permissionMode}
        defaultActiveExpertId={task.activeExpertId}
        defaultActiveExpertTeamId={task.activeExpertTeamId}
        defaultSkillIds={task.skillIds}
        defaultConnectorIds={task.connectorIds}
        manageExpertsSourceTask={manageExpertsSourceTask}
        hideTitle={true}
        hideWorkspacePicker={true}
        buttonLabel="发送"
        isResponding={isAgentWorking}
        onStop={async () => {
          if (!currentRun) return
          // 使用 Culclaw API 取消 Agent 运行
          const clients = createCulclawClients(rendererApi)
          const result = await clients.agentRun.cancel(currentRun.id)
          if (!result.ok) {
            throw new Error(result.error.message)
          }
          await selectTask(taskId)
        }}
        onDraftChange={(draft) => {
          void saveDraft(taskId, {
            content: draft.content,
            selectedMode: draft.selectedMode,
            selectedSkillIds: draft.selectedSkillIds,
            selectedConnectorIds: draft.selectedConnectorIds,
            selectedExpertIds: draft.selectedExpertIds,
            selectedExpertId: draft.selectedExpertId,
            selectedExpertTeamId: draft.selectedExpertTeamId,
          })
        }}
        onClearDraft={() => clearDraft(taskId)}
        onSend={async (content, options) => {
          // 使用 Culclaw API 更新任务设置
          const clients = createCulclawClients(rendererApi)
          const updateResult = await clients.task.update(taskId, {
            mode: options.mode,
            modelId: options.modelId,
            skillIds: options.skillIds,
            connectorIds: options.connectorIds,
            expertIds: options.expertIds ?? [],
            activeExpertId: options.activeExpertId,
            activeExpertTeamId: options.activeExpertTeamId,
            permissionMode: options.permissionMode,
          })
          if (!updateResult.ok) {
            throw new Error(updateResult.error.message)
          }
          // 刷新任务详情，保证头部 Task Mode 状态与选定模式 100% 同步
          await selectTask(taskId)
          await sendMessage(taskId, content)
          await clearDraft(taskId)
        }}
      />
    </div>
  )
}
