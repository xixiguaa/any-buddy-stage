import { Empty } from 'antd'
import { TaskDetailProvider, useTaskDetail } from './TaskDetailContext.js'
import TaskDetailApprovalBar from './TaskDetailApprovalBar.js'
import TaskDetailComposerSection from './TaskDetailComposerSection.js'
import TaskDetailHeader from './TaskDetailHeader.js'
import TaskDetailMessageList from './TaskDetailMessageList.js'
import TaskDetailArtifactsSidebar from './TaskDetailArtifactsSidebar.js'

/**
 * 任务详情页主内容区域组件
 */
function TaskDetailContent() {
  const { task, taskId, selectedTaskId } = useTaskDetail()

  // 路由已切换但新任务数据尚未加载时，不能继续展示上一任务的上下文。
  if (!task || task.id !== taskId || selectedTaskId !== taskId) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '48px' }}>
        <Empty description={taskId ? '正在加载任务...' : '选择一个任务查看对话和运行状态。'} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#ffffff', width: '100%' }}>
      {/* 左侧主对话与输入区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
        <TaskDetailHeader />
        <TaskDetailApprovalBar />
        <TaskDetailMessageList />
        <TaskDetailComposerSection />
      </div>

      {/* 右侧工作区成果 (产物) 侧边栏 (参照 WorkBuddy) */}
      <TaskDetailArtifactsSidebar />
    </div>
  )
}

/**
 * 任务详情页入口组件（使用 TaskDetailProvider 上下文包裹）
 */
export default function TaskDetailPage() {
  return (
    <TaskDetailProvider>
      <TaskDetailContent />
    </TaskDetailProvider>
  )
}
