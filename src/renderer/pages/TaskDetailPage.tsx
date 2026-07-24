import { Empty } from 'antd'
import { TaskDetailProvider, useTaskDetail } from './task-detail/TaskDetailContext.js'
import TaskDetailApprovalBar from './task-detail/TaskDetailApprovalBar.js'
import TaskDetailComposerSection from './task-detail/TaskDetailComposerSection.js'
import TaskDetailHeader from './task-detail/TaskDetailHeader.js'
import TaskDetailMessageList from './task-detail/TaskDetailMessageList.js'
import TaskDetailRuntimeSidebar from './task-detail/TaskDetailRuntimeSidebar.js'

/**
 * 任务详情页主内容区域组件
 */
function TaskDetailContent() {
  const { task } = useTaskDetail()

  if (!task) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '48px' }}>
        <Empty description="选择一个任务查看对话和运行状态。" />
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

      {/* 右侧 Runtime 侧边栏 */}
      <TaskDetailRuntimeSidebar />
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
