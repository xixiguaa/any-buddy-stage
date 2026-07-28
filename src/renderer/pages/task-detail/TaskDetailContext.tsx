import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Modal } from 'antd'
import type {
  AgentEvent,
  AgentRun,
  HumanApproval,
  ExpertPreset,
  ExpertTeamPreset,
  Message,
  Task,
  TaskDraft,
  TaskWorkspaceContext,
  WorkspaceSummary,
  WorkspaceArtifact,
} from '../../../shared/types.js'
import { createAnybuddyClients } from '../../api/clients.js'
import { useAppStore } from '../../stores/app-store.js'

/**
 * 校验浮层恢复点是否属于方案确认
 */
export function isPlanApproval(approval: { originalArgs?: Record<string, unknown> }) {
  return approval.originalArgs?.approvalType === 'plan_confirmation'
}

/**
 * 提取方案确认中的文案
 */
export function getPlanApprovalText(approval: { originalArgs?: Record<string, unknown> }) {
  const plan = approval.originalArgs?.plan
  return typeof plan === 'string' ? plan : ''
}

/**
 * 格式化任务状态文本及颜色
 */
export function getStatusLabelAndColor(status: string) {
  switch (status) {
    case 'idle':
    case 'queued':
    case 'planning':
      return { label: '规划中', color: 'blue' }
    case 'running':
      return { label: '进行中', color: 'geekblue' }
    case 'completed':
      return { label: '已完成', color: 'success' }
    case 'failed':
      return { label: '失败', color: 'error' }
    case 'paused':
    case 'waiting_approval':
      return { label: '待恢复', color: 'warning' }
    case 'archived':
      return { label: '已归档', color: 'default' }
    case 'cancelled':
      return { label: '已取消', color: 'default' }
    default:
      return { label: status, color: 'default' }
  }
}

/**
 * TaskDetailContext 值的契约接口
 */
export interface TaskDetailContextValue {
  taskId?: string
  selectedTaskId?: string
  task?: Task | null
  messages: Message[]
  drafts: Record<string, TaskDraft>
  taskWorkspaces: TaskWorkspaceContext[]
  allAgentRuns: AgentRun[]
  taskEvents: AgentEvent[]
  taskApprovals: HumanApproval[]
  experts: ExpertPreset[]
  expertTeams: ExpertTeamPreset[]
  workspaces: WorkspaceSummary[]

  // 计算衍生数据
  agentRuns: AgentRun[]
  primaryWorkspace?: WorkspaceSummary
  currentRun?: AgentRun
  activeExpert?: ExpertPreset
  activeExpertTeam?: ExpertTeamPreset
  availableExperts: ExpertPreset[]
  attachedWorkspaces: TaskWorkspaceContext[]
  pendingPlanApprovals: HumanApproval[]
  activePlanApproval?: HumanApproval
  isPlanApprovalModalOpen: boolean
  pendingInterrupts: HumanApproval[]
  pendingApprovalCount: number
  isAgentWorking: boolean

  // 成果产物与侧边栏状态
  artifacts: WorkspaceArtifact[]
  isArtifactsPanelOpen: boolean
  selectedArtifact: WorkspaceArtifact | null
  openedArtifacts: WorkspaceArtifact[]
  isScanningArtifacts: boolean
  setIsArtifactsPanelOpen: (open: boolean) => void
  setSelectedArtifact: (artifact: WorkspaceArtifact | null) => void
  closeArtifactTab: (artifactId: string) => void
  scanArtifacts: () => Promise<WorkspaceArtifact[]>
  toggleArtifactsPanel: (open?: boolean) => void
  openArtifactPreview: (artifact?: WorkspaceArtifact) => void

  // 页面局部状态
  editApprovalId: string | null
  setEditApprovalId: (id: string | null) => void
  editedArgsText: string
  setEditedArgsText: (text: string) => void
  closedPlanApprovalId: string | null
  setClosedPlanApprovalId: (id: string | null) => void

  // 滚动引用与方法
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  shouldAutoScrollRef: React.RefObject<boolean>
  handleMessageScroll: () => void

  // 核心操作 API
  selectTask: (taskId: string) => Promise<void>
  sendMessage: (taskId: string, content: string) => Promise<void>
  saveDraft: (taskId: string, draft: Omit<TaskDraft, 'taskId' | 'updatedAt'>) => Promise<void>
  clearDraft: (taskId: string) => Promise<void>
  resumeInterruptedRun: (approvalId: string, action: 'resume' | 'resume_with_edits' | 'cancel', editedArgs?: Record<string, unknown>) => Promise<void>

  // 快捷 handler 动作
  handleClearRuns: () => void
  handleOpenEditInterrupt: (approvalId: string, args: unknown) => void
  handleResumeWithEditedArgs: () => Promise<void>
  handleSwitchExpert: (expert: ExpertPreset) => Promise<void>
  handleApprovePlan: (approvalId: string) => Promise<void>
  handleRejectPlan: (approvalId: string) => Promise<void>
  handleApprovePlanWithFeedback: (approvalId: string) => Promise<void>
  handleRejectPlanWithFeedback: (approvalId: string) => Promise<void>
}

const TaskDetailContext = createContext<TaskDetailContextValue | null>(null)

/**
 * 消费 TaskDetailContext 的自定义 Hook
 */
export function useTaskDetail() {
  const context = useContext(TaskDetailContext)
  if (!context) {
    throw new Error('useTaskDetail 必须在 TaskDetailProvider 内部使用')
  }
  return context
}

const AUTO_SCROLL_BOTTOM_THRESHOLD = 96

function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD
}

/**
 * TaskDetail 上下文提供者组件
 */
export function TaskDetailProvider({ children }: { children: ReactNode }) {
  const { taskId } = useParams()

  // 订阅 Zustand 全局 Store 中的任务相关状态
  const selectedTaskId = useAppStore((state) => state.selectedTaskId)
  const task = useAppStore((state) => state.taskDetail)
  const messages = useAppStore((state) => state.messages)
  const drafts = useAppStore((state) => state.drafts)
  const taskWorkspaces = useAppStore((state) => state.taskWorkspaces)
  const allAgentRuns = useAppStore((state) => state.agentRuns)
  const taskEvents = useAppStore((state) => state.taskEvents)
  const taskApprovals = useAppStore((state) => state.taskApprovals)
  const experts = useAppStore((state) => state.experts)
  const expertTeams = useAppStore((state) => state.expertTeams)
  const selectTask = useAppStore((state) => state.selectTask)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const saveDraft = useAppStore((state) => state.saveDraft)
  const clearDraft = useAppStore((state) => state.clearDraft)
  const resumeInterruptedRun = useAppStore((state) => state.resumeInterruptedRun)
  const workspaces = useAppStore((state) => state.workspaces)

  // 页面局部状态
  const [editApprovalId, setEditApprovalId] = useState<string | null>(null)
  const [editedArgsText, setEditedArgsText] = useState('')
  const [closedPlanApprovalId, setClosedPlanApprovalId] = useState<string | null>(null)

  // 滚动与跟防抖相关的 DOM Ref
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const previousTaskIdRef = useRef<string | undefined>(undefined)

  const lastMessage = messages[messages.length - 1]

  // 监听路由参数 taskId 变化，自动触发全局任务选择
  useEffect(() => {
    if (taskId && selectedTaskId !== taskId) {
      selectTask(taskId).catch((error) => console.error(error))
    }
  }, [selectTask, selectedTaskId, taskId])

  // 监听最新消息及 taskId 变更，自动滚动到底部
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const taskChanged = previousTaskIdRef.current !== taskId
    previousTaskIdRef.current = taskId

    if (taskChanged) {
      shouldAutoScrollRef.current = true
    }

    if (shouldAutoScrollRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [lastMessage?.id, lastMessage?.content, taskId])

  const handleMessageScroll = () => {
    const container = scrollContainerRef.current
    if (!container) return
    shouldAutoScrollRef.current = isNearScrollBottom(container)
  }

  // 衍生数据计算
  const agentRuns = useMemo(() => allAgentRuns.filter((run) => run.taskId === taskId), [allAgentRuns, taskId])

  const primaryWorkspace = useMemo(() => {
    if (!task?.primaryWorkspaceId) return undefined
    return workspaces.find((workspace) => workspace.id === task.primaryWorkspaceId)
  }, [task?.primaryWorkspaceId, workspaces])

  const currentRun = agentRuns[0]
  const activeExpert = useMemo(() => experts.find((expert) => expert.id === task?.activeExpertId), [experts, task?.activeExpertId])
  const activeExpertTeam = useMemo(
    () => expertTeams.find((team) => team.id === task?.activeExpertTeamId),
    [expertTeams, task?.activeExpertTeamId]
  )

  const availableExperts = useMemo(() => experts.filter((expert) => task?.expertIds.includes(expert.id)), [experts, task?.expertIds])

  const attachedWorkspaces = useMemo(() => taskWorkspaces.filter((workspace) => workspace.role === 'attached'), [taskWorkspaces])

  const pendingPlanApprovals = useMemo(
    () => taskApprovals.filter((appr) => appr.decision === 'pending' && isPlanApproval(appr)),
    [taskApprovals]
  )
  const activePlanApproval = pendingPlanApprovals[0]
  const isPlanApprovalModalOpen = Boolean(activePlanApproval && closedPlanApprovalId !== activePlanApproval.id)

  const pendingInterrupts = useMemo(
    () => taskApprovals.filter((appr) => appr.decision === 'pending' && !isPlanApproval(appr)),
    [taskApprovals]
  )
  const pendingApprovalCount = pendingPlanApprovals.length + pendingInterrupts.length

  const isAgentWorking = useMemo(() => {
    return Boolean(currentRun && ['queued', 'running', 'planning'].includes(currentRun.status))
  }, [currentRun])

  // 各种操作回调函数封装
  const handleClearRuns = () => {
    Modal.confirm({
      title: '确认清除运行记录？',
      content: '清除运行记录将清空该任务的所有历史执行信息和中间步骤事件，此操作不可撤销。',
      okText: '确认清除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const clients = createAnybuddyClients(window.anybuddy)
        const result = await clients.agentRun.clearByTask(taskId ?? '')
        if (result.ok) {
          await selectTask(taskId ?? '')
        }
      },
    })
  }

  const handleOpenEditInterrupt = (approvalId: string, args: unknown) => {
    setEditApprovalId(approvalId)
    setEditedArgsText(JSON.stringify(args ?? {}, null, 2))
  }

  const handleResumeWithEditedArgs = async () => {
    if (!editApprovalId) return
    try {
      const editedArgs = JSON.parse(editedArgsText)
      await resumeInterruptedRun(editApprovalId, 'resume_with_edits', editedArgs)
      setEditApprovalId(null)
    } catch (error) {
      console.error(error)
    }
  }

  const handleSwitchExpert = async (expert: ExpertPreset) => {
    if (!taskId) return
    if (expert.id === task?.activeExpertId) return
    const clients = createAnybuddyClients(window.anybuddy)
    const updateResult = await clients.task.update(taskId, {
      activeExpertId: expert.id,
      expertIds: task?.expertIds.includes(expert.id) ? task.expertIds : [...(task?.expertIds ?? []), expert.id],
    })
    if (!updateResult.ok) {
      throw new Error(updateResult.error.message)
    }
    const messageResult = await clients.message.create(taskId, {
      role: 'system',
      content: `已切换到 ${expert.name}`,
      metadata: {
        eventType: 'expert_switched',
        expertId: expert.id,
        expertName: expert.name,
      },
    })
    if (!messageResult.ok) {
      throw new Error(messageResult.error.message)
    }
    await selectTask(taskId)
  }

  const handleApprovePlan = async (approvalId: string) => {
    if (!taskId) return
    const clients = createAnybuddyClients(window.anybuddy)
    const approval = taskApprovals.find((item) => item.id === approvalId)
    const approvedPlan = approval ? getPlanApprovalText(approval) : ''
    const approvalResult = await clients.agentRun.approve(approvalId, 'approved')
    if (!approvalResult.ok) {
      throw new Error(approvalResult.error.message)
    }
    const updateResult = await clients.task.update(taskId, { mode: 'craft' })
    if (!updateResult.ok) {
      throw new Error(updateResult.error.message)
    }
    const messageResult = await clients.message.create(taskId, {
      role: 'user',
      content: approvedPlan
        ? `我已确认以下执行方案。请严格按照该方案继续执行，不要重新规划。\n\n${approvedPlan}`
        : '我已确认执行方案。请切换到 Craft 模式继续执行。',
      metadata: {
        eventType: 'plan_approved',
        approvalId,
      },
    })
    if (!messageResult.ok) {
      throw new Error(messageResult.error.message)
    }
    const runResult = await clients.agentRun.start(taskId, { agentName: 'Main Agent', kind: 'main' })
    if (!runResult.ok) {
      throw new Error(runResult.error.message)
    }
    await selectTask(taskId)
  }

  const handleRejectPlan = async (approvalId: string) => {
    await resumeInterruptedRun(approvalId, 'cancel')
  }

  const handleApprovePlanWithFeedback = async (approvalId: string) => {
    try {
      await handleApprovePlan(approvalId)
      setClosedPlanApprovalId(null)
    } catch (error) {
      Modal.error({
        title: '执行方案失败',
        content: error instanceof Error ? error.message : '确认方案后启动执行失败，请查看运行日志。',
      })
    }
  }

  // 工作区成果扫描与侧栏状态
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([])
  const [isArtifactsPanelOpen, setIsArtifactsPanelOpen] = useState(false)
  const [selectedArtifact, setSelectedArtifact] = useState<WorkspaceArtifact | null>(null)
  const [openedArtifacts, setOpenedArtifacts] = useState<WorkspaceArtifact[]>([])
  const [isScanningArtifacts, setIsScanningArtifacts] = useState(false)

  // 选中某成果产物，并将其加入已打开的标签页列表
  const handleSelectArtifact = (artifact: WorkspaceArtifact | null) => {
    setSelectedArtifact(artifact)
    if (artifact && !openedArtifacts.some((item) => item.id === artifact.id)) {
      setOpenedArtifacts((prev) => [...prev, artifact])
    }
  }

  // 关闭指定产物标签页，若标签全部关闭则退回到概览与产物列表视图
  const closeArtifactTab = (artifactId: string) => {
    const nextOpened = openedArtifacts.filter((item) => item.id !== artifactId)
    setOpenedArtifacts(nextOpened)
    if (selectedArtifact?.id === artifactId) {
      if (nextOpened.length > 0) {
        setSelectedArtifact(nextOpened[nextOpened.length - 1])
      } else {
        setSelectedArtifact(null)
      }
    }
  }

  // 扫描当前任务绑定的工作区成果文件
  const scanArtifacts = async (): Promise<WorkspaceArtifact[]> => {
    if (!taskId) return []
    setIsScanningArtifacts(true)
    try {
      const res = await window.anybuddy.workspace.scanArtifacts(taskId)
      if (res.ok) {
        setArtifacts(res.data)
        return res.data
      }
    } catch (err) {
      console.error('扫描工作区产物失败:', err)
    } finally {
      setIsScanningArtifacts(false)
    }
    return []
  }

  // 切换成果面板显隐
  const toggleArtifactsPanel = (open?: boolean) => {
    const nextOpen = open !== undefined ? open : !isArtifactsPanelOpen
    setIsArtifactsPanelOpen(nextOpen)
    if (nextOpen) {
      scanArtifacts()
    }
  }

  // 打开特定成果预览（若未指定特定产物则仅打开面板，展示图 2 的概览与列表）
  const openArtifactPreview = async (artifact?: WorkspaceArtifact) => {
    let currentArtifacts = artifacts
    if (currentArtifacts.length === 0) {
      currentArtifacts = await scanArtifacts()
    }
    if (artifact) {
      handleSelectArtifact(artifact)
    }
    setIsArtifactsPanelOpen(true)
  }

  // 任务变更或 Agent 运行结束时扫描产物
  useEffect(() => {
    if (taskId) {
      scanArtifacts()
    }
  }, [taskId, isAgentWorking])

  const handleRejectPlanWithFeedback = async (approvalId: string) => {
    try {
      await handleRejectPlan(approvalId)
      setClosedPlanApprovalId(null)
    } catch (error) {
      Modal.error({
        title: '取消方案失败',
        content: error instanceof Error ? error.message : '取消方案失败，请查看运行日志。',
      })
    }
  }

  const value: TaskDetailContextValue = {
    taskId,
    selectedTaskId,
    task,
    messages,
    drafts,
    taskWorkspaces,
    allAgentRuns,
    taskEvents,
    taskApprovals,
    experts,
    expertTeams,
    workspaces,

    agentRuns,
    primaryWorkspace,
    currentRun,
    activeExpert,
    activeExpertTeam,
    availableExperts,
    attachedWorkspaces,
    pendingPlanApprovals,
    activePlanApproval,
    isPlanApprovalModalOpen,
    pendingInterrupts,
    pendingApprovalCount,
    isAgentWorking,

    artifacts,
    isArtifactsPanelOpen,
    selectedArtifact,
    openedArtifacts,
    isScanningArtifacts,
    setIsArtifactsPanelOpen,
    setSelectedArtifact: handleSelectArtifact,
    closeArtifactTab,
    scanArtifacts,
    toggleArtifactsPanel,
    openArtifactPreview,

    editApprovalId,
    setEditApprovalId,
    editedArgsText,
    setEditedArgsText,
    closedPlanApprovalId,
    setClosedPlanApprovalId,

    scrollContainerRef,
    shouldAutoScrollRef,
    handleMessageScroll,

    selectTask,
    sendMessage,
    saveDraft,
    clearDraft,
    resumeInterruptedRun,

    handleClearRuns,
    handleOpenEditInterrupt,
    handleResumeWithEditedArgs,
    handleSwitchExpert,
    handleApprovePlan,
    handleRejectPlan,
    handleApprovePlanWithFeedback,
    handleRejectPlanWithFeedback,
  }

  return <TaskDetailContext.Provider value={value}>{children}</TaskDetailContext.Provider>
}
